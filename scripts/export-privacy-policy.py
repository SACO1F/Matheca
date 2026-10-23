"""Export the exact in-app policy as Markdown and a self-contained hosting page."""
import html
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
policy = json.loads((root / "app/src/main/assets/privacy-policy.json").read_text(encoding="utf-8"))
lines = [f'# {policy["title"]}', '', f'更新与生效日期：{policy["effectiveDate"]}', '', policy['summary'], '']
parts = [f'<h1>{html.escape(policy["title"])}</h1>', f'<p>更新与生效日期：{html.escape(policy["effectiveDate"])}</p>', f'<p>{html.escape(policy["summary"])}</p>']
for section in policy['sections']:
    lines.extend([f'## {section["title"]}', ''])
    parts.append(f'<section><h2>{html.escape(section["title"])}</h2>')
    for paragraph in section['paragraphs']:
        lines.extend([paragraph, ''])
        parts.append(f'<p>{html.escape(paragraph)}</p>')
    parts.append('</section>')
parts.append(f'<p><a href="{html.escape(policy["contactUrl"])}">联系维护者（GitHub）</a></p>')
(root / 'PRIVACY.md').write_text('\n'.join(lines), encoding='utf-8')
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Matheca 隐私政策</title><style>html{color-scheme:light dark}body{max-width:720px;margin:0 auto;padding:32px 24px 64px;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.9;overflow-wrap:anywhere}h1{font-size:28px;line-height:1.5}h2{font-size:20px;margin-top:32px}a{color:inherit;text-underline-offset:4px}</style><main>''' + '\n'.join(parts) + '</main></html>\n'
(root / 'docs/privacy-policy.html').write_text(page, encoding='utf-8')
print('Exported PRIVACY.md and docs/privacy-policy.html from the shared in-app policy.')
