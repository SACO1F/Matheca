import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const source=path.resolve(process.argv[2]);assert.ok(source.includes("test-output"));
const exe=fs.readFileSync("releases/latest.txt","utf8").match(/^EXE: (.+)$/m)[1].trim();
const output=path.resolve(`test-output/tauri-phase6-exchange-${Date.now()}`);fs.mkdirSync(output,{recursive:true});
const target=path.join(output,"electron-roundtrip.zip");const env={...process.env,MATHECA_TEST_DATA:path.join(output,"appdata")};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:exe,args:[],env});
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.matheca);
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
 const preview=await page.evaluate(()=>window.matheca.inspectBackup());assert.equal(preview.questions,9);assert.equal(preview.images,1);
 const restored=await page.evaluate(t=>window.matheca.restoreBackup(t),preview.token);assert.equal(restored.questions,9);assert.equal(restored.collections,1);
 const state=await page.evaluate(()=>window.matheca.state());assert.equal(state.items.length,9);assert.equal(state.customKnowledge.length,1);assert.equal(state.settings.hasApiKey,false);assert.equal(state.jobs.length,0);
 await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
 const exported=await page.evaluate(()=>window.matheca.exportBackup());assert.equal(exported.missingImages,0);
 fs.writeFileSync(path.join(output,"REPORT.md"),`# Tauri → Electron → ZIP exchange\n\nTauri archive: ${source}\nElectron: ${exe}\nOutput: ${target}\n\nPASS: 9 questions, 1 collection, 9 placements, 1 custom knowledge point and source image imported. No settings, API keys or jobs imported. Electron re-export succeeded.\n`);
 console.log("ROUNDTRIP: "+target);console.log("Evidence: "+output);
}finally{await app.close();}
