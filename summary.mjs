import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { openSync, closeSync, unlinkSync, readSync, fstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const statuses = ['PASS', 'FAIL', 'UNSUPPORTED', 'HARNESS_ERROR'];
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const clean = value => String(value).replace(/[&<>|`\[\]*_\\\r\n\x00-\x1f\x7f]/g,
  c => `&#${c.charCodeAt(0)};`).slice(0, 500);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function inputs(env, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split('.')[0]) < 22) throw new Error('StreamTrust requires Node.js 22 or newer. Set node-version: "22" (or newer).');
  const get = (key, fallback) => env[`ST_${key}`] ?? fallback;
  const version = get('VERSION', '0.5.0');
  // "latest" is an explicit, documented opt-in; no other tags/ranges/specifiers.
  if (!exactVersion.test(version) && version !== 'latest') throw new Error('version must be an exact npm version (for example 0.5.0); only explicit latest is also allowed. Ranges are rejected.');
  const policy = get('FAIL_ON', 'failures');
  if (!['failures', 'errors', 'never'].includes(policy)) throw new Error('fail-on must be failures, errors, or never.');
  const upload = get('UPLOAD_REPORT', 'true');
  if (!['true', 'false'].includes(upload)) throw new Error('upload-report must be true or false.');
  const artifact = get('ARTIFACT_NAME', 'streamtrust-report');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(artifact)) throw new Error('artifact-name must be 1-128 letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
  const adapter = get('ADAPTER', '');
  if (!nonempty(adapter) || /[\r\n\0]/.test(adapter)) throw new Error('adapter is required and must be a single-line path.');
  const working = get('WORKING_DIRECTORY', '.');
  const output = get('OUTPUT', 'reports/streamtrust');
  if (!nonempty(working) || !nonempty(output) || /[\r\n\0]/.test(working + output)) throw new Error('working-directory and output must be nonempty single-line paths.');
  const cwd = realpathSync(resolve(env.GITHUB_WORKSPACE || process.cwd(), working));
  const directory = resolve(cwd, output);
  // upload-artifact interprets globs: do not let paths turn into upload patterns.
  if (/[!*?\[\]{}]/.test(directory)) throw new Error('output path cannot contain artifact glob characters.');
  const rel = relative(cwd, directory);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(cwd, rel) !== directory || rel.startsWith(sep)) throw new Error('output must be a dedicated directory inside working-directory.');
  let parent = cwd;
  for (const part of rel.split(sep)) {
    parent = resolve(parent, part);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error('output and its parents must not be symbolic links.');
  }
  if (existsSync(directory) && readdirSync(directory).length) throw new Error('output must be empty or new; choose a unique directory to avoid uploading stale evidence.');
  const integer = (key, fallback, min, max) => {
    const value = get(key, fallback);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${key.toLowerCase().replaceAll('_', '-')} must be ${min}-${max}.`);
    return value;
  };
  return { version, policy, cwd, directory, adapter: resolve(cwd, adapter),
    repetitions: integer('REPETITIONS', '3', 1, 1000), timeout: integer('TIMEOUT_MS', '300000', 100, 86400000) };
}

export function validateReport(report, code, version) {
  if (!object(report) || report.schemaVersion !== 1 || !nonempty(report.runId) ||
      !nonempty(report.version) || ![0, 1, 2].includes(report.exitCode) || report.exitCode !== code ||
      !object(report.counts) || !Array.isArray(report.results) || !Array.isArray(report.suiteErrors) ||
      !report.suiteErrors.every(e => typeof e === 'string') || typeof report.complete !== 'boolean') throw new Error('Invalid report.json schema or CLI/report exit-code mismatch.');
  if (version !== 'latest' && report.version !== version) throw new Error('report.json version does not match the requested StreamTrust version.');
  const actual = Object.fromEntries(statuses.map(s => [s, 0]));
  for (const row of report.results) {
    if (!object(row) || !nonempty(row.scenario) || !Number.isInteger(row.repetition) || row.repetition < 1 ||
        !statuses.includes(row.classification) || !Array.isArray(row.checks)) throw new Error('Invalid scenario row in report.json.');
    actual[row.classification]++;
  }
  for (const [key, value] of Object.entries(report.counts)) {
    if (!statuses.includes(key) || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid counts in report.json.');
  }
  for (const s of statuses) if ((report.counts[s] ?? 0) !== actual[s]) throw new Error('Report counts do not match scenario results.');
  const expected = report.suiteErrors.length || !report.complete || actual.HARNESS_ERROR ? 2 : actual.FAIL || actual.UNSUPPORTED ? 1 : 0;
  if (expected !== code || (code === 0 && !report.results.length)) throw new Error('Report overall result is inconsistent.');
  return actual;
}

export function renderSummary({ code, report, counts, diagnostic, version }) {
  const meaning = ['All declared scenarios passed.', 'Failed or unsupported checks.', 'Setup, timeout, or harness error.'][code];
  let md = `## StreamTrust: ${['PASS', 'FAIL / UNSUPPORTED', 'HARNESS ERROR'][code]}\n\nStreamTrust version: ${clean(report?.version ?? version ?? 'not run')}\n\nExit code **${code}**: ${meaning}\n\n`;
  if (diagnostic) md += `${clean(diagnostic)}\n\n`;
  if (!report) return md + 'No valid report from this invocation. Counts are unavailable.\n';
  md += `| PASS | FAIL | UNSUPPORTED | HARNESS_ERROR |\n|---:|---:|---:|---:|\n| ${statuses.map(s => counts[s]).join(' | ')} |\n\n`;
  md += '| Scenario | Repetition | Result |\n|---|---:|---|\n';
  for (const row of report.results.slice(0, 500)) md += `| ${clean(row.scenario)} | ${row.repetition} | ${row.classification} |\n`;
  if (report.results.length > 500) md += '\nTable limited to 500 rows; full results are in the artifact.\n';
  if (report.adapter === 'adapter initialization' && report.suiteErrors.length) md += '\nAdapter initialization failed. Check the adapter path, its imports and setup; see report.json for details.\n';
  if (report.suiteErrors.length) md += `\nSuite errors: ${report.suiteErrors.length}. Inspect report.json in the artifact for details.\n`;
  return md + '\nCounts are scenario executions, not individual assertions. Raw evidence, metadata, and error strings are omitted from this summary.\n';
}

// Capture stderr privately. A verbose verifier must not exceed spawnSync's pipe buffer.
function executeNpx(command, args, options) {
  const path = resolve(tmpdir(), 'streamtrust-npx-' + randomUUID());
  const fd = openSync(path, 'wx+', 0o600);
  try {
    unlinkSync(path);
    const child = spawnSync(command, args, { ...options, stdio: ['inherit', 'inherit', fd] });
    const size = fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 65536));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    return { ...child, stderr: tail.toString() };
  } finally {
    closeSync(fd);
  }
}

export function run(env = process.env, execute = executeNpx) {
  let config, report, counts, diagnostic, uploadPath = '', code = 2;
  try {
    config = inputs(env);
    mkdirSync(config.directory, { recursive: true });
    uploadPath = config.directory;
    // No shell, eval, or interpolated command string. Every argument stays one argument.
    const child = execute('npx', ['--yes', `streamtrust@${config.version}`, 'verify',
      '--adapter', config.adapter, '--output', config.directory,
      '--repetitions', config.repetitions, '--timeout-ms', config.timeout], {
      cwd: config.cwd, env: { ...env, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
      stdio: 'inherit', shell: false,
    });
    // A valid verifier failure can also exit 1 or 2. Prefer its report.
    if (child.status && !existsSync(resolve(config.directory, 'report.json')) &&
        /^npm (?:error|ERR!) code [A-Z][A-Z0-9_]*\s*$/im.test(child.stderr ?? '')) {
      uploadPath = '';
      throw new Error(`StreamTrust package could not be installed (requested version: ${config.version}).`);
    }
    if (child.error || child.signal || ![0, 1, 2].includes(child.status)) throw new Error('npm/CLI did not finish with a supported exit code; inspect the step log.');
    code = child.status;
    try { report = JSON.parse(readFileSync(resolve(config.directory, 'report.json'), 'utf8')); }
    catch { throw new Error('report.json is missing or invalid JSON for this invocation.'); }
    counts = validateReport(report, code, config.version);
  } catch (error) {
    diagnostic = config ? (error.message.startsWith('ENOENT') ? 'report.json is missing for this invocation.' : error.message) :
      (error.code ? 'Cannot access working-directory or output; check the configured paths.' : error.message);
    code = 2; report = undefined; counts = undefined;
    // Prevent terminal workflow-command interpretation of input-derived messages.
    console.error(`StreamTrust Action: ${clean(diagnostic)}`);
  }
  const outputs = {
    diagnostic: diagnostic ? clean(diagnostic) : '',
    'exit-code': String(code), 'report-path': report ? resolve(config.directory, 'report.json') : '',
    'pass-count': counts ? String(counts.PASS) : '', 'fail-count': counts ? String(counts.FAIL) : '',
    'unsupported-count': counts ? String(counts.UNSUPPORTED) : '', 'harness-error-count': counts ? String(counts.HARNESS_ERROR) : '',
    'upload-path': uploadPath,
  };
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([k,v]) => `${k}=${v}\n`).join(''));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary({ code, report, counts, diagnostic, version: config?.version }));
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run();
}
