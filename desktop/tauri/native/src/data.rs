use crate::{
    crypto, model as m,
    repository::{fingerprint, Repository},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;
type R<T> = Result<T, String>;
#[derive(Clone, Default)]
pub struct UndoState {
    revision: i64,
    deletion: Option<Value>,
    addition: Option<Value>,
    review: Option<(Value, Value)>,
}
pub const CHANNELS: &[&str] = &[
    "question:save",
    "question:undo-review",
    "question:delete",
    "deletion:undo",
    "library:examples",
    "collection:save",
    "collection:delete",
    "collection:add",
    "collection:add-undoable",
    "collection:undo-addition",
    "collection:reorder",
    "collection:remove",
    "knowledge:add",
    "history:record",
    "settings:save",
];
pub fn get(db: &Connection, table: &str, id: &str) -> R<Option<Value>> {
    let s = db
        .query_row(
            &format!("SELECT data FROM {table} WHERE id=?1"),
            [id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    s.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        .transpose()
}
pub fn records(db: &Connection, table: &str) -> R<Vec<Value>> {
    let mut s = db
        .prepare(&format!("SELECT data FROM {table}"))
        .map_err(|e| e.to_string())?;
    let result = s
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
        .collect();
    result
}
pub fn put(db: &Connection, table: &str, value: &Value) -> R<()> {
    let id = m::id(&value["id"])?;
    let created = m::string(&value["createdAt"], 32)?
        .parse::<i64>()
        .map_err(|_| "创建时间超出范围")?;
    db.execute(&format!("INSERT INTO {table}(id,createdAt,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET createdAt=excluded.createdAt,data=excluded.data"),params![id,created,serde_json::to_string(value).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn setting(db: &Connection, key: &str) -> R<String> {
    db.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
        r.get(0)
    })
    .optional()
    .map(|v| v.unwrap_or_default())
    .map_err(|e| e.to_string())
}
pub fn set_setting(db: &Connection, key: &str, value: &str) -> R<()> {
    db.execute(
        "INSERT INTO settings VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn settings(db: &Connection, root: &Path, color: &str, close: &str) -> R<Value> {
    let encrypted = setting(db, "encryptedKey")?;
    let legacy = setting(db, "legacyKeyFile")?;
    let path = std::path::Path::new(&legacy);
    let key_root = if !legacy.is_empty()
        && path
            .canonicalize()
            .ok()
            .zip(root.canonicalize().ok())
            .is_some_and(|(p, r)| p.starts_with(r))
    {
        path.parent().unwrap_or(root)
    } else {
        root
    };
    let key_result = if encrypted.is_empty() {
        Ok(String::new())
    } else {
        crypto::unprotect(&encrypted, key_root)
    };
    let stored_color = setting(db, "colorTheme")?;
    let stored_close = setting(db, "closeAction")?;
    let mut value = json!({"theme":"LIGHT","colorTheme":if ["GRAPHITE","BLUE","CLAY","PLUM"].contains(&stored_color.as_str()){stored_color.as_str()}else{color},"closeAction":if ["ask","quit","background"].contains(&stored_close.as_str()){stored_close.as_str()}else{close},"address":setting(db,"address")?,"model":setting(db,"model")?,"hasApiKey":!encrypted.is_empty()&&key_result.is_ok(),"autoSolveImports":setting(db,"autoSolveImports")?=="true"});
    if key_result.is_err() {
        value["keyWarning"] =
            json!("原有 API Key 无法读取，请重新填写并保存；原有加密资料已保留。");
    }
    Ok(value)
}
fn save_settings(db: &Connection, input: &Value) -> R<Value> {
    let address = m::trim(m::string(&input["address"], 2048)?);
    let model = m::trim(m::string(&input["model"], 512)?);
    let theme = m::string(&input["theme"], 10)?;
    if !["LIGHT", "SYSTEM", "DARK"].contains(&theme) {
        return Err("主题设置无效".into());
    }
    let auto = input["autoSolveImports"].as_bool().ok_or("设置格式无效")?;
    let key = m::trim(
        input
            .get("apiKey")
            .map(|v| m::string(v, 4096))
            .transpose()?
            .unwrap_or(""),
    );
    let clear = input
        .get("clearApiKey")
        .map(|v| v.as_bool().ok_or("设置格式无效"))
        .transpose()?
        .unwrap_or(false);
    let parsed = if address.is_empty() {
        None
    } else {
        let url = url::Url::parse(address).map_err(|_| "接口地址格式不正确")?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || address.contains(['?', '#'])
        {
            return Err("请使用不含账号、参数的 HTTPS 接口地址".into());
        }
        if model.is_empty() {
            return Err("请填写支持图片输入的模型名".into());
        }
        Some(url)
    };
    let old_address = setting(db, "address")?;
    if !setting(db, "encryptedKey")?.is_empty()
        && !old_address.is_empty()
        && key.is_empty()
        && !clear
    {
        if let (Some(new), Ok(old)) = (parsed, url::Url::parse(&old_address)) {
            if new.host_str() != old.host_str() {
                return Err("更换服务地址时请重新填写 API Key".into());
            }
        }
    }
    if !key.is_empty() {
        if !key.bytes().all(|b| (33..=126).contains(&b)) {
            return Err("API Key 格式无效".into());
        }
        set_setting(db, "encryptedKey", &crypto::protect(key)?)?;
    } else if clear {
        set_setting(db, "encryptedKey", "")?;
    }
    for (k, v) in [
        ("address", address),
        ("model", model),
        ("theme", "LIGHT"),
        ("autoSolveImports", if auto { "true" } else { "false" }),
    ] {
        set_setting(db, k, v)?;
    }
    Ok(Value::Null)
}
fn order(db: &Connection, collection: &str) -> R<Vec<String>> {
    let mut s = db
        .prepare("SELECT questionId FROM items WHERE collectionId=?1 ORDER BY position")
        .map_err(|e| e.to_string())?;
    let result = s
        .query_map([collection], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}
fn require(db: &Connection, table: &str, id: &str) -> R<Value> {
    get(db, table, id)?.ok_or_else(|| {
        if table == "questions" {
            "题目不存在".into()
        } else {
            "题集不存在".into()
        }
    })
}
fn reorder(db: &Connection, collection: &str, ids: &[String]) -> R<()> {
    require(db, "collections", collection)?;
    let old = order(db, collection)?;
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    if old.len() != ids.len() || unique.len() != ids.len() || ids.iter().any(|id| !old.contains(id))
    {
        return Err("题集顺序无效".into());
    }
    for (i, id) in ids.iter().enumerate() {
        db.execute(
            "UPDATE items SET position=?1 WHERE collectionId=?2 AND questionId=?3",
            params![i as i64, collection, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn add(db: &Connection, collection: &str, ids: &[String]) -> R<Vec<String>> {
    require(db, "collections", collection)?;
    let old = order(db, collection)?;
    let mut pos: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM items WHERE collectionId=?1",
            [collection],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut added = Vec::new();
    for id in ids {
        if !old.contains(id) && !added.contains(id) && get(db, "questions", id)?.is_some() {
            db.execute(
                "INSERT INTO items VALUES(?1,?2,?3)",
                params![collection, id, pos],
            )
            .map_err(|e| e.to_string())?;
            pos += 1;
            added.push(id.clone());
        }
    }
    Ok(added)
}
fn restore(db: &Connection, c: &str, q: &str, prior: &[String]) -> R<()> {
    require(db, "collections", c)?;
    require(db, "questions", q)?;
    let mut current = order(db, c)?;
    if current.iter().any(|id| id == q) {
        return Err("题目已重新加入题集，无需撤销".into());
    }
    let index = prior.iter().position(|id| id == q).ok_or("关联快照无效")?;
    let next = prior[index + 1..]
        .iter()
        .find_map(|id| current.iter().position(|v| v == id));
    let prev = prior[..index]
        .iter()
        .rev()
        .find_map(|id| current.iter().position(|v| v == id));
    let at = next
        .or_else(|| prev.map(|n| n + 1))
        .unwrap_or(index.min(current.len()));
    current.insert(at, q.into());
    add(db, c, &[q.into()])?;
    reorder(db, c, &current)
}
fn vector(v: &Value) -> R<Vec<String>> {
    m::ids(v)
}
fn operation(db: &Connection, undo: &mut UndoState, channel: &str, args: &[Value]) -> R<Value> {
    let a = args.first().unwrap_or(&Value::Null);
    let b = args.get(1).unwrap_or(&Value::Null);
    match channel {
        "question:save" => {
            let id = m::id(&a["id"])?;
            let confirm = b.as_bool().ok_or("校对确认无效")?;
            let old = get(db, "questions", id)?;
            let base = old.clone().unwrap_or_else(|| m::new_question(id));
            let q = m::question(a, &base, &records(db, "knowledge")?, confirm)?;
            put(db, "questions", &q)?;
            if confirm {
                if !m::review_equal(&base, &q) {
                    undo.review = Some((base, q.clone()));
                }
            } else if undo
                .review
                .as_ref()
                .is_some_and(|(_, after)| after["id"] == q["id"] && !m::review_equal(after, &q))
            {
                undo.review = None;
            }
            Ok(q)
        }
        "question:undo-review" => {
            let current = require(db, "questions", m::id(&a["id"])?)?;
            let (before, after) = undo.review.as_ref().ok_or("题目已更新或没有可撤销的修改")?;
            if after["id"] != a["id"]
                || !m::review_equal(&current, after)
                || !m::review_equal(a, after)
            {
                return Err("题目已更新或没有可撤销的修改".into());
            }
            let mut q = before.clone();
            if current["solutionFingerprint"].as_str() == Some(&fingerprint(&q)) {
                for key in [
                    "solution",
                    "solutionLatex",
                    "solutionFingerprint",
                    "solutionError",
                ] {
                    q[key] = current[key].clone();
                }
            }
            put(db, "questions", &q)?;
            undo.review = None;
            Ok(q)
        }
        "question:delete" => {
            let id = m::id(a)?;
            let q = require(db, "questions", id)?;
            let mut stmt = db
                .prepare("SELECT DISTINCT collectionId FROM items WHERE questionId=?1")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map([id], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let placements = ids
                .iter()
                .map(|c| Ok(json!({"collectionId":c,"order":order(db,c)?})))
                .collect::<R<Vec<_>>>()?;
            db.execute("DELETE FROM questions WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
            if undo
                .addition
                .as_ref()
                .is_some_and(|v| v["ids"].as_array().unwrap().contains(a))
            {
                undo.addition = None;
            }
            let token = uuid::Uuid::new_v4().to_string();
            undo.deletion =
                Some(json!({"token":token,"kind":"question","question":q,"placements":placements}));
            Ok(json!(token))
        }
        "collection:save" => {
            let id = m::id(&a["id"])?;
            let old = get(db, "collections", id)?;
            put(db, "collections", &m::collection(a, old.as_ref())?)?;
            Ok(Value::Null)
        }
        "collection:delete" => {
            let id = m::id(a)?;
            let c = require(db, "collections", id)?;
            let prior = order(db, id)?;
            db.execute("DELETE FROM collections WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
            if undo
                .addition
                .as_ref()
                .is_some_and(|v| v["collectionId"] == *a)
            {
                undo.addition = None;
            }
            let token = uuid::Uuid::new_v4().to_string();
            undo.deletion =
                Some(json!({"token":token,"kind":"collection","collection":c,"order":prior}));
            Ok(json!(token))
        }
        "collection:add" | "collection:add-undoable" => {
            let id = m::id(a)?;
            let ids = m::ids(b)?;
            if undo
                .addition
                .as_ref()
                .is_some_and(|v| v["collectionId"] == *a)
            {
                undo.addition = None;
            }
            let added = add(db, id, &ids)?;
            if channel == "collection:add" {
                return Ok(json!(added.len()));
            }
            if added.is_empty() {
                return Ok(json!({"count":0}));
            }
            let token = uuid::Uuid::new_v4().to_string();
            undo.addition = Some(json!({"token":token,"collectionId":id,"ids":added}));
            Ok(json!({"count":added.len(),"token":token}))
        }
        "collection:undo-addition" => {
            let token = m::id(a)?;
            let snapshot = undo
                .addition
                .as_ref()
                .filter(|v| v["token"] == token)
                .ok_or("这次加入已没有可用的撤销记录")?;
            let c = m::id(&snapshot["collectionId"])?;
            let ids = vector(&snapshot["ids"])?;
            let current = order(db, c)?;
            if ids.iter().any(|id| !current.contains(id)) {
                return Err("已选题目已发生变化，无法撤销这次加入".into());
            }
            for id in &ids {
                db.execute(
                    "DELETE FROM items WHERE collectionId=?1 AND questionId=?2",
                    [c, id],
                )
                .map_err(|e| e.to_string())?;
            }
            reorder(
                db,
                c,
                &current
                    .into_iter()
                    .filter(|id| !ids.contains(id))
                    .collect::<Vec<_>>(),
            )?;
            undo.addition = None;
            Ok(Value::Null)
        }
        "collection:reorder" => {
            reorder(db, m::id(a)?, &m::ids(b)?)?;
            Ok(Value::Null)
        }
        "collection:remove" => {
            let c = m::id(a)?;
            let q = m::id(b)?;
            let prior = order(db, c)?;
            if !prior.iter().any(|id| id == q) {
                return Err("此题已不在题集中".into());
            }
            db.execute(
                "DELETE FROM items WHERE collectionId=?1 AND questionId=?2",
                [c, q],
            )
            .map_err(|e| e.to_string())?;
            reorder(
                db,
                c,
                &prior
                    .iter()
                    .filter(|id| *id != q)
                    .cloned()
                    .collect::<Vec<_>>(),
            )?;
            if undo.addition.as_ref().is_some_and(|v| {
                v["collectionId"] == *a && v["ids"].as_array().unwrap().contains(b)
            }) {
                undo.addition = None;
            }
            let token = uuid::Uuid::new_v4().to_string();
            undo.deletion = Some(
                json!({"token":token,"kind":"item","collectionId":c,"questionId":q,"order":prior}),
            );
            Ok(json!(token))
        }
        "deletion:undo" => {
            let snapshot = undo
                .deletion
                .as_ref()
                .filter(|v| v["token"] == *a)
                .ok_or("这次删除已没有可用的撤销记录")?;
            let kind = snapshot["kind"].as_str().unwrap();
            let mut result = json!({"kind":kind});
            match kind {
                "question" => {
                    let q = &snapshot["question"];
                    if get(db, "questions", m::id(&q["id"])?)?.is_some() {
                        return Err("同编号题目已存在，无法覆盖恢复".into());
                    }
                    put(db, "questions", q)?;
                    for p in snapshot["placements"].as_array().unwrap() {
                        let c = m::id(&p["collectionId"])?;
                        if get(db, "collections", c)?.is_some() {
                            restore(db, c, m::id(&q["id"])?, &vector(&p["order"])?)?;
                        }
                    }
                }
                "collection" => {
                    let c = &snapshot["collection"];
                    let id = m::id(&c["id"])?;
                    if get(db, "collections", id)?.is_some() {
                        return Err("同编号题集已存在，无法覆盖恢复".into());
                    }
                    put(db, "collections", c)?;
                    add(db, id, &vector(&snapshot["order"])?)?;
                    result["collection"] = c.clone();
                }
                "item" => restore(
                    db,
                    m::id(&snapshot["collectionId"])?,
                    m::id(&snapshot["questionId"])?,
                    &vector(&snapshot["order"])?,
                )?,
                _ => return Err("撤销快照无效".into()),
            }
            undo.deletion = None;
            Ok(result)
        }
        "knowledge:add" => {
            let point = m::point(a, &records(db, "knowledge")?)?;
            db.execute(
                "INSERT INTO knowledge VALUES(?1,?2)",
                params![point["name"].as_str().unwrap(), point.to_string()],
            )
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "history:record" => {
            audit(
                db,
                m::string(a, 160)?,
                m::string(b, 200)?,
                "interaction",
                "done",
            )?;
            Ok(Value::Null)
        }
        "settings:save" => save_settings(db, a),
        "settings:color-theme" | "settings:close-action" => {
            let value = m::string(a, 32)?;
            let (key, allowed) = if channel == "settings:color-theme" {
                ("colorTheme", &["GRAPHITE", "BLUE", "CLAY", "PLUM"][..])
            } else {
                ("closeAction", &["ask", "quit", "background"][..])
            };
            if !allowed.contains(&value) {
                return Err("设置值无效".into());
            }
            set_setting(db, key, value)?;
            Ok(Value::Null)
        }
        "library:examples" => {
            if records(db, "questions")?
                .iter()
                .any(|q| q["example"] == true)
            {
                return Ok(Value::Null);
            }
            for (title,body,grade,knowledge,kind) in [("函数单调性","已知函数 \\(f(x)=x^2-2x\\)。\n（1）求函数的对称轴；\n（2）求函数在区间 \\([0,3]\\) 上的值域。","高一","函数单调性","解答题"),("等差数列","等差数列 \\((a_n)\\) 满足 \\(a_1=2\\)，\\(a_5=14\\)，则 \\(a_{10}\\) 为：\nA. 26\nB. 27\nC. 28\nD. 29","高二","等差数列","选择题"),("导数与极值","已知 \\(f(x)=x^3-3x\\)。\n（1）求 \\(f'(x)\\)；\n（2）讨论函数的单调性并求极值。","高二","导数与极值最值","解答题")]{let mut q=m::new_question(&uuid::Uuid::new_v4().to_string());q["title"]=json!(title);q["body"]=json!(body);q["grade"]=json!(grade);q["knowledge"]=json!(knowledge);q["kind"]=json!(kind);q["difficulty"]=json!(if title=="导数与极值"{"进阶"}else{"基础"});q["example"]=json!(true);q["reviewed"]=json!(true);q["sourceLabel"]=json!("示例题");put(db,"questions",&q)?;}
            Ok(Value::Null)
        }
        _ => Err("数据操作尚未实现".into()),
    }
}
pub fn audit(db: &Connection, title: &str, detail: &str, category: &str, status: &str) -> R<()> {
    db.execute(
        "INSERT INTO history(timestamp,title,detail,category,status) VALUES(?1,?2,?3,?4,?5)",
        params![
            m::now().parse::<i64>().unwrap(),
            title,
            detail,
            category,
            status
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn label(db: &Connection, channel: &str, args: &[Value]) -> R<Option<(String, String)>> {
    if [
        "settings:save",
        "settings:color-theme",
        "settings:close-action",
        "history:record",
    ]
    .contains(&channel)
    {
        return Ok(None);
    }
    let value = args.first().unwrap_or(&Value::Null);
    let id = value
        .as_str()
        .or_else(|| value["id"].as_str())
        .unwrap_or("");
    let table = if channel.starts_with("collection:") {
        "collections"
    } else {
        "questions"
    };
    let old = get(db, table, id)?;
    let mut title = match channel {
        "question:save" => {
            if args.get(1) == Some(&json!(true)) {
                "确认题目已校对"
            } else if old.is_none() {
                "创建题目"
            } else if old.as_ref().unwrap()["favorite"] != value["favorite"] {
                if value["favorite"] == true {
                    "收藏题目"
                } else {
                    "取消收藏题目"
                }
            } else {
                "保存题目"
            }
        }
        "question:undo-review" => "撤销题目修改",
        "question:delete" => "从题库删除题目",
        "deletion:undo" => "撤销删除",
        "collection:save" => {
            if old.is_none() {
                "创建题集"
            } else {
                "保存题集设置"
            }
        }
        "collection:delete" => "删除题集",
        "collection:add" | "collection:add-undoable" => "加入题集",
        "collection:undo-addition" => "撤销加入题集",
        "collection:reorder" => "调整题目顺序",
        "collection:remove" => "从题集中移除题目",
        "knowledge:add" => "添加知识点",
        "library:examples" => "添加示例题目",
        _ => "更新题库",
    }
    .to_string();
    if title.len() > 200 {
        title.truncate(200);
    }
    let detail = old
        .as_ref()
        .and_then(|v| v["title"].as_str())
        .or_else(|| value["title"].as_str())
        .unwrap_or("")
        .chars()
        .take(100)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    Ok(Some((title, detail)))
}
impl Repository {
    pub fn mutate(&self, channel: &str, args: &[Value]) -> R<Value> {
        let _gate = self.lock()?;
        let mut db = self.open()?.ok_or("题库不可用")?;
        let entry = label(&db, channel, args)?;
        let mut undo = self.undo.lock().map_err(|_| "撤销状态不可用")?;
        let revision: i64 = db
            .query_row(
                "SELECT value FROM tauri_meta WHERE key='mutationRevision'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "0".into())
            .parse()
            .map_err(|_| "操作序号无效")?;
        let mut next = if undo.revision == revision {
            undo.clone()
        } else {
            UndoState {
                revision,
                ..Default::default()
            }
        };
        let result = (|| {
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|e| e.to_string())?;
            let old = if ["question:save", "question:undo-review", "question:delete"]
                .contains(&channel)
            {
                let id = if channel == "question:delete" {
                    args.first().and_then(Value::as_str)
                } else {
                    args.first().and_then(|q| q["id"].as_str())
                };
                id.map(|id| get(&tx, "questions", id))
                    .transpose()?
                    .flatten()
            } else {
                None
            };
            let value = operation(&tx, &mut next, channel, args)?;
            if let Some(old) = old {
                if channel == "question:delete"
                    || channel == "question:undo-review"
                    || fingerprint(&old) != fingerprint(&value)
                    || (old["autoSolve"] == true && value["autoSolve"] != true)
                {
                    for mut job in records(&tx, "jobs")? {
                        if job["type"] == "solution"
                            && job["questionId"] == old["id"]
                            && ["queued", "processing"].iter().any(|s| job["status"] == *s)
                        {
                            job["status"] = json!("paused");
                            job["runId"] = Value::Null;
                            job["message"] = json!("题目已变化，旧解答任务已停止");
                            put(&tx, "jobs", &job)?;
                        }
                    }
                }
            }
            if !channel.starts_with("settings:") && channel != "history:record" {
                next.revision = revision.checked_add(1).ok_or("操作序号超出范围")?;
                tx.execute(
                    "INSERT OR REPLACE INTO tauri_meta VALUES('mutationRevision',?1)",
                    [next.revision.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(value)
        })();
        if result.is_ok() {
            *undo = next;
        }
        // Audit failure must not misreport a committed business operation as a failure.
        if let Some((title, detail)) = entry {
            let _ = audit(
                &db,
                &title,
                &detail,
                "operation",
                if result.is_ok() { "done" } else { "failed" },
            );
        }
        result
    }
}
