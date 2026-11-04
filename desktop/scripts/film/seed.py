# 用 phase1 合成夹具的 schema 生成发布片专用隔离题库（不触碰正常题库）
import argparse
import json
import shutil
import sqlite3
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--fixture", required=True)
p.add_argument("--seed", required=True)
p.add_argument("--out", required=True)
p.add_argument("--assets", required=True)
a = p.parse_args()

out = Path(a.out)
out.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(a.fixture, out)

# 应用只从数据目录内取原图，素材统一复制到 <数据目录>/sources
sources = out.parent / "sources"
sources.mkdir(exist_ok=True)
data = json.loads(Path(a.seed).read_text(encoding="utf-8"))
for q in data["questions"]:
    src = Path(q["sourcePath"])
    if src.exists():
        target = sources / src.name
        shutil.copyfile(src, target)
        q["sourcePath"] = str(target)
    else:
        print("missing asset:", src)
db = sqlite3.connect(out)
for table in (
    "questions",
    "collections",
    "items",
    "knowledge",
    "jobs",
    "pages",
    "batches",
    "history",
    "settings",
):
    db.execute(f"DELETE FROM {table}")

for q in data["questions"]:
    db.execute(
        "INSERT INTO questions(id,createdAt,data) VALUES(?,?,?)",
        (q["id"], q["createdAt"], json.dumps(q, ensure_ascii=False)),
    )
for c in data["collections"]:
    db.execute(
        "INSERT INTO collections(id,createdAt,data) VALUES(?,?,?)",
        (c["id"], c["createdAt"], json.dumps(c, ensure_ascii=False)),
    )
    for i, qid in enumerate(data["items"][c["id"]]):
        db.execute(
            "INSERT INTO items(collectionId,questionId,position) VALUES(?,?,?)",
            (c["id"], qid, i),
        )
for k in data["knowledge"]:
    db.execute(
        "INSERT INTO knowledge(name,data) VALUES(?,?)",
        (k["name"], json.dumps(k, ensure_ascii=False)),
    )
# 主题色不直接写 settings 表：该表由应用加密保存，改由 setColorTheme 走正规通道。
db.commit()
counts = {
    t: db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    for t in ("questions", "collections", "items", "knowledge")
}
schema = db.execute("PRAGMA user_version").fetchone()[0]
print(json.dumps({"schema": schema, **counts}, ensure_ascii=False))
db.close()
