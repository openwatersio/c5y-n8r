import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const expected = ["build-and-test", "wikidata-evidence", "reader-observations", "reader-compatibility"];
const limit = 8 * 1024 * 1024;
export function validJobs(jobs) {
 return expected.every(name => jobs.filter(job => job.name === name).length === 1 && jobs.find(job => job.name === name).conclusion === "success");
}
export function sameRun(run, pr, number) {
 return run.event === "pull_request" && run.head_sha === pr.head.sha && run.pull_requests.some(p => p.number === number && p.head.sha === pr.head.sha && p.base.sha === pr.base.sha);
}
export function unpackObservation(bytes) {
 if (bytes.length > limit) throw Error("Compressed artifact too large");
 return execFileSync("python3", ["-c", `import sys,io,zipfile,stat
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read(${limit + 1})))
a=z.infolist()
if len(a)!=1: raise ValueError("Expected exactly one file")
f=a[0]
if f.filename!="reader-results.json" or f.is_dir() or stat.S_ISLNK(f.external_attr>>16) or f.file_size>${limit}: raise ValueError("Unsafe artifact entry")
b=z.read(f)
if len(b)>${limit}: raise ValueError("Artifact too large")
sys.stdout.buffer.write(b)`], { input:bytes, timeout:10000, maxBuffer:limit, stdio:["pipe","pipe","pipe"] });
}
export function verifyObservation(bytes, pr, repo) {
 const temp = mkdtempSync(join(tmpdir(), "country-policy-"));
 const base = join(temp, "base");
 const run = (cmd,args,options={}) => execFileSync(cmd,args,{timeout:120000,maxBuffer:1024*1024,...options});
 try {
  // Only the current base commit supplies executable code and dependencies.
  run("git",["fetch","--no-tags",`https://github.com/${repo.owner}/${repo.repo}.git`,pr.base.sha]);
  run("git",["worktree","add","--detach",base,pr.base.sha]);
  writeFileSync(join(temp,"reader-results.json"),bytes);
  run("npm",["ci","--ignore-scripts"],{cwd:base});
  run("node",["--import","tsx","scripts/check-evidence.ts","--offline","--corpus",".","--base",".","--reader-results",join(temp,"reader-results.json"),"--output",join(temp,"report")],{cwd:base});
  const report = JSON.parse(readFileSync(join(temp,"report","report.json"),"utf8"));
  if (report.mode !== "reader-compatibility" || report.passed !== true || !(report.checkedLookups > 0)) throw Error("Trusted verifier did not approve observations");
 } finally {
  try { run("git",["worktree","remove","--force",base]); } finally { rmSync(temp,{recursive:true,force:true}); }
 }
}
export async function gate({github, context, verify=verifyObservation}) {
 const repo = context.repo;
 const api = github.rest;
 const incoming = context.payload.workflow_run;
 let numbers;
 if (context.eventName === "pull_request_target") numbers = [context.payload.pull_request.number];
 else {
  if (incoming.event !== "pull_request" || incoming.repository.full_name !== `${repo.owner}/${repo.repo}`) return;
  numbers = incoming.pull_requests.map(p => p.number);
  if (!numbers.length) numbers = (await api.repos.listPullRequestsAssociatedWithCommit({...repo,commit_sha:incoming.head_sha})).data.map(p=>p.number);
 }
 for (const number of [...new Set(numbers)]) {
  const current = async () => (await api.pulls.get({...repo,pull_number:number})).data;
  let pr = await current();
  if (pr.state !== "open" || pr.base.repo.full_name !== `${repo.owner}/${repo.repo}` || pr.base.ref !== context.payload.repository.default_branch) continue;
  const sha = pr.head.sha;
  const baseSha = pr.base.sha;
  const status = async (state,description) => api.repos.createCommitStatus({...repo,sha,state,context:"Country policy gate",description});
  const latest = async () => {
   const runs = await github.paginate(api.actions.listWorkflowRuns,{...repo,workflow_id:"check.yml",event:"pull_request",head_sha:sha,per_page:100});
   return runs.filter(r=>r.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
  };
  let run;
  try { run = await latest(); } catch (error) { if(error.status !== 404) throw error; }
  if (!run || run.status !== "completed") { await status("pending","Waiting for current Spike checks"); continue; }
  // An older completion must never overwrite the result of a newer run.
  if (incoming && (run.id !== incoming.id || run.run_attempt !== incoming.run_attempt)) continue;
  await status("pending","Rechecking observations with trusted base verifier");
  let state="failure", description="Spike checks or trusted policy verification failed";
  try {
   const full = (await api.actions.getWorkflowRun({...repo,run_id:run.id})).data;
   if (!sameRun(full,pr,number) || full.conclusion !== "success" || full.path !== ".github/workflows/check.yml") throw Error("Run metadata mismatch");
   const jobs=await github.paginate(api.actions.listJobsForWorkflowRunAttempt,{...repo,run_id:run.id,attempt_number:run.run_attempt,per_page:100});
   if (!validJobs(jobs)) throw Error("Required jobs missing or unsuccessful");
   const artifacts=await github.paginate(api.actions.listWorkflowRunArtifacts,{...repo,run_id:run.id,per_page:100});
   const matches=artifacts.filter(a=>a.name === "reader-observations");
   if(matches.length!==1 || matches[0].expired || matches[0].size_in_bytes>limit || matches[0].workflow_run?.id !== run.id || matches[0].workflow_run?.head_sha !== sha) throw Error("Artifact metadata mismatch");
   const archive=await api.actions.downloadArtifact({...repo,artifact_id:matches[0].id,archive_format:"zip"});
   await verify(unpackObservation(Buffer.from(archive.data)),pr,repo);
   state="success"; description="Trusted base verifier approved current reader observations";
  } catch(error) { console.error(error); }
  pr=await current();
  const newest=await latest();
  if(pr.state === "open" && pr.head.sha===sha && pr.base.sha === baseSha && newest?.id===run.id && newest?.run_attempt===run.run_attempt) await status(state,description);
 }
}
