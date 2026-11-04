use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;
pub static CATALOG: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../src/shared/catalog-data.json")).unwrap()
});
fn space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{001c}'..='\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}')
}
pub fn trim(s: &str) -> &str {
    s.trim_matches(space)
}
pub fn len(s: &str) -> usize {
    s.encode_utf16().count()
}
pub fn string(value: &Value, max: usize) -> Result<&str, String> {
    let s = value.as_str().ok_or("字段格式无效")?;
    if len(s) > max {
        return Err("字段内容过长".into());
    }
    Ok(s)
}
pub fn id(v: &Value) -> Result<&str, String> {
    let s = string(v, 128)?;
    if trim(s).is_empty()
        || s.chars()
            .any(|c| c <= '\u{001f}' || ('\u{007f}'..='\u{009f}').contains(&c))
    {
        return Err("编号无效".into());
    }
    Ok(s)
}
pub fn ids(v: &Value) -> Result<Vec<String>, String> {
    let a = v.as_array().ok_or("选择列表无效")?;
    if a.len() > 20000 {
        return Err("选择列表过长".into());
    }
    a.iter().map(|v| id(v).map(str::to_owned)).collect()
}
pub fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string()
}
pub fn new_question(id: &str) -> Value {
    json!({"id":id,"title":"新题目","body":"","latex":"","grade":"","kind":"解答题","difficulty":"待评估","knowledge":"","sourcePath":"","sourceLabel":"手动录入","reviewed":false,"favorite":false,"example":false,"createdAt":now(),"autoSolve":false,"solution":"","solutionLatex":"","solutionFingerprint":"","solutionError":""})
}
static PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[ \t\n\r\x0c\x0b]*(?:第[ \t]*[0-9一二三四五六七八九十百]+[ \t]*题[ \t]*[:：.．、]?|[0-9]{1,3}[ \t]*[.．、]|[（(][ \t]*[0-9]{1,3}[ \t]*[)）][ \t]*[.．、]?|[①-⑳])[ \t\n\r\x0c\x0b]*").unwrap()
});
fn prefix_end(s: &str, sub_only: bool) -> Option<usize> {
    let m = PREFIX.find(s)?;
    let token = s[..m.end()].trim();
    if sub_only
        && !token.starts_with(['（', '('])
        && !token
            .chars()
            .next()
            .is_some_and(|c| ('①'..='⑳').contains(&c))
    {
        return None;
    }
    let rest = &s[m.end()..];
    if token.starts_with(['（', '('])
        && rest.chars().next().is_some_and(|c| "+-=*/^,，".contains(c))
    {
        return None;
    }
    if token.chars().next().is_some_and(|c| c.is_ascii_digit())
        && s.char_indices()
            .find(|(_, c)| ['.', '．', '、'].contains(c))
            .is_some_and(|(i, c)| {
                s[i + c.len_utf8()..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_digit())
            })
    {
        return None;
    }
    Some(m.end())
}
pub fn clean_title(s: &str) -> String {
    let mut out = trim(s);
    for _ in 0..3 {
        if let Some(end) = prefix_end(out, false) {
            out = &out[end..];
        }
    }
    out.into()
}
fn formula_ranges(s: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < s.len() {
        let tail = &s[i..];
        let pair = if tail.starts_with("$$") {
            Some(("$$", "$$"))
        } else if tail.starts_with("\\[") {
            Some(("\\[", "\\]"))
        } else if tail.starts_with("\\(") {
            Some(("\\(", "\\)"))
        } else if tail.starts_with('$') && (i == 0 || !s[..i].ends_with(['\\', '$'])) {
            Some(("$", "$"))
        } else {
            None
        };
        if let Some((open, close)) = pair {
            if let Some(n) = s[i + open.len()..].find(close) {
                let end = i + open.len() + n + close.len();
                ranges.push((i, end));
                i = end;
                continue;
            }
        }
        i += tail.chars().next().unwrap().len_utf8();
    }
    ranges
}
pub fn clean_body(s: &str) -> String {
    let s = s.replace("\r\n", "\n").replace('\r', "\n");
    let ranges = formula_ranges(&s);
    let mut text = String::new();
    let mut cursor = 0;
    for (i, c) in s.char_indices() {
        if i < cursor {
            continue;
        }
        let next = i + c.len_utf8();
        if "。；;：:".contains(c) {
            let tail = &s[next..];
            let trimmed = tail.trim_start_matches(|c: char| c.is_ascii_whitespace());
            let n = s.len() - trimmed.len();
            if prefix_end(trimmed, true).is_some() && !ranges.iter().any(|(a, b)| n >= *a && n < *b)
            {
                text.push_str(&s[cursor..next]);
                text.push('\n');
                cursor = n;
            }
        }
    }
    text.push_str(&s[cursor..]);
    let ranges = formula_ranges(&text);
    let mut offset = 0;
    let mut marked = Vec::new();
    let mut inferred = Vec::new();
    let lines: Vec<String> = text
        .split('\n')
        .enumerate()
        .map(|(index, line)| {
            let point = offset + line.len() - line.trim_start_matches(space).len();
            let inside = ranges.iter().any(|(a, b)| point >= *a && point < *b);
            offset += line.len() + 1;
            let clean = if inside {
                line.trim_end_matches(space).into()
            } else {
                clean_title(line)
            };
            if !inside && prefix_end(line, true).is_some() {
                marked.push(index);
            }
            if !inside
                && [
                    "求",
                    "证明",
                    "判断",
                    "说明",
                    "计算",
                    "写出",
                    "解方程",
                    "解不等式",
                    "比较",
                    "讨论",
                ]
                .iter()
                .any(|p| clean.starts_with(p))
            {
                inferred.push(index);
            }
            clean
        })
        .collect();
    let first = lines.iter().position(|l| !trim(l).is_empty()).unwrap_or(0);
    let parts = if marked.is_empty() {
        inferred.into_iter().filter(|i| *i > first).collect()
    } else {
        marked
    };
    let mut n = 0;
    trim(
        &lines
            .iter()
            .enumerate()
            .map(|(i, line)| {
                if parts.len() > 1 && parts.contains(&i) {
                    n += 1;
                    format!("（{n}）{line}")
                } else {
                    line.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .into()
}
fn points(custom: &[Value]) -> Vec<String> {
    CATALOG["groups"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|v| v.as_array().unwrap())
        .chain(custom.iter().map(|p| &p["name"]))
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}
pub fn point(v: &Value, custom: &[Value]) -> Result<Value, String> {
    let group = string(&v["group"], 100)?;
    let name = trim(string(&v["name"], 100)?);
    if CATALOG["groups"].get(group).is_none() {
        return Err("请选择已有知识点分组".into());
    }
    if name.is_empty()
        || len(name) > 32
        || name
            .chars()
            .any(|c| c < ' ' || ('\u{007f}'..='\u{009f}').contains(&c) || "、,，;；|".contains(c))
    {
        return Err("知识点名称须为 1–32 字，且不含控制字符或分隔符".into());
    }
    if points(custom).iter().any(|s| s == name) || CATALOG["aliases"].get(name).is_some() {
        return Err("这个知识点已存在".into());
    }
    Ok(json!({"group":group,"name":name}))
}
pub fn review_equal(a: &Value, b: &Value) -> bool {
    [
        "title",
        "body",
        "latex",
        "grade",
        "kind",
        "difficulty",
        "knowledge",
        "figures",
        "figureWidths",
        "figurePlacements",
        "reviewed",
        "favorite",
        "autoSolve",
    ]
    .iter()
    .all(|k| a[*k] == b[*k])
}
pub fn question(
    input: &Value,
    base: &Value,
    custom: &[Value],
    confirm: bool,
) -> Result<Value, String> {
    id(&input["id"])?;
    let mut q = base.clone();
    for key in [
        "title",
        "body",
        "latex",
        "grade",
        "kind",
        "difficulty",
        "knowledge",
    ] {
        q[key] = json!(string(&input[key], 3_100_000)?);
    }
    for key in ["favorite", "autoSolve"] {
        q[key] = json!(input[key].as_bool().ok_or("布尔字段无效")?);
    }
    let title = clean_title(q["title"].as_str().unwrap());
    q["title"] = json!(if title.is_empty() {
        "新题目".to_string()
    } else {
        title
    });
    q["body"] = json!(clean_body(q["body"].as_str().unwrap()));
    for (key, list, fallback) in [
        ("grade", "grades", ""),
        ("kind", "kinds", "解答题"),
        ("difficulty", "difficulties", "待评估"),
    ] {
        if !CATALOG[list].as_array().unwrap().contains(&q[key]) {
            q[key] = json!(fallback);
        }
    }
    let allowed = points(custom);
    let mut names = Vec::new();
    for name in q["knowledge"]
        .as_str()
        .unwrap()
        .split(['、', ',', '，', ';', '；', '|', '\n'])
    {
        let name = trim(name);
        let name = CATALOG["aliases"]
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or(name);
        if allowed.iter().any(|p| p == name) && !names.contains(&name.to_string()) {
            names.push(name.to_string());
        }
    }
    q["knowledge"] = json!(names.join("、"));
    if let Some(figures) = input.get("figures") {
        let a = figures.as_array().ok_or("题目图形无效")?;
        let mut total = 0;
        if a.len() > 6 {
            return Err("每题最多 6 张 PNG 图形".into());
        }
        for image in a {
            let s = string(image, 2_800_000)?;
            total += s.len();
            let b = s
                .strip_prefix("data:image/png;base64,")
                .ok_or("题目图形无效")?;
            if b.is_empty()
                || !b
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
            {
                return Err("题目图形无效".into());
            }
        }
        if total > 8_000_000 {
            return Err("题目图形总大小超过限制".into());
        }
        q["figures"] = figures.clone();
    }
    let count = q["figures"].as_array().map_or(0, Vec::len);
    for key in ["figureWidths", "figurePlacements"] {
        if let Some(value) = input.get(key).or_else(|| base.get(key)) {
            let a = value.as_array().ok_or("图形设置无效")?;
            if a.len() != count {
                return Err("图形设置与数量不一致".into());
            }
            for v in a {
                if key == "figureWidths" {
                    let n = v.as_f64().ok_or("图形宽度无效")?;
                    if n != 0.0 && !(20.0..=160.0).contains(&n) {
                        return Err("图形宽度须为 20–160 毫米，或使用自动大小".into());
                    }
                } else if !["stem", "A", "B", "C", "D"].contains(&v.as_str().ok_or("图形位置无效")?)
                {
                    return Err("图形位置无效".into());
                }
            }
            q[key] = value.clone();
        }
    }
    let content_equal = ["title", "body", "grade", "kind", "difficulty", "knowledge"]
        .iter()
        .all(|k| base[*k] == q[*k])
        && base.get("figures").unwrap_or(&json!([])) == q.get("figures").unwrap_or(&json!([]))
        && base.get("figurePlacements").unwrap_or(&json!([]))
            == q.get("figurePlacements").unwrap_or(&json!([]));
    q["reviewed"] = json!(base["reviewed"].as_bool().unwrap_or(false) && content_equal);
    if super::repository::fingerprint(base) != super::repository::fingerprint(&q) {
        for k in [
            "solution",
            "solutionLatex",
            "solutionFingerprint",
            "solutionError",
        ] {
            q[k] = json!("");
        }
    }
    if confirm {
        if trim(q["body"].as_str().unwrap()).is_empty() {
            return Err("请先填写题干，独立公式仅用于校对".into());
        }
        q["reviewed"] = json!(true);
    }
    Ok(q)
}
pub fn collection(input: &Value, old: Option<&Value>) -> Result<Value, String> {
    id(&input["id"])?;
    let title = trim(string(&input["title"], 200)?);
    if title.is_empty() {
        return Err("题集名称须为 1–200 字".into());
    }
    let mut c = input.clone();
    c["title"] = json!(title);
    c["paperTitle"] = json!(trim(string(&input["paperTitle"], 80)?));
    c["examInstructions"] = json!(trim(string(&input["examInstructions"], 600)?));
    for (key, max) in [("examMinutes", 999), ("totalScore", 9999)] {
        let n = input[key].as_i64().ok_or("试卷设置须为整数")?;
        if !(0..=max).contains(&n) {
            return Err("试卷设置超出范围".into());
        }
    }
    if let Some(layout) = input.get("questionLayout") {
        let map = layout.as_object().ok_or("题目排版设置无效")?;
        if map.len() > 100000 {
            return Err("题目排版设置过多".into());
        }
        for (id, v) in map {
            if id.is_empty() || len(id) > 200 || !v.is_object() {
                return Err("题目排版设置无效".into());
            }
            if let Some(n) = v.get("answerSpaceMm") {
                if !n.as_i64().is_some_and(|n| (0..=160).contains(&n)) {
                    return Err("解答空间应为 0–160mm".into());
                }
            }
            if v.get("pageBreakBefore").is_some_and(|n| !n.is_boolean()) {
                return Err("题目分页设置无效".into());
            }
        }
    }
    c["createdAt"] = old
        .map(|c| c["createdAt"].clone())
        .unwrap_or_else(|| json!(now()));
    Ok(c)
}
