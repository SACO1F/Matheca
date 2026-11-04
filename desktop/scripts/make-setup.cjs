const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const latest = fs.readFileSync(path.join(root, 'releases/latest-tauri.txt'), 'utf8');
const exe = latest.match(/^EXE: (.+)$/m)[1].trim();
const payload = path.dirname(exe), output = path.dirname(payload);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const source = path.join(root, 'tauri/installer');
const files = [], dirs = new Set();
function walk(dir, rel = '') {
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    const name = path.join(rel, item.name);
    if(item.isDirectory()) {dirs.add(name);walk(path.join(dir,item.name),name);}
    else files.push(name);
  }
}
walk(payload);
fs.writeFileSync(path.join(source,'uninstall-files.nsh'), '\ufeff'+files.map(f=>`Delete "$INSTDIR\\${f}"`).join('\n')+'\n'+[...dirs].sort((a,b)=>b.length-a.length).map(d=>`RMDir "$INSTDIR\\${d}"`).join('\n')+'\n');
const installer = path.join(output,`Matheca-Tauri-${version}-x64-Setup.exe`);
const compiler = process.env.MATHECA_NSIS || path.join(process.env.LOCALAPPDATA,'tauri/NSIS/makensis.exe');
const result = cp.spawnSync(compiler,[`/DVERSION=${version}`,`/DPAYLOAD=${payload}`,`/DOUTPUT=${installer}`,path.join(source,'matheca.nsi')],{stdio:'inherit'});
if(result.error) throw result.error;
if(result.status !== 0) process.exit(result.status || 1);
const sumFile=path.join(output,'SHA256SUMS.txt');
const rows=fs.readFileSync(sumFile,'utf8').trim().split(/\r?\n/).filter(s=>!s.endsWith(path.basename(installer)));
rows.push(crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex')+'  '+path.basename(installer));
fs.writeFileSync(sumFile,rows.join('\n')+'\n');
console.log('SETUP: '+installer);
