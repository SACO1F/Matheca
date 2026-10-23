import {cp,mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const html=await readFile(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
 const url=match[1];if(/^(https?:|data:)/.test(url))continue;
 await stat(path.join(root,url));
}
for(const stylesheet of ['style.css','assets/fonts/fonts.css','assets/katex/katex.min.css']){
 const css=await readFile(path.join(root,stylesheet),'utf8');
 for(const match of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)){
  if(/^(https?:|data:)/.test(match[1]))continue;
  await stat(path.resolve(root,path.dirname(stylesheet),match[1]));
 }
}
await mkdir(path.join(root,'dist'),{recursive:true});
for(const file of ['index.html','style.css','main.js','assets'])await cp(path.join(root,file),path.join(root,'dist',file),{recursive:true,filter:source=>!source.endsWith('.json')&&!source.endsWith('.prompt.txt')&&!['source-question.png','source-detail.png'].includes(path.basename(source))});
console.log('Built complete static website in dist/. All local HTML, stylesheet, image and font references exist.');
