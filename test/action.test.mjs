import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inputs, run, validateReport, renderSummary } from '../summary.mjs';

function environment(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'streamtrust-action-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { GITHUB_WORKSPACE: cwd, GITHUB_OUTPUT: resolve(cwd, 'outputs'),
    GITHUB_STEP_SUMMARY: resolve(cwd, 'summary'), ST_ADAPTER: 'adapter.mjs' };
}
function report(code = 0, status = 'PASS') {
  return { schemaVersion: 1, version: '0.5.0', runId: 'test-run', complete: true, exitCode: code,
    suiteErrors: [], counts: { [status]: 1 }, results: [{ scenario: 'persistence', repetition: 1, classification: status, checks: [] }] };
}
function fake(reportValue, status = reportValue?.exitCode ?? 2) {
  return (_command, args) => {
    if (reportValue !== undefined) writeFileSync(resolve(args[args.indexOf('--output')+1], 'report.json'), typeof reportValue === 'string' ? reportValue : JSON.stringify(reportValue));
    return { status };
  };
}
test('default pin, numeric limits, and Node minimum', t => {
  const env = environment(t);
  assert.equal(inputs(env).version, '0.5.0');
  assert.throws(() => inputs(env, '20.19.0'), /22 or newer/);
  for (const version of ['^0.5.0','~0.5.0','*','next','github:other/repo','0.3','01.2.3','0.5.0; touch nope'])
    assert.throws(() => inputs({...env, ST_VERSION: version}), /exact npm version/);
  for (const version of ['0.5.0','1.0.0-rc.1','latest']) assert.equal(inputs({...env, ST_VERSION: version}).version, version);
  for (const [key,value] of [['ST_REPETITIONS','0'],['ST_REPETITIONS','1001'],['ST_TIMEOUT_MS','99'],['ST_TIMEOUT_MS','86400001'],['ST_TIMEOUT_MS','1e3']])
    assert.throws(() => inputs({...env, [key]:value}));
  for (const [key,value] of [['ST_UPLOAD_REPORT','yes'],['ST_FAIL_ON','sometimes'],['ST_ARTIFACT_NAME','../bad']])
    assert.throws(() => inputs({...env, [key]:value}));
});
const actionText = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
const shellBlocks = actionText.slice(actionText.indexOf('    - name: Run StreamTrust')).split('      run: |\n').slice(1).map(block => {
  const lines=[];
  for (const line of block.split('\n')) {
    if (line && !line.startsWith('        ')) break;
    lines.push(line.slice(8));
  }
  return lines.join('\n');
});
test('actual composite shell gate honors every policy', () => {
  assert.equal(shellBlocks.length,2);
  for (const code of ['0','1','2','']) for (const policy of ['failures','errors','never','invalid']) {
    const result=spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',shellBlocks[1]],
      {env:{...process.env,ST_EXIT_CODE:code,ST_FAIL_ON:policy},encoding:'utf8'});
    const shouldPass=policy==='never'||(policy==='errors'&&['0','1'].includes(code))||(policy==='failures'&&code==='0');
    assert.equal(result.status===0,shouldPass,`${policy}/${code}`);
  }
});
test('actual composite run step rejects old Node with clear summary', t => {
  const env=environment(t);
  const nodePath=resolve(env.GITHUB_WORKSPACE,'node');
  // Simulate the preflight command failing on an old runtime; real Node 20 is also tested in CI.
  writeFileSync(nodePath,'#!/bin/sh\nexit 1\n',{mode:0o755});
  const result=spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',shellBlocks[0]],
    {env:{...process.env,...env,PATH:env.GITHUB_WORKSPACE+':'+process.env.PATH,
      ST_ACTION_PATH:fileURLToPath(new URL('..',import.meta.url))},encoding:'utf8'});
  assert.equal(result.status,0); // The final gate decides whether the Action fails.
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'),/below 22/);
  assert.match(readFileSync(env.GITHUB_OUTPUT,'utf8'),/exit-code=2/);
});
test('pass, fail, unsupported and harness error summaries and counts', t => {
  for (const [code,status] of [[0,'PASS'],[1,'FAIL'],[1,'UNSUPPORTED'],[2,'HARNESS_ERROR']]) {
    const env=environment(t), out=run(env,fake(report(code,status)));
    assert.equal(out['exit-code'],String(code));
    assert.equal(out[{'PASS':'pass-count','FAIL':'fail-count','UNSUPPORTED':'unsupported-count','HARNESS_ERROR':'harness-error-count'}[status]],'1');
    assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'), new RegExp(status));
    assert.match(readFileSync(env.GITHUB_OUTPUT,'utf8'), /report-path=/);
  }
});
test('missing, invalid, mismatched and inconsistent reports become exit 2', t => {
  const variants = [undefined, '{broken', {...report(),exitCode:1}, {...report(),version:'0.2.0'}, {...report(),counts:{PASS:20}}, {...report(),results:[]}, {...report(),runId:''}];
  for (const r of variants) {
    const env=environment(t), out=run(env,fake(r,0));
    assert.equal(out['exit-code'],'2'); assert.equal(out['pass-count'],''); assert.equal(out['report-path'],'');
    assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'),/No valid report/);
  }
});
test('stale evidence is preserved and never reused or uploaded', t => {
  const env=environment(t), cfg=inputs(env);
  // First run creates an output directory and report.
  run(env,fake(report()));
  const before=readFileSync(resolve(cfg.directory,'report.json'),'utf8');
  const out=run(env,()=>{throw new Error('must not run');});
  assert.equal(out['exit-code'],'2'); assert.equal(out['upload-path'],'');
  assert.equal(readFileSync(resolve(cfg.directory,'report.json'),'utf8'),before);
});
test('output rejects workspace roots, traversal, globs, symlinks and line breaks', t => {
  const env=environment(t);
  symlinkSync(env.GITHUB_WORKSPACE,resolve(env.GITHUB_WORKSPACE,'link'));
  for (const output of ['.','../outside','reports/*','link/report','reports\nother'])
    assert.throws(()=>inputs({...env,ST_OUTPUT:output}));
});
test('adapter shell metacharacters stay literal argv, no shell execution', t => {
  const env={...environment(t),ST_ADAPTER:'adapter;$(touch INJECTED)`touch ALSO_INJECTED`.mjs'};
  let called=false;
  const out=run(env,(command,args,options)=>{
    called=true; assert.equal(command,'npx'); assert.equal(options.shell,false);
    assert.equal(args[args.indexOf('--adapter')+1],resolve(realpathSync(env.GITHUB_WORKSPACE),env.ST_ADAPTER));
    assert.equal(options.env.npm_config_ignore_scripts,'true');
    return fake(report())(command,args);
  });
  assert.equal(out['exit-code'],'0'); assert.ok(called); assert.equal(existsSync(resolve(env.GITHUB_WORKSPACE,'INJECTED')),false);
});
test('installation/process failure yields a summary and exit 2', t => {
  const env=environment(t), out=run(env,()=>({status:127}));
  assert.equal(out['exit-code'],'2');
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'),/npm\/CLI/);
});
test('summary escapes scenario Markdown and omits sensitive evidence/errors', () => {
  const r=report(); r.results[0].scenario='<img src=x>|[secret](https://example.com)\n# bad';
  r.results[0].evidence={token:'PRIVATE_VALUE'}; r.suiteErrors=['PRIVATE_ERROR']; r.exitCode=2;
  const counts=validateReport(r,2,'0.5.0');
  const md=renderSummary({code:2,report:r,counts});
  assert.ok(!md.includes('<img')); assert.ok(!md.includes('PRIVATE_')); assert.match(md,/Suite errors: 1/);
});
test('explicit latest reports resolved version; suite errors are not row counts', t => {
  const env={...environment(t),ST_VERSION:'latest'};
  const r={...report(),version:'0.4.0',counts:{},results:[],complete:false,suiteErrors:['setup error'],exitCode:2};
  const out=run(env,fake(r));
  assert.equal(out['harness-error-count'],'0'); assert.equal(out['exit-code'],'2');
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY,'utf8'),/0.4.0/);
});

test('npm registry failure produces a safe install diagnostic in the log and summary', t => {
  const env = { ...environment(t), ST_VERSION: '99.99.99' };
  const log = t.mock.method(console, 'error', () => {});
  const out = run(env, () => ({status: 1, stderr: 'npm error code ENOTFOUND\nnpm error https://SECRET@example.com'}));
  const summary = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.equal(out['exit-code'], '2');
  assert.equal(out['upload-path'], '');
  assert.match(summary, /package could not be installed .*99\.99\.99/);
  assert.doesNotMatch(summary, /SECRET|report\.json is missing/);
  assert.deepEqual(log.mock.calls[0].arguments, ['StreamTrust Action: ' + out.diagnostic]);
  assert.ok(!out.diagnostic.includes('SECRET'));
});
