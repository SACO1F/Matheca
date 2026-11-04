use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{Cursor, Write},
    sync::atomic::{AtomicBool, Ordering},
};
type R<T> = Result<T, String>;
pub struct Formula {
    pub png: Vec<u8>,
    pub width: f64,
    pub height: f64,
}
pub fn formula_key(part: &Value) -> String {
    format!(
        "{}{}",
        part["display"] == true,
        part["latex"].as_str().unwrap_or("")
    )
}
fn xml(s: &str) -> String {
    s.chars()
        .filter(|c| {
            matches!(*c, '\t' | '\n' | '\r') || (*c >= ' ' && *c != '\u{fffe}' && *c != '\u{ffff}')
        })
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn text(s: &str) -> String {
    s.split('\n')
        .enumerate()
        .map(|(i, line)| {
            format!(
                "{}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>",
                if i > 0 { "<w:r><w:br/></w:r>" } else { "" },
                xml(line)
            )
        })
        .collect()
}
fn paragraph(content: &str, props: &str) -> String {
    format!("<w:p><w:pPr>{props}</w:pPr>{content}</w:p>")
}
struct Writer {
    media: Vec<Vec<u8>>,
    bytes: usize,
}
impl Writer {
    fn image(
        &mut self,
        bytes: &[u8],
        width: f64,
        height: f64,
        description: &str,
        formula: bool,
    ) -> R<String> {
        if !width.is_finite()
            || !height.is_finite()
            || width <= 0.
            || height <= 0.
            || width > 1000.
            || height > 2000.
        {
            return Err("文档图片尺寸无效".into());
        }
        self.bytes += bytes.len();
        if self.bytes > 128 * 1024 * 1024 || self.media.len() >= 5000 {
            return Err("文档图片过多或过大，请拆分题集".into());
        }
        self.media.push(bytes.to_vec());
        let id = self.media.len();
        let cx = (width * 9525.).round() as u64;
        let cy = (height * 9525.).round() as u64;
        let position = if formula {
            format!(
                "<w:rPr><w:position w:val=\"{}\"/></w:rPr>",
                -((height * 0.375 - 4.).max(0.) * 2.).round() as i64
            )
        } else {
            String::new()
        };
        Ok(format!(
            r#"<w:r>{position}<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{id}" name="{} {id}" descr="{}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{id}" name="image{id}.png"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdI{id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
            if formula {
                "数学公式"
            } else {
                "题目图形"
            },
            xml(description)
        ))
    }
    fn runs(&mut self, parts: &Value, formulas: &HashMap<String, Formula>) -> R<String> {
        let mut out = String::new();
        for part in parts.as_array().ok_or("题目排版数据无效")? {
            if part["type"] == "text" {
                out.push_str(&text(part["value"].as_str().ok_or("题目文字无效")?));
            } else if part["type"] == "formula" {
                let f = formulas.get(&formula_key(part)).ok_or("公式图片缺失")?;
                let scale = (686.6666667 / f.width).min(1.);
                if part["display"] == true {
                    out.push_str("<w:r><w:br/></w:r>");
                }
                out.push_str(&self.image(
                    &f.png,
                    f.width * scale,
                    f.height * scale,
                    part["latex"].as_str().unwrap_or(""),
                    true,
                )?);
                if part["display"] == true {
                    out.push_str("<w:r><w:br/></w:r>");
                }
            } else {
                return Err("题目片段类型无效".into());
            }
        }
        Ok(out)
    }
    fn figure(&mut self, q: &Value, index: usize, max_width: f64) -> R<String> {
        let url = q["figures"]
            .get(index)
            .and_then(Value::as_str)
            .ok_or("配图编号无效")?;
        let (prefix, data) = url.split_once(',').ok_or("配图数据无效")?;
        if ![
            "data:image/png;base64",
            "data:image/jpeg;base64",
            "data:image/webp;base64",
        ]
        .contains(&prefix)
            || data.len() > 7 * 1024 * 1024
        {
            return Err("配图格式无效或过大".into());
        }
        let image = crate::media::decode(&STANDARD.decode(data).map_err(|_| "配图编码无效")?)?;
        let w = f64::from(image.width());
        let h = f64::from(image.height());
        let mm = q["figureWidths"]
            .get(index)
            .and_then(Value::as_f64)
            .unwrap_or(0.);
        let scale = if mm > 0. {
            mm * 96. / 25.4 / w
        } else {
            (max_width / w).min(360. / h).min(1.)
        };
        let fit = (max_width / (w * scale)).min(1.);
        let drawing = self.image(
            &crate::media::png(&image)?,
            w * scale * fit,
            h * scale * fit,
            "从来源原图提取的图形",
            false,
        )?;
        Ok(paragraph(
            &drawing,
            "<w:keepNext/><w:spacing w:after=\"200\"/>",
        ))
    }
}
const XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;
pub fn build(
    questions: &[Value],
    collection: &Value,
    plan: &Value,
    formulas: &HashMap<String, Formula>,
    cancel: &AtomicBool,
) -> R<Vec<u8>> {
    let parts = plan["parts"]
        .as_array()
        .filter(|p| p.len() == questions.len())
        .ok_or("题目排版数量不匹配")?;
    let mut writer = Writer {
        media: Vec::new(),
        bytes: 0,
    };
    let mut body = String::new();
    let title = collection["paperTitle"].as_str().unwrap_or("");
    if !title.is_empty() {
        body.push_str(&paragraph(&text(title),"<w:pStyle w:val=\"Title\"/><w:jc w:val=\"center\"/><w:spacing w:after=\"240\"/><w:rPr><w:b/><w:sz w:val=\"40\"/></w:rPr>"));
    }
    let mut summary = Vec::new();
    if collection["examMinutes"].as_u64().unwrap_or(0) > 0 {
        summary.push(format!("考试时间：{} 分钟", collection["examMinutes"]));
    }
    if collection["totalScore"].as_u64().unwrap_or(0) > 0 {
        summary.push(format!("满分：{} 分", collection["totalScore"]));
    }
    if !summary.is_empty() {
        body.push_str(&paragraph(
            &text(&summary.join("    "))
                .replace("<w:r>", "<w:r><w:rPr><w:sz w:val=\"22\"/></w:rPr>"),
            "<w:jc w:val=\"center\"/><w:spacing w:after=\"240\"/>",
        ));
    }
    let instructions = collection["examInstructions"].as_str().unwrap_or("");
    if !instructions.is_empty() {
        body.push_str(&paragraph(
            &text(&format!("考试说明：\n{instructions}")),
            "<w:spacing w:after=\"480\"/>",
        ));
    }
    for (i, (q, p)) in questions.iter().zip(parts).enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("应用正在退出，已停止导出".into());
        }
        let rows = p["rows"].as_array().ok_or("选项排版数据无效")?;
        let page_break = i > 0
            && collection["questionLayout"][q["id"].as_str().unwrap_or("")]["pageBreakBefore"]
                == true;
        let stem = writer.runs(&p["stem"], formulas)?;
        body.push_str(&paragraph(
            &stem,
            &format!(
                "<w:keepNext/>{}<w:spacing w:after=\"{}\" w:line=\"360\"/>",
                if page_break {
                    "<w:pageBreakBefore/>"
                } else {
                    ""
                },
                if rows.is_empty() { 0 } else { 120 }
            ),
        ));
        let content = &plan["content"][i];
        for index in content["stemFigures"]
            .as_array()
            .ok_or("题干配图数据无效")?
        {
            body.push_str(&writer.figure(
                q,
                index.as_u64().ok_or("配图编号无效")? as usize,
                480.,
            )?);
        }
        for row in rows {
            let cells = row
                .as_array()
                .filter(|a| !a.is_empty() && a.len() <= 4)
                .ok_or("选项行无效")?;
            let mut grid = String::new();
            let mut entries = String::new();
            for cell in cells {
                let index = cell["index"]
                    .as_u64()
                    .filter(|n| *n < 4)
                    .ok_or("选项编号无效")? as usize;
                let width = cell["cellWidth"]
                    .as_f64()
                    .filter(|n| n.is_finite() && *n > 0. && *n <= 515.)
                    .ok_or("选项宽度无效")?;
                let content_width = cell["contentWidth"]
                    .as_f64()
                    .filter(|n| n.is_finite() && *n > 0. && *n <= width)
                    .ok_or("选项内容宽度无效")?;
                let twips = (width * 20.).round() as u32;
                let right = ((width - content_width) * 20.).round() as u32;
                grid.push_str(&format!("<w:gridCol w:w=\"{twips}\"/>"));
                let runs = writer.runs(&p["options"][index], formulas)?;
                let mut paragraphs = paragraph(&runs, "<w:keepNext/><w:spacing w:line=\"360\"/>");
                for figure in content["options"][index]["figures"]
                    .as_array()
                    .ok_or("选项配图数据无效")?
                {
                    paragraphs.push_str(&writer.figure(
                        q,
                        figure.as_u64().ok_or("配图编号无效")? as usize,
                        content_width * 4. / 3.,
                    )?);
                }
                entries.push_str(&format!(r#"<w:tc><w:tcPr><w:tcW w:w="{twips}" w:type="dxa"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar></w:tcPr>{paragraphs}</w:tc>"#));
            }
            body.push_str(&format!(r#"<w:tbl><w:tblPr><w:tblW w:w="10300" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>{grid}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>{entries}</w:tr></w:tbl>"#));
        }
        let space = plan["spaces"][i]
            .as_f64()
            .filter(|n| n.is_finite() && (0.0..=160.0).contains(n))
            .ok_or("解答空间无效")?;
        if space > 0. {
            body.push_str(&paragraph("",&format!("<w:keepLines/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"{}\" w:lineRule=\"exact\"/>",(space*1440./25.4).round()as u32)));
        }
    }
    let document = format!(
        r#"{XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{body}<w:sectPr><w:pgSz w:w="11900" w:h="16840"/><w:pgMar w:top="800" w:bottom="800" w:left="800" w:right="800" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    );
    let styles = format!(
        r#"{XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style></w:styles>"#
    );
    let mut rels = format!(
        r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#
    );
    for i in 1..=writer.media.len() {
        rels.push_str(&format!(r#"<Relationship Id="rIdI{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{i}.png"/>"#));
    }
    rels.push_str("</Relationships>");
    let types = format!(
        r#"{XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#
    );
    let roots = format!(
        r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#
    );
    let core = format!(
        r#"{XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Matheca</dc:creator><dc:title>{}</dc:title></cp:coreProperties>"#,
        xml(title)
    );
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, value) in [
        ("[Content_Types].xml", types),
        ("_rels/.rels", roots),
        ("word/document.xml", document),
        ("word/styles.xml", styles),
        ("word/_rels/document.xml.rels", rels),
        ("docProps/core.xml", core),
    ] {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(value.as_bytes()).map_err(|e| e.to_string())?;
    }
    for (i, image) in writer.media.iter().enumerate() {
        zip.start_file(format!("word/media/image{}.png", i + 1), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(image).map_err(|e| e.to_string())?;
    }
    let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Word 文档超过 32 MiB，请拆分题集".into());
    }
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn xml_text_is_escaped_and_preserves_line_breaks() {
        assert!(text("甲<&\n乙").contains("甲&lt;&amp;"));
        assert!(text("甲\n乙").contains("w:br"));
        assert!(!xml("a\0b").contains('\0'));
    }
}
