const fs=require("node:fs"), path=require("node:path"), os=require("node:os"), assert=require("node:assert/strict"), ts=require("typescript"), {randomUUID}=require("node:crypto");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {Store}=require("../src/main/store.ts"), {LibraryExchange}=require("../src/main/library-exchange.ts"), {exportArchive,inspectArchive}=require("../src/main/archive.ts"), {newQuestion,newCollection}=require("../src/shared/types.ts"), {fingerprint}=require("../src/main/fingerprint.ts");
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"matheca-exchange-test-"));
 const source=new Store(path.join(root,"source.sqlite")), target=new Store(path.join(root,"target.sqlite"));
 const original=path.join(root,"original.png"); fs.copyFileSync(path.resolve("assets/vision-test.png"),original);
 const figure="data:image/png;base64,"+fs.readFileSync(original).toString("base64");
 const q={...newQuestion("shared-q"),title:"桌面字段",body:"选图 A.1 B.2 C.3 D.4",kind:"选择题",sourcePath:original,figures:[figure],figureWidths:[80],figurePlacements:["B"],reviewed:true,solution:"答案 B"};q.solutionFingerprint=fingerprint(q);
 const c={...newCollection("shared-c","题集"),questionLayout:{[q.id]:{answerSpaceMm:60,pageBreakBefore:true}}};
 source.putQuestion(q);source.putQuestion({...newQuestion("unselected"),body:"不应传输"});source.putCollection(c);source.addQuestions(c.id,[q.id]);
 const exchange=new LibraryExchange(path.join(root,"inbox"),target,()=>{}), archive=path.join(root,"subset.zip");await exportArchive(source,archive,{questionIds:[],collectionIds:[c.id]});
 const data=await inspectArchive(archive,path.join(root,"inspect"));assert.equal(data.questions.length,1);assert.deepEqual(data.questions[0].figures,[figure]);
 async function receive(){const id=randomUUID(),file=path.join(root,id+".tmp");fs.copyFileSync(archive,file);await exchange.receive(id,"手机题库.zip",fs.statSync(file).size,file);return id}
 const first=await receive();let preview=await exchange.inspect(first);assert.equal(preview.added,2);assert.equal(target.questions().length,0);exchange.apply(first,"keep");
 assert.equal(target.questions().length,1);assert.deepEqual(target.question(q.id).figurePlacements,["B"]);assert.deepEqual(target.collection(c.id).questionLayout,c.questionLayout);assert.equal(target.question(q.id).solutionFingerprint,fingerprint(target.question(q.id)));
 const second=await receive();preview=await exchange.inspect(second);assert.equal(preview.repeated,2);exchange.apply(second,"copy");assert.equal(target.questions().length,1);assert.equal(target.collections().length,1);
 target.putQuestion({...target.question(q.id),body:"本机修改"});const third=await receive();preview=await exchange.inspect(third);assert.equal(preview.conflicts,1);exchange.apply(third,"copy");
 assert.equal(target.question(q.id).body,"本机修改");assert.equal(target.questions().length,2);assert.equal(target.collections().length,2);
 const cloneC=target.collections().find(x=>x.id!==c.id);assert.notEqual(target.items().find(i=>i.collectionId===cloneC.id).questionId,q.id);
 const fourth=await receive();await exchange.inspect(fourth);exchange.apply(fourth,"copy");assert.equal(target.questions().length,2);assert.equal(target.collections().length,2);
 const stale=await receive();await exchange.inspect(stale);target.putQuestion({...target.question(q.id),body:"再次修改"});assert.throws(()=>exchange.apply(stale,"replace"),/已变化/);await exchange.inspect(stale);exchange.apply(stale,"replace");assert.equal(target.question(q.id).body,q.body);
 const failed=await receive();await exchange.inspect(failed);const setting=target.setSetting.bind(target);target.setSetting=()=>{throw Error("injected")};assert.throws(()=>exchange.apply(failed,"replace"),/injected/);target.setSetting=setting;assert.equal(exchange.list().find(i=>i.id===failed).status,"received");assert.equal(target.question(q.id).body,q.body);
 const recovered=new LibraryExchange(path.join(root,"inbox"),target,()=>{});assert.ok(recovered.receipt(first));assert.ok(recovered.receipt(failed));assert.equal(target.jobs().length,0);
 source.close();target.close();fs.rmSync(root,{recursive:true,force:true});console.log("PASS: selective ZIP, images/layout/solution, preview, duplicates, copy/reference mapping, replacement, stale preview, rollback, durable inbox, no AI jobs");
})().catch(e=>{console.error(e);process.exitCode=1});
