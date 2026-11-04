use super::{
    data, database, model as m,
    repository::{fingerprint, Repository},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;
struct Fixture {
    root: PathBuf,
    repo: Repository,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("matheca-phase3-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let repo = Repository::new(root.clone());
        Self { root, repo }
    }
    fn db(&self) -> Connection {
        database::open(&self.root).unwrap()
    }
    fn state(&self) -> Value {
        self.repo.state("GRAPHITE", "ask").unwrap()
    }
    fn call(&self, c: &str, args: Vec<Value>) -> Value {
        self.repo.mutate(c, &args).unwrap()
    }
    fn q(&self, id: &str, body: &str, confirm: bool) -> Value {
        let mut q = m::new_question(id);
        q["body"] = json!(body);
        self.call("question:save", vec![q, json!(confirm)])
    }
    fn collection(&self, id: &str) {
        self.call("collection:save",vec![json!({"id":id,"title":"测试题集","paperTitle":"试卷","examInstructions":"","examMinutes":90,"totalScore":100})]);
    }
    fn order(&self, c: &str) -> Vec<String> {
        self.state()["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|i| i["collectionId"] == c)
            .map(|i| i["questionId"].as_str().unwrap().into())
            .collect()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn hash(path: &std::path::Path) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(std::fs::read(path).unwrap()).to_vec()
}
#[test]
fn another_instance_edit_stops_solution_in_the_same_transaction() {
    let f = Fixture::new();
    let mut q = f.q("q", "原题", false);
    q["autoSolve"] = json!(true);
    let db = f.db();
    data::put(&db, "questions", &q).unwrap();
    let job = json!({"id":"j","createdAt":"1","type":"solution","questionId":"q","runId":"old","status":"processing","fingerprint":fingerprint(&q)});
    data::put(&db, "jobs", &job).unwrap();
    drop(db);
    let second = Repository::new(f.root.clone());
    q["autoSolve"] = json!(false);
    second.mutate("question:save", &[q, json!(false)]).unwrap();
    let db = f.db();
    let stored = data::get(&db, "jobs", "j").unwrap().unwrap();
    assert_eq!(stored["status"], "paused");
    assert!(stored["runId"].is_null());
    assert!(crate::tasks_store::current(&db, &job).is_err());
}
#[test]
fn import_page_failure_rolls_back_questions_and_checkpoint_together() {
    let f = Fixture::new();
    let j =
        json!({"id":"import","createdAt":"1","type":"import","status":"processing","runId":"run"});
    data::put(&f.db(), "jobs", &j).unwrap();
    f.db().execute_batch("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON pages BEGIN SELECT RAISE(ABORT,'injected page write failure'); END;").unwrap();
    let drafts = vec![
        json!({"body":"完整题干","latex":"","grade":"高一","kind":"计算题","difficulty":"基础","knowledge":""}),
    ];
    let apply = |db: &Connection| {
        crate::tasks_store::commit_page(
            db,
            &j,
            (0, 0),
            "source",
            &drafts,
            &["source".into()],
            "模拟导入",
        )
    };
    assert!(f.repo.task_write(apply).is_err());
    assert!(data::records(&f.db(), "questions").unwrap().is_empty());
    assert!(crate::tasks_store::page(&f.db(), "import", 0, 0)
        .unwrap()
        .is_none());
    f.db()
        .execute_batch("DROP TRIGGER fail_checkpoint")
        .unwrap();
    assert_eq!(f.repo.task_write(apply).unwrap().len(), 1);
}

#[test]
fn normalizations_match_existing_typescript() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("../../../src/shared/normalization-fixtures.json")).unwrap();
    for v in fixtures {
        let input = v["input"].as_str().unwrap();
        assert_eq!(
            m::clean_title(input),
            v["title"].as_str().unwrap(),
            "title {input:?}"
        );
        assert_eq!(
            m::clean_body(input),
            v["body"].as_str().unwrap(),
            "body {input:?}"
        );
    }
}
#[test]
fn real_crud_review_and_restart() {
    let f = Fixture::new();
    let q = f.q("q", "原题干", true);
    assert_eq!(q["reviewed"], true);
    let mut next = q.clone();
    next["body"] = json!("更新题干");
    next["favorite"] = json!(true);
    let next = f.call("question:save", vec![next, json!(false)]);
    assert_eq!(next["reviewed"], false);
    assert_eq!(next["createdAt"], q["createdAt"]);
    let again = Repository::new(f.root.clone())
        .state("GRAPHITE", "ask")
        .unwrap();
    assert_eq!(again["questions"][0]["body"], "更新题干");
    assert_eq!(again["questions"][0]["favorite"], true);
    assert!(f.root.join("library.sqlite").is_file());
}
#[test]
fn preserved_fields_and_exact_long_boundaries() {
    let f = Fixture::new();
    let mut q = f.q("q", "原题干", true);
    q["createdAt"] = json!(i64::MAX.to_string());
    q["extensionField"] = json!({"legacy":true});
    q["sourcePath"] = json!(f.root.join("source.png").to_string_lossy());
    q["solution"] = json!("旧解答");
    q["solutionLatex"] = json!("x=1");
    q["solutionFingerprint"] = json!(fingerprint(&q));
    data::put(&f.db(), "questions", &q).unwrap();
    let mut draft = q.clone();
    draft["sourcePath"] = json!("C:/outside/forged.png");
    draft["latex"] = json!("x^2");
    let saved = f.call("question:save", vec![draft, json!(false)]);
    assert_eq!(saved["createdAt"], i64::MAX.to_string());
    assert_eq!(saved["extensionField"], q["extensionField"]);
    assert_eq!(saved["sourcePath"], q["sourcePath"]);
    assert_eq!(saved["solution"], "");
    assert_eq!(saved["reviewed"], true);
}
#[test]
fn review_undo_is_guarded_and_one_time() {
    let f = Fixture::new();
    let before = f.q("q", "原题干", false);
    let mut draft = before.clone();
    draft["body"] = json!("已校对内容");
    let after = f.call("question:save", vec![draft, json!(true)]);
    let restored = f.call("question:undo-review", vec![after.clone()]);
    assert_eq!(restored["body"], before["body"]);
    assert!(f
        .repo
        .mutate("question:undo-review", &[after.clone()])
        .is_err());
    let next = f.call("question:save", vec![after.clone(), json!(true)]);
    let mut changed = next.clone();
    changed["body"] = json!("后续编辑");
    f.call("question:save", vec![changed, json!(false)]);
    assert!(f.repo.mutate("question:undo-review", &[next]).is_err());
}
#[test]
fn addition_undo_preserves_later_reorder_and_invalidates_readd() {
    let f = Fixture::new();
    for id in ["a", "b", "c"] {
        f.q(id, id, false);
    }
    f.collection("paper");
    f.call("collection:add", vec![json!("paper"), json!(["a", "b"])]);
    let result = f.call(
        "collection:add-undoable",
        vec![json!("paper"), json!(["a", "c", "c"])],
    );
    assert_eq!(result["count"], 1);
    f.call(
        "collection:reorder",
        vec![json!("paper"), json!(["c", "b", "a"])],
    );
    f.call("collection:undo-addition", vec![result["token"].clone()]);
    assert_eq!(f.order("paper"), vec!["b", "a"]);
    let stale = f.call(
        "collection:add-undoable",
        vec![json!("paper"), json!(["c"])],
    );
    f.call("collection:remove", vec![json!("paper"), json!("c")]);
    f.call("collection:add", vec![json!("paper"), json!(["c"])]);
    assert!(f
        .repo
        .mutate("collection:undo-addition", &[stale["token"].clone()])
        .is_err());
}
#[test]
fn deleted_question_restores_anchors_and_foreign_keys() {
    let f = Fixture::new();
    for id in ["a", "b", "c", "d"] {
        f.q(id, id, false);
    }
    f.collection("paper");
    f.call(
        "collection:add",
        vec![json!("paper"), json!(["a", "b", "c"])],
    );
    let token = f.call("question:delete", vec![json!("b")]);
    assert_eq!(f.order("paper"), vec!["a", "c"]);
    f.call("collection:add", vec![json!("paper"), json!(["d"])]);
    f.call(
        "collection:reorder",
        vec![json!("paper"), json!(["d", "c", "a"])],
    );
    f.call("deletion:undo", vec![token.clone()]);
    assert_eq!(f.order("paper"), vec!["d", "b", "c", "a"]);
    assert!(f.repo.mutate("deletion:undo", &[token]).is_err());
    database::validate(&f.db()).unwrap();
}
#[test]
fn collection_and_item_deletion_undo() {
    let f = Fixture::new();
    for id in ["a", "b", "c"] {
        f.q(id, id, false);
    }
    f.collection("paper");
    f.call(
        "collection:add",
        vec![json!("paper"), json!(["a", "b", "c"])],
    );
    let token = f.call("collection:remove", vec![json!("paper"), json!("b")]);
    f.call("deletion:undo", vec![token]);
    assert_eq!(f.order("paper"), vec!["a", "b", "c"]);
    let token = f.call("collection:delete", vec![json!("paper")]);
    assert!(f.state()["items"].as_array().unwrap().is_empty());
    f.call("question:delete", vec![json!("b")]);
    assert!(f.repo.mutate("deletion:undo", &[token]).is_err());
}
#[test]
fn stale_deletion_never_overwrites_new_record() {
    let f = Fixture::new();
    f.q("q", "旧题目", false);
    let token = f.call("question:delete", vec![json!("q")]);
    f.q("q", "同编号新题目", false);
    assert!(f.repo.mutate("deletion:undo", &[token]).is_err());
    assert_eq!(f.state()["questions"][0]["body"], "同编号新题目");
}
#[test]
fn transaction_failure_rolls_back_partial_reorder() {
    let f = Fixture::new();
    for id in ["a", "b", "c"] {
        f.q(id, id, false);
    }
    f.collection("paper");
    f.call(
        "collection:add",
        vec![json!("paper"), json!(["a", "b", "c"])],
    );
    f.db().execute_batch("CREATE TRIGGER reject_b BEFORE UPDATE ON items WHEN NEW.questionId='b' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert!(f
        .repo
        .mutate(
            "collection:reorder",
            &[json!("paper"), json!(["c", "b", "a"])]
        )
        .is_err());
    assert_eq!(f.order("paper"), vec!["a", "b", "c"]);
    assert!(f
        .repo
        .mutate(
            "collection:reorder",
            &[json!("paper"), json!(["a", "a", "c"])]
        )
        .is_err());
}
#[test]
fn undo_failure_rolls_back_question_and_prior_placements() {
    let f = Fixture::new();
    f.q("q", "题目", false);
    for c in ["c1", "c2"] {
        f.collection(c);
        f.call("collection:add", vec![json!(c), json!(["q"])]);
    }
    let token = f.call("question:delete", vec![json!("q")]);
    f.db().execute_batch("CREATE TRIGGER reject_c2 BEFORE INSERT ON items WHEN NEW.collectionId='c2' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert!(f.repo.mutate("deletion:undo", &[token.clone()]).is_err());
    assert!(f.state()["questions"].as_array().unwrap().is_empty());
    assert!(f.order("c1").is_empty());
    f.db().execute_batch("DROP TRIGGER reject_c2").unwrap();
    f.call("deletion:undo", vec![token]);
    assert_eq!(f.order("c1"), vec!["q"]);
    assert_eq!(f.order("c2"), vec!["q"]);
}
#[test]
fn figures_points_and_layout_validation_are_authoritative() {
    let f = Fixture::new();
    f.call(
        "knowledge:add",
        vec![json!({"group":"函数","name":"自定义知识点"})],
    );
    assert!(f
        .repo
        .mutate(
            "knowledge:add",
            &[json!({"group":"函数","name":"自定义知识点"})]
        )
        .is_err());
    let mut q = m::new_question("q");
    q["body"] = json!("题干");
    q["knowledge"] = json!("二次函数、未知、自定义知识点、二次函数");
    q["figures"] = json!(["data:image/png;base64,AAAA"]);
    q["figureWidths"] = json!([60]);
    q["figurePlacements"] = json!(["A"]);
    let saved = f.call("question:save", vec![q.clone(), json!(true)]);
    assert_eq!(saved["knowledge"], "函数的概念与性质、自定义知识点");
    q["figureWidths"] = json!([170]);
    assert!(f.repo.mutate("question:save", &[q, json!(true)]).is_err());
    let mut c = json!({"id":"paper","title":"题集","paperTitle":"试卷","examInstructions":"","examMinutes":90,"totalScore":100,"questionLayout":{"q":{"answerSpaceMm":161}}});
    assert!(f.repo.mutate("collection:save", &[c.clone()]).is_err());
    c["questionLayout"]["q"]["answerSpaceMm"] = json!(75);
    f.call("collection:save", vec![c]);
}
#[test]
fn schema_upgrade_backup_is_restorable_and_newer_version_untouched() {
    let f = Fixture::new();
    let file = f.root.join("library.sqlite");
    let db = Connection::open(&file).unwrap();
    db.execute_batch(database::SCHEMA).unwrap();
    db.execute_batch("DROP TABLE history;DROP TABLE tauri_meta;PRAGMA user_version=0;")
        .unwrap();
    let mut q = m::new_question("legacy");
    q["createdAt"] = json!(i64::MAX.to_string());
    q["body"] = json!("旧题目");
    data::put(&db, "questions", &q).unwrap();
    drop(db);
    assert_eq!(f.state()["questions"][0]["createdAt"], i64::MAX.to_string());
    let files = std::fs::read_dir(f.root.join("backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(files.len(), 1);
    let backup = Connection::open(&files[0]).unwrap();
    assert_eq!(
        backup
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        data::get(&backup, "questions", "legacy").unwrap().unwrap()["body"],
        "旧题目"
    );
    let restored = Fixture::new();
    std::fs::copy(&files[0], restored.root.join("library.sqlite")).unwrap();
    assert_eq!(restored.state()["questions"][0]["body"], "旧题目");
    drop(backup);
    let future = Fixture::new();
    let future_file = future.root.join("library.sqlite");
    let db = Connection::open(&future_file).unwrap();
    db.execute_batch("PRAGMA user_version=99").unwrap();
    drop(db);
    let before = hash(&future_file);
    assert!(future.repo.state("GRAPHITE", "ask").is_err());
    assert_eq!(hash(&future_file), before);
    assert!(!future.root.join("backups").exists());
}
#[test]
fn settings_are_encrypted_atomic_and_failed_legacy_keys_are_retained() {
    let f = Fixture::new();
    let input = json!({"address":"https://one.example/v1","model":"test","theme":"LIGHT","apiKey":"synthetic-phase3-key","autoSolveImports":false});
    f.call("settings:save", vec![input.clone()]);
    assert_eq!(f.state()["settings"]["hasApiKey"], true);
    let cipher = data::setting(&f.db(), "encryptedKey").unwrap();
    assert!(!cipher.contains("synthetic-phase3-key"));
    assert_eq!(
        crate::crypto::unprotect(&cipher, &f.root).unwrap(),
        "synthetic-phase3-key"
    );
    let mut changed = input;
    changed["address"] = json!("https://two.example");
    changed["apiKey"] = json!("");
    assert!(f.repo.mutate("settings:save", &[changed]).is_err());
    assert_eq!(f.state()["settings"]["address"], "https://one.example/v1");
    data::set_setting(&f.db(), "encryptedKey", "unreadable-legacy-value").unwrap();
    assert_eq!(f.state()["settings"]["hasApiKey"], false);
    assert!(f.state()["settings"]["keyWarning"].is_string());
    assert_eq!(
        data::setting(&f.db(), "encryptedKey").unwrap(),
        "unreadable-legacy-value"
    );
}
#[test]
fn audit_failure_does_not_turn_a_commit_into_failure() {
    let f = Fixture::new();
    f.state();
    f.db().execute_batch("CREATE TRIGGER reject_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT,'audit failure');END;").unwrap();
    f.q("q", "实际保存成功", false);
    assert_eq!(f.state()["questions"][0]["body"], "实际保存成功");
}
#[test]
fn copying_live_wal_preserves_source_images_answers_and_unknown_fields() {
    let source = Fixture::new();
    let target = Fixture::new();
    source.q("q", "旧题目", true);
    source.collection("paper");
    source.call("collection:add", vec![json!("paper"), json!(["q"])]);
    source.call("settings:save",vec![json!({"address":"https://one.example","model":"test","theme":"LIGHT","apiKey":"copy-synthetic-key","autoSolveImports":false})]);
    let file = source.root.join("original.png");
    std::fs::write(&file, b"synthetic-image").unwrap();
    let db = source.db();
    let mut q = data::get(&db, "questions", "q").unwrap().unwrap();
    q["sourcePath"] = json!(file.to_string_lossy());
    q["extensionField"] = json!({"unknown":"preserve"});
    q["solution"] = json!("旧解答");
    q["solutionFingerprint"] = json!(fingerprint(&q));
    data::put(&db, "questions", &q).unwrap();
    let pending = json!({"id":"legacy-solution","createdAt":"1","type":"solution","questionId":"q","fingerprint":fingerprint(&q),"runId":"legacy-run","status":"processing"});
    data::put(&db, "jobs", &pending).unwrap();
    let before = hash(&source.root.join("library.sqlite"));
    let wal = hash(&source.root.join("library.sqlite-wal"));
    let copied = target.repo.copy_legacy(&source.root).unwrap();
    assert_eq!(copied["questions"], 1);
    assert_eq!(copied["images"], 1);
    assert_eq!(hash(&source.root.join("library.sqlite")), before);
    assert_eq!(hash(&source.root.join("library.sqlite-wal")), wal);
    let saved = data::get(&target.db(), "questions", "q").unwrap().unwrap();
    assert_eq!(saved["extensionField"], q["extensionField"]);
    assert_eq!(saved["solutionFingerprint"], fingerprint(&saved));
    let migrated_job = data::get(&target.db(), "jobs", "legacy-solution")
        .unwrap()
        .unwrap();
    assert_eq!(migrated_job["status"], "paused");
    assert!(migrated_job["runId"].is_null());
    assert_eq!(migrated_job["fingerprint"], fingerprint(&saved));
    assert_eq!(
        data::get(&db, "jobs", "legacy-solution").unwrap().unwrap(),
        pending
    );
    assert_eq!(
        std::fs::read(saved["sourcePath"].as_str().unwrap()).unwrap(),
        b"synthetic-image"
    );
    assert_eq!(target.state()["questions"][0]["solution"], "旧解答");
    assert_eq!(target.state()["settings"]["hasApiKey"], true);
    assert!(target.repo.copy_legacy(&source.root).is_err());
    drop(db);
}
#[test]
fn failed_copy_rolls_back_rows_and_owned_files() {
    let source = Fixture::new();
    let target = Fixture::new();
    source.q("q", "旧题目", false);
    let mut q = data::get(&source.db(), "questions", "q").unwrap().unwrap();
    q["sourcePath"] = json!(target.root.join("outside.png").to_string_lossy());
    std::fs::write(target.root.join("outside.png"), b"do not touch").unwrap();
    data::put(&source.db(), "questions", &q).unwrap();
    assert!(target.repo.copy_legacy(&source.root).is_err());
    assert!(target.state()["questions"].as_array().unwrap().is_empty());
    assert_eq!(
        std::fs::read(target.root.join("outside.png")).unwrap(),
        b"do not touch"
    );
    assert_eq!(
        std::fs::read_dir(target.root.join("migrated"))
            .unwrap()
            .count(),
        0
    );
}
#[test]
fn crash_recovery_only_removes_owned_uncommitted_batches() {
    let f = Fixture::new();
    f.state();
    let db = f.db();
    let base = f.root.join("migrated");
    std::fs::create_dir(&base).unwrap();
    let pending = uuid::Uuid::new_v4().to_string();
    let committed = uuid::Uuid::new_v4().to_string();
    for id in [&pending, &committed] {
        std::fs::create_dir(base.join(id)).unwrap();
        std::fs::write(
            base.join(id).join(".pending"),
            b"matheca-owned-migration-v1",
        )
        .unwrap();
        std::fs::write(base.join(id).join("image.png"), b"keep if committed").unwrap();
    }
    db.execute(
        "INSERT INTO tauri_meta VALUES(?1,'committed')",
        [format!("migration:{committed}")],
    )
    .unwrap();
    f.state();
    assert!(!base.join(pending).exists());
    assert!(base.join(committed).join("image.png").exists());
}
#[test]
fn another_repository_invalidates_stale_undo() {
    let f = Fixture::new();
    let mut q = f.q("q", "旧题干", false);
    q["body"] = json!("已校对");
    let saved = f.call("question:save", vec![q, json!(true)]);
    let peer = Repository::new(f.root.clone());
    let mut other = m::new_question("other");
    other["body"] = json!("另一个窗口保存");
    peer.mutate("question:save", &[other, json!(false)])
        .unwrap();
    assert!(f.repo.mutate("question:undo-review", &[saved]).is_err());
    assert_eq!(
        data::get(&f.db(), "questions", "q").unwrap().unwrap()["body"],
        "已校对"
    );
}
#[test]
fn separate_repository_instances_serialize_concurrent_writes() {
    let f = Fixture::new();
    f.state();
    let peer = Repository::new(f.root.clone());
    std::thread::scope(|scope| {
        let first = &f.repo;
        scope.spawn(move || {
            for i in 0..12 {
                let mut q = m::new_question(&format!("a{i}"));
                q["body"] = json!("并发写入一");
                first.mutate("question:save", &[q, json!(false)]).unwrap();
            }
        });
        scope.spawn(|| {
            for i in 0..12 {
                let mut q = m::new_question(&format!("b{i}"));
                q["body"] = json!("并发写入二");
                peer.mutate("question:save", &[q, json!(false)]).unwrap();
            }
        });
    });
    assert_eq!(f.state()["questions"].as_array().unwrap().len(), 24);
    database::validate(&f.db()).unwrap();
}
