// Real published CLI; all runs use an isolated consumer outside any npm project.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const step=readFileSync(resolve(root,'action.yml'),'utf8').split('      run: |\n')[1].split('\n');
const script=[];
for (const line of step) { if (line && !line.startsWith('        ')) break; script.push(line.slice(8)); }
const cwd=mkdtempSync(resolve(tmpdir(),'streamtrust-action-live-'));
const init=spawnSync('npx',['--yes','streamtrust@0.3.0','init','http'],{cwd,stdio:'inherit',env:{...process.env,npm_config_ignore_scripts:'true'}});
assert.equal(init.status,0,'published CLI init');
copyFileSync(resolve(root,'test/fixtures/fail.mjs'),resolve(cwd,'fail.mjs'));
copyFileSync(resolve(root,'test/fixtures/unsupported.mjs'),resolve(cwd,'unsupported.mjs'));
const injection='adapter;$(touch INJECTED)`touch ALSO_INJECTED`.mjs';
copyFileSync(resolve(root,'test/fixtures/fail.mjs'),resolve(cwd,injection));
const results=[];
try {
  for (const [name,adapter,expected,extra] of [
    ['http','http/adapter.mjs','0',{}],
    ['fail','fail.mjs','1',{}],
    ['unsupported','unsupported.mjs','1',{}],
    ['missing','does-not-exist.mjs','2',{}],
    ['injection',injection,'1',{}],
    ['range','fail.mjs','2',{ST_VERSION:'^0.3.0'}],
  ]) {
    const env={...process.env,ST_ACTION_PATH:root,GITHUB_WORKSPACE:cwd,ST_ADAPTER:adapter,ST_VERSION:'0.3.0',ST_OUTPUT:`reports/${name}`,ST_REPETITIONS:'1',
      GITHUB_OUTPUT:resolve(cwd,`${name}.outputs`),GITHUB_STEP_SUMMARY:resolve(cwd,`${name}.summary.md`),...extra};
    const execution=spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',script.join('\n')],{cwd,env,stdio:'inherit'});
    assert.equal(execution.status,0,'capture step defers failure to final policy gate');
    const outputs=Object.fromEntries(readFileSync(env.GITHUB_OUTPUT,'utf8').trimEnd().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
    assert.equal(outputs['exit-code'],expected,name);
    assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'),/## StreamTrust:/);
    if(name==='missing') assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'),/Adapter initialization failed/);
    if(name==='http') assert.equal(outputs['pass-count'],'3');
    assert.equal(existsSync(resolve(cwd,'INJECTED')),false);
    assert.equal(existsSync(resolve(cwd,'ALSO_INJECTED')),false);
    results.push({name,exitCode:outputs['exit-code'],summary:true});
  }
  console.log(JSON.stringify({platform:process.platform,node:process.version,results},null,2));
} finally { rmSync(cwd,{recursive:true,force:true}); }
