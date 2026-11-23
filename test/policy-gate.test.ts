import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const controller = "../scripts/policy-gate.mjs";
const { validJobs, sameRun, validBinding, unpackObservation, gate } = await import(controller);
test("requires each expected job exactly once and successful", () => {
 const jobs = ["merge-inputs", "build-and-test", "wikidata-evidence", "reader-observations", "reader-compatibility"].map(name => ({name, conclusion:"success"}));
 assert.equal(validJobs(jobs), true);
 assert.equal(validJobs(jobs.slice(1)), false);
 assert.equal(validJobs([...jobs, jobs[0]]), false);
 assert.equal(validJobs(jobs.map((j,i) => i ? j : {...j, conclusion:"skipped"})), false);
});
test("run must match the PR head and association while the base is bound separately", () => {
 const pr = {head:{sha:"head"}, base:{sha:"base"}};
 const run = {event:"pull_request", head_sha:"head", pull_requests:[{number:1,head:{sha:"head"},base:{sha:"base"}}]};
 assert.equal(sameRun(run, pr, 1), true);
 assert.equal(sameRun({...run, head_sha:"old"}, pr, 1), false);
 assert.equal(sameRun({...run, pull_requests:[{number:1,head:{sha:"head"},base:{sha:"old"}}]},pr,1),true);
});
test("rejects non-zip input", () => assert.throws(() => unpackObservation(Buffer.from("bad"))));
function fixture(runs: unknown[] = []) {
 const statuses: unknown[] = [];
 const pr = {number:1,state:"open",mergeable:true as boolean|null,merge_commit_sha:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",head:{sha:"head"},base:{sha:"base",ref:"main",repo:{full_name:"owner/repo"}}};
 const actions = {
  listWorkflowRuns: async () => ({data:runs}),
  getWorkflowRun: async () => ({data:runs[0]}),
  listJobsForWorkflowRunAttempt: async (): Promise<{data:unknown[]}> => ({data:[]}),
 };
 const github = {rest:{actions,pulls:{get:async()=>({data:pr})},repos:{getBranch:async()=>({data:{commit:{sha:"base"}}}),createCommitStatus:async(s:unknown)=>statuses.push(s)}},paginate:async(fn:()=>Promise<{data:unknown}>)=>(await fn()).data};
 const context={repo:{owner:"owner",repo:"repo"},eventName:"pull_request_target",payload:{pull_request:pr,repository:{default_branch:"main"}}};
 return {github,context,statuses,pr};
}
test("absent workflow leaves the current head pending",async()=>{
 const f=fixture(); await gate(f);
 assert.deepEqual(f.statuses.map((s:any)=>[s.sha,s.state]),[["head","pending"]]);
});
test("failed required jobs cannot approve a successful run",async()=>{
 const f=fixture([{id:7,run_attempt:1,status:"completed",conclusion:"success",event:"pull_request",head_sha:"head",path:".github/workflows/check.yml",pull_requests:[{number:1,head:{sha:"head"},base:{sha:"base"}}]}]);
 await gate({...f,verify:()=>assert.fail("must not verify missing jobs")});
 assert.equal((f.statuses.at(-1) as any).state,"failure");
});
test("an old completion cannot overwrite a newer run",async()=>{
 const f=fixture([{id:8,run_attempt:1,status:"completed",head_sha:"head"}]);
 Object.assign(f.context,{eventName:"workflow_run",payload:{repository:{default_branch:"main"},workflow_run:{id:7,run_attempt:1,event:"pull_request",head_sha:"head",repository:{full_name:"owner/repo"},pull_requests:[{number:1}]}}});
 await gate(f); assert.deepEqual(f.statuses,[]);
});
test("base changing during verification prevents a stale status",async()=>{
 const f=fixture([{id:7,run_attempt:1,status:"completed",conclusion:"failure",event:"pull_request",head_sha:"head",path:".github/workflows/check.yml",pull_requests:[]}]);
 let calls=0;
 f.github.rest.repos.getBranch=async()=>({data:{commit:{sha:++calls<3?'base':'new-base'}}});
 await gate(f);
 assert.deepEqual(f.statuses.map((s:any)=>s.state),["pending"]);
});

test("zip accepts only one bounded regular canonical file", () => {
 const zip = (names: string[], symlink=false, large=false) => execFileSync("python3",["-c", `import io,zipfile,sys,json\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED) as z:\n for name in json.loads(sys.argv[1]):\n  f=zipfile.ZipInfo(name)\n  if sys.argv[2]=="true": f.external_attr=0o120777<<16\n  z.writestr(f,b"x"*(8388609 if sys.argv[3]=="true" else 2))\nsys.stdout.buffer.write(b.getvalue())`,JSON.stringify(names),String(symlink),String(large)],{maxBuffer:10*1024*1024});
 assert.equal(unpackObservation(zip(["reader-results.json"])).toString(),"xx");
 assert.throws(()=>unpackObservation(zip(["reader-binding.json"])));
 assert.equal(unpackObservation(zip(["reader-binding.json"]),"reader-binding.json").toString(),"xx");
 for(const names of [["../reader-results.json"],["reader-results.json","extra"]]) assert.throws(()=>unpackObservation(zip(names)));
 assert.throws(()=>unpackObservation(zip(["reader-results.json"],true)));
 assert.throws(()=>unpackObservation(zip(["reader-results.json"],false,true)));
});


test("the controller always checks proposed data using only base code", () => {
 const temp = mkdtempSync(join(tmpdir(), "gate-commands-"));
 try {
  const bin = join(temp,"bin"), log = join(temp,"commands.jsonl"); mkdirSync(bin);
  const script = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const command=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.GATE_LOG,JSON.stringify({command,args,cwd:process.cwd()})+'\\n');
if(command==='git'&&args[0]==='show') process.stdout.write(process.env.BAD_PARENTS==='true'?'stale head':'base head');
if(command==='git'&&args[0]==='worktree'&&args[1]==='add') fs.mkdirSync(args[3],{recursive:true});
if(command==='node') {
 const out=args[args.indexOf('--output')+1]; fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({mode:'reader-compatibility',passed:true,checkedLookups:1}));
}
`;
  for(const name of ['git','npm','node']) writeFileSync(join(bin,name),script,{mode:0o755});
  for(const badParents of [false,true]) {
   writeFileSync(log,'');
   const run = () => execFileSync(process.execPath,['--input-type=module','-e',`import {verifyObservation} from ${JSON.stringify(new URL('../scripts/policy-gate.mjs',import.meta.url).href)}; verifyObservation(Buffer.from('{}'),{head:{sha:'head'},base:{sha:'base'},merge_commit_sha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},{owner:'owner',repo:'repo'},{schemaVersion:1,mergeSha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',baseSha:'base',headSha:'head'});`],{env:{...process.env,PATH:bin,GATE_LOG:log,BAD_PARENTS:String(badParents)}});
   if(badParents) assert.throws(run); else run();
   const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
   const judges=calls.filter(c=>c.command==='node');
   if(badParents) { assert.equal(judges.length,0); assert(!calls.some(c=>c.command==='git'&&c.args[0]==='worktree'&&c.args[1]==='add'&&c.args[3].endsWith('/proposed'))); continue; }
   assert.equal(judges.length,1);
   assert(judges.every(c=>c.cwd.endsWith('/base')));
   assert(!judges[0].args.includes('--offline'));
   assert(calls.filter(c=>c.command==='npm').every(c=>c.cwd.endsWith('/base')));
   assert(judges[0].args[judges[0].args.indexOf('--corpus')+1].endsWith('/proposed'));
   assert(calls.some(c=>c.command==='git'&&c.args[0]==='fetch'&&c.args.at(-1)==='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  }
 } finally {rmSync(temp,{recursive:true,force:true});}
});


function completedFixture() {
 const run={id:8,run_attempt:1,status:'completed',conclusion:'success',event:'pull_request',head_sha:'head',path:'.github/workflows/check.yml',pull_requests:[{number:1,head:{sha:'head'},base:{sha:'base'}}]};
 const f=fixture([run]);
 const zip=(name:string,value:string)=>execFileSync('python3',['-c',"import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr(sys.argv[1],sys.argv[2]); z.close(); sys.stdout.buffer.write(b.getvalue())",name,value]);
 const archive=zip('reader-results.json','{}');
 const binding=zip('reader-binding.json',JSON.stringify({schemaVersion:1,mergeSha:f.pr.merge_commit_sha,baseSha:'base',headSha:'head'}));
 f.github.rest.actions.listJobsForWorkflowRunAttempt=async()=>({data:['merge-inputs','build-and-test','wikidata-evidence','reader-observations','reader-compatibility'].map(name=>({name,conclusion:'success'}))});
 Object.assign(f.github.rest.actions,{
  listWorkflowRunArtifacts:async()=>({data:[{id:1,name:'reader-observations',expired:false,size_in_bytes:archive.length,workflow_run:{id:8,head_sha:'head'}},{id:2,name:'reader-binding',expired:false,size_in_bytes:binding.length,workflow_run:{id:8,head_sha:'head'}}]}),
  downloadArtifact:async({artifact_id}:any)=>({data:artifact_id===1?archive:binding}),
 });
 return f;
}

test("unknown mergeability is polled before judging the completed run", async () => {
 const f=completedFixture(); let calls=0, verified=false;
 f.github.rest.pulls.get=async()=>({data:{...f.pr,mergeable:++calls===1?null:true}});
 await gate({...f,verify:()=>{verified=true;}});
 assert.equal(verified,true);
 assert(calls>=2);
 assert.equal((f.statuses.at(-1) as any).state,'success');
});

test("unresolved mergeability remains pending without invoking the verifier", async () => {
 const f=completedFixture(); let calls=0;
 f.github.rest.pulls.get=async()=>{calls++;return {data:{...f.pr,mergeable:null}};};
 await gate({...f,verify:()=>assert.fail('unknown mergeability cannot be approved')});
 assert(calls>1);
 assert.deepEqual(f.statuses.map((s:any)=>[s.state,s.description]),[['pending','Waiting for GitHub to compute the merge commit']]);
});

test("a changed head during mergeability polling cannot receive a stale status", async () => {
 const f=completedFixture(); let calls=0;
 f.github.rest.pulls.get=async()=>({data:++calls===1?{...f.pr,mergeable:null}:{...f.pr,head:{sha:'new-head'},mergeable:true}});
 await gate({...f,verify:()=>assert.fail('changed head must stop verification')});
 assert.deepEqual(f.statuses,[]);
});

test("unknown mergeability cannot let an old completion overwrite a newer success", async () => {
 const f=fixture([{id:8,run_attempt:1,status:'completed',conclusion:'success',head_sha:'head'}]);
 let calls=0;
 f.github.rest.pulls.get=async()=>{calls++;return {data:{...f.pr,mergeable:null}};};
 Object.assign(f.context,{eventName:'workflow_run',payload:{repository:{default_branch:'main'},workflow_run:{id:7,run_attempt:1,event:'pull_request',head_sha:'head',repository:{full_name:'owner/repo'},pull_requests:[{number:1}]}}});
 await gate(f);
 assert.deepEqual(f.statuses,[]);
 assert.equal(calls,1,'stale events must be discarded before mergeability polling');
});


test("observation binding requires the actual protected tip, current head and merge", () => {
 const pr={head:{sha:'head'},merge_commit_sha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
 const binding={schemaVersion:1,mergeSha:pr.merge_commit_sha,baseSha:'base',headSha:'head'};
 assert.equal(validBinding(binding,pr,'base'),true);
 for(const change of [{baseSha:'recorded-old-base'},{headSha:'other-head'},{mergeSha:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},{schemaVersion:2},{passed:true}]) assert.equal(validBinding({...binding,...change},pr,'base'),false);
});

test("a recorded PR base can lag the protected tip without selecting an old verifier", async () => {
 const f=completedFixture(); f.pr.base.sha='recorded-old-base';
 const recorded=(await f.github.rest.actions.getWorkflowRun()).data as any;
 recorded.pull_requests[0].base.sha='recorded-old-base';
 let checked:any;
 await gate({...f,verify:(_bytes:any,pr:any,_repo:any,binding:any)=>{checked={pr,binding};}});
 assert.equal((f.statuses.at(-1) as any).state,'success');
 assert.equal(checked.pr.base.sha,'base');
 assert.equal(checked.binding.baseSha,'base');
});

test("stale PR-target events never act on the current head in another concurrency group", async () => {
 const f=completedFixture();
 f.context.payload.pull_request={...f.pr,head:{sha:'old-head'}};
 await gate({...f,verify:()=>assert.fail('stale event must not verify another head')});
 assert.deepEqual(f.statuses,[]);
});


test("missing observation binding cannot invoke the trusted verifier", async () => {
 const f=completedFixture();
 Object.assign(f.github.rest.actions,{listWorkflowRunArtifacts:async()=>({data:[{id:1,name:'reader-observations',expired:false,size_in_bytes:100,workflow_run:{id:8,head_sha:'head'}}]})});
 await gate({...f,verify:()=>assert.fail('missing binding must fail closed')});
 assert.equal((f.statuses.at(-1) as any).state,'failure');
});
