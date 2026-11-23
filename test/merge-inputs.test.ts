import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('the workflow derives refs from Git without a proposed script and rejects wrong event refs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'merge-inputs-')),gitDir=join(root,'repo.git'),worktree=join(root,'tree');
 const env={...process.env,GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
 const git=(args:string[],input?:string)=>execFileSync('git',[`--git-dir=${gitDir}`,...args],{env,encoding:'utf8',input,stdio:['pipe','pipe','pipe']}).trim();
 try {
  execFileSync('git',['init','--bare','--quiet',gitDir],{env});
  const tree=git(['mktree'],'');
  const base=git(['commit-tree',tree,'-m','base']),head=git(['commit-tree',tree,'-p',base,'-m','head']);
  const merge=git(['commit-tree',tree,'-p',base,'-p',head,'-m','merge']);
  git(['worktree','add','--detach','--quiet',worktree,merge]);
  const workflow=await readFile('.github/workflows/check.yml','utf8');
  const body=workflow.split("node --input-type=module <<'NODE'\n")[1]?.split('\n          NODE')[0];
  assert(body,'workflow must derive refs inline before selecting executable checkouts');
  const producer=join(root,'producer.mjs');
  await writeFile(producer,body.split('\n').map(line=>line.replace(/^          /,'')).join('\n'));
  const output=join(root,'outputs'),bindingFile=join(worktree,'reader-binding.json');
  const run=(mergeSha:string,headSha:string)=>spawnSync(process.execPath,[producer],{cwd:worktree,env:{...env,GITHUB_SHA:mergeSha,PR_HEAD_SHA:headSha,GITHUB_OUTPUT:output},encoding:'utf8'});
  const good=run(merge,head);assert.equal(good.status,0,good.stdout+good.stderr);
  assert.deepEqual(JSON.parse(await readFile(bindingFile,'utf8')),{schemaVersion:1,mergeSha:merge,baseSha:base,headSha:head});
  assert.equal(await readFile(output,'utf8'),`base=${base}\nhead=${head}\nmerge=${merge}\n`);
  for(const [expectedMerge,expectedHead] of [[base,head],[merge,base],[head,head]]) {
   await rm(bindingFile,{force:true});await rm(output,{force:true});
   if(expectedMerge===head) execFileSync('git',['-C',worktree,'checkout','--detach','--quiet',head],{env});
   const bad=run(expectedMerge!,expectedHead!);assert.notEqual(bad.status,0);
   await assert.rejects(readFile(bindingFile),{code:'ENOENT'});
   await assert.rejects(readFile(output),{code:'ENOENT'});
  }
 } finally {
  try {git(['worktree','remove','--force',worktree]);} catch {}
  await rm(root,{recursive:true,force:true});
 }
});
