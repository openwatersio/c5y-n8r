import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const expected = ["merge-inputs", "build-and-test", "wikidata-evidence", "reader-observations", "reader-compatibility"];
const limit = 8 * 1024 * 1024;
export function validJobs(jobs) {
 return expected.every(name => jobs.filter(job => job.name === name).length === 1 && jobs.find(job => job.name === name).conclusion === "success");
}
export function sameRun(run, pr, number) {
 return run.event === "pull_request" && run.head_sha === pr.head.sha && run.pull_requests.some(p => p.number === number && p.head.sha === pr.head.sha);
}
export function validBinding(binding, pr, baseSha) {
 return !!binding && Object.keys(binding).sort().join(',') === 'baseSha,headSha,mergeSha,schemaVersion' && binding.schemaVersion === 1 &&
  binding.baseSha === baseSha && binding.headSha === pr.head.sha && binding.mergeSha === pr.merge_commit_sha && /^[a-f0-9]{40}$/.test(binding.mergeSha);
}
export function unpackObservation(bytes, filename="reader-results.json") {
 if (bytes.length > limit) throw Error("Compressed artifact too large");
 return execFileSync("python3", ["-c", `import sys,io,zipfile,stat
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read(${limit + 1})))
a=z.infolist()
if len(a)!=1: raise ValueError("Expected exactly one file")
f=a[0]
if f.filename!=sys.argv[1] or f.is_dir() or stat.S_ISLNK(f.external_attr>>16) or f.file_size>${limit}: raise ValueError("Unsafe artifact entry")
b=z.read(f)
if len(b)>${limit}: raise ValueError("Artifact too large")
sys.stdout.buffer.write(b)`,filename], { input:bytes, timeout:10000, maxBuffer:limit, stdio:["pipe","pipe","pipe"] });
}
export function verifyObservation(bytes, pr, repo, binding) {
 if (!validBinding(binding,pr,pr.base.sha)) throw Error("Observation merge binding mismatch");
 const temp = mkdtempSync(join(tmpdir(), "country-policy-"));
 const base = join(temp, "base");
 const proposed = join(temp, "proposed");
 const run = (cmd,args,options={}) => execFileSync(cmd,args,{timeout:120000,maxBuffer:1024*1024,...options});
 try {
  // Only the current base commit supplies executable code and dependencies.
  run("git",["fetch","--no-tags","--depth=1",`https://github.com/${repo.owner}/${repo.repo}.git`,pr.base.sha]);
  run("git",["worktree","add","--detach",base,pr.base.sha]);
  writeFileSync(join(temp,"reader-results.json"),bytes);
  run("npm",["ci","--ignore-scripts"],{cwd:base});
  const check = corpus => ["--import","tsx","scripts/check-evidence.ts","--corpus",corpus,"--base",".","--reader-results",join(temp,"reader-results.json"),"--output",join(temp,"report")];
  // The head supplies data only; all executable code and dependencies come from the base.
  const mergeSha = binding.mergeSha;
  if (!/^[a-f0-9]{40}$/.test(mergeSha ?? "")) throw Error("Missing current PR merge commit");
  run("git",["fetch","--no-tags","--depth=2",`https://github.com/${repo.owner}/${repo.repo}.git`,mergeSha]);
  const parents = run("git",["show","--no-patch","--format=%P",mergeSha]).toString().trim().split(/\s+/);
  if (parents.length !== 2 || parents[0] !== pr.base.sha || parents[1] !== pr.head.sha) throw Error("Merge commit does not bind the current base and head");
  run("git",["worktree","add","--detach",proposed,mergeSha]);
  run("node",check(proposed),{cwd:base,timeout:720000});
  const report = JSON.parse(readFileSync(join(temp,"report","report.json"),"utf8"));
  if (report.mode !== "reader-compatibility" || report.passed !== true || !(report.checkedLookups > 0)) throw Error("Trusted verifier did not approve observations");
 } finally {
  try { run("git",["worktree","remove","--force",base]); } finally {
   try { run("git",["worktree","remove","--force",proposed]); } catch {}
   rmSync(temp,{recursive:true,force:true});
  }
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
  if (context.eventName === "pull_request_target" && context.payload.pull_request.head.sha !== pr.head.sha) continue;
  const sha = pr.head.sha, baseRef = pr.base.ref;
  const baseTip = async () => (await api.repos.getBranch({...repo,branch:baseRef})).data.commit.sha;
  const baseSha = await baseTip();
  const status = async (state,description) => api.repos.createCommitStatus({...repo,sha,state,context:"Country policy gate",description});
  const latest = async () => {
   const runs = await github.paginate(api.actions.listWorkflowRuns,{...repo,workflow_id:"check.yml",event:"pull_request",head_sha:sha,per_page:100});
   return runs.filter(r=>r.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
  };
  let run;
  try { run = await latest(); } catch (error) { if(error.status !== 404) throw error; }
  // An older completion must never overwrite the result of a newer run.
  if (incoming && (!run || run.id !== incoming.id || run.run_attempt !== incoming.run_attempt)) continue;
  if (!run || run.status !== "completed") { await status("pending","Waiting for current Spike checks"); continue; }
  for (let attempt=0; pr.mergeable === null && attempt<5; attempt++) {
   await delay(1000);
   pr = await current();
   if (pr.state !== "open" || pr.head.sha !== sha || pr.base.ref !== baseRef) break;
  }
  const afterPoll = await latest();
  if (pr.state !== "open" || pr.head.sha !== sha || pr.base.ref !== baseRef || (await baseTip()) !== baseSha || afterPoll?.id !== run.id || afterPoll?.run_attempt !== run.run_attempt) continue;
  if (pr.mergeable === null) { await status("pending","Waiting for GitHub to compute the merge commit"); continue; }
  await status("pending","Rechecking observations with trusted base verifier");
  let state="failure", description="Spike checks or trusted policy verification failed";
  try {
   const full = (await api.actions.getWorkflowRun({...repo,run_id:run.id})).data;
   if (!sameRun(full,pr,number) || full.conclusion !== "success" || full.path !== ".github/workflows/check.yml") throw Error("Run metadata mismatch");
   const jobs=await github.paginate(api.actions.listJobsForWorkflowRunAttempt,{...repo,run_id:run.id,attempt_number:run.run_attempt,per_page:100});
   if (!validJobs(jobs)) throw Error("Required jobs missing or unsuccessful");
   const artifacts=await github.paginate(api.actions.listWorkflowRunArtifacts,{...repo,run_id:run.id,per_page:100});
   const artifact = (name,maxSize) => {
    const matches=artifacts.filter(a=>a.name === name);
    if(matches.length!==1 || matches[0].expired || matches[0].size_in_bytes>maxSize || matches[0].workflow_run?.id !== run.id || matches[0].workflow_run?.head_sha !== sha) throw Error("Artifact metadata mismatch");
    return matches[0];
   };
   const observations=artifact("reader-observations",limit), bindingArtifact=artifact("reader-binding",32768);
   const [archive,bindingArchive]=await Promise.all([observations,bindingArtifact].map(a=>api.actions.downloadArtifact({...repo,artifact_id:a.id,archive_format:"zip"})));
   const bindingBytes=unpackObservation(Buffer.from(bindingArchive.data),"reader-binding.json");
   if (bindingBytes.length>16384) throw Error("Oversized observation binding");
   const binding=JSON.parse(bindingBytes.toString('utf8'));
   if (!validBinding(binding,pr,baseSha)) throw Error("Observations do not bind the current protected base, head and merge");
   await verify(unpackObservation(Buffer.from(archive.data)),{...pr,base:{...pr.base,sha:baseSha}},repo,binding);
   state="success"; description="Trusted base verifier approved current reader observations";
  } catch(error) { console.error(error); }
  pr=await current();
  const newest=await latest();
  if(pr.state === "open" && pr.head.sha===sha && pr.base.ref === baseRef && (await baseTip()) === baseSha && newest?.id===run.id && newest?.run_attempt===run.run_attempt) await status(state,description);
 }
}
