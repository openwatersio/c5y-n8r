import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const controller = "../scripts/policy-gate.mjs";
const { validJobs, sameRun, unpackObservation, gate } = await import(controller);
test("requires each expected job exactly once and successful", () => {
 const jobs = ["build-and-test", "wikidata-evidence", "reader-observations", "reader-compatibility"].map(name => ({name, conclusion:"success"}));
 assert.equal(validJobs(jobs), true);
 assert.equal(validJobs(jobs.slice(1)), false);
 assert.equal(validJobs([...jobs, jobs[0]]), false);
 assert.equal(validJobs(jobs.map((j,i) => i ? j : {...j, conclusion:"skipped"})), false);
});
test("run must match current PR head and base", () => {
 const pr = {head:{sha:"head"}, base:{sha:"base"}};
 const run = {event:"pull_request", head_sha:"head", pull_requests:[{number:1,head:{sha:"head"},base:{sha:"base"}}]};
 assert.equal(sameRun(run, pr, 1), true);
 assert.equal(sameRun({...run, head_sha:"old"}, pr, 1), false);
 assert.equal(sameRun({...run, pull_requests:[{number:1,head:{sha:"head"},base:{sha:"old"}}]},pr,1),false);
});
test("rejects non-zip input", () => assert.throws(() => unpackObservation(Buffer.from("bad"))));
function fixture(runs: unknown[] = []) {
 const statuses: unknown[] = [];
 const pr = {number:1,state:"open",head:{sha:"head"},base:{sha:"base",ref:"main",repo:{full_name:"owner/repo"}}};
 const actions = {
  listWorkflowRuns: async () => ({data:runs}),
  getWorkflowRun: async () => ({data:runs[0]}),
  listJobsForWorkflowRunAttempt: async () => ({data:[]}),
 };
 const github = {rest:{actions,pulls:{get:async()=>({data:pr})},repos:{createCommitStatus:async(s:unknown)=>statuses.push(s)}},paginate:async(fn:()=>Promise<{data:unknown}>)=>(await fn()).data};
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
 f.github.rest.pulls.get=async()=>({data:++calls===1 ? {...f.pr,base:{...f.pr.base}} : {...f.pr,base:{...f.pr.base,sha:"new-base"}}});
 await gate(f);
 assert.deepEqual(f.statuses.map((s:any)=>s.state),["pending"]);
});

test("zip accepts only one bounded regular canonical file", () => {
 const zip = (names: string[], symlink=false, large=false) => execFileSync("python3",["-c", `import io,zipfile,sys,json\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED) as z:\n for name in json.loads(sys.argv[1]):\n  f=zipfile.ZipInfo(name)\n  if sys.argv[2]=="true": f.external_attr=0o120777<<16\n  z.writestr(f,b"x"*(8388609 if sys.argv[3]=="true" else 2))\nsys.stdout.buffer.write(b.getvalue())`,JSON.stringify(names),String(symlink),String(large)],{maxBuffer:10*1024*1024});
 assert.equal(unpackObservation(zip(["reader-results.json"])).toString(),"xx");
 for(const names of [["../reader-results.json"],["reader-results.json","extra"]]) assert.throws(()=>unpackObservation(zip(names)));
 assert.throws(()=>unpackObservation(zip(["reader-results.json"],true)));
 assert.throws(()=>unpackObservation(zip(["reader-results.json"],false,true)));
});
