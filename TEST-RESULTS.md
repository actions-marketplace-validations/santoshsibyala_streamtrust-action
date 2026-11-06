# Validation record

Date: November 5, 2026 (America/Los_Angeles).

## Executed locally

macOS, Node v22.22.3, published npm package `streamtrust@0.3.0`.

- `node --test test/action.test.mjs`: **11 tests passed**, zero failed/skipped. Includes all final shell failure-policy combinations, input validation, old-Node preflight, missing/invalid/inconsistent report handling, version mismatch, stale evidence, output traversal/globs/symlinks, literal argument forwarding and summary escaping/omission of raw evidence.
- `node test/integration.mjs`: **6 cases passed**, using the actual `run` shell block from action.yml and the real published CLI in a temporary consumer. Every case wrote a summary and outputs.

| Case | Observed exit | Result |
|---|---:|---|
| Published HTTP/SSE example, one repetition of three scenarios | 0 | PASS count 3 |
| Deliberately false check | 1 | FAIL count 1 |
| Explicit unsupported fixture | 1 | UNSUPPORTED count 1 |
| Nonexistent adapter | 2 | Clear adapter-initialization message |
| Existing adapter filename containing semicolon, dollar substitution and backticks | 1 | Negative fixture ran; neither command marker was created |
| `version: ^0.3.0` | 2 | Rejected before invoking npm |

The injection case uses an actual file whose name contains shell metacharacters. Its exit 1 is the fixture's deliberately false assertion, not a command execution. The GitHub workflow also tests a nonexistent filename with those characters, which should produce exit 2.

The actual composite shell preflight was also run with installed **Node v20.10.0**. It emitted `exit-code=2` and a job-summary message stating Node is below 22, without invoking npm.

Ruby's installed YAML parser successfully parsed action.yml and both workflows. A recursive check verified every third-party `uses` reference has a full 40-character commit SHA. Node syntax checks passed. The prepared StreamTrust README patch passed `git apply --check` against the existing local checkout without applying it.

The first npm test attempt inside the restricted network environment failed with ENOTFOUND. The authorized network-enabled rerun passed; the final run exercised the actual composite shell. No StreamTrust core files were changed.

## Hosted validation completed

Both jobs passed in [Action tests #1](https://github.com/santoshsibyala/streamtrust-action/actions/runs/42166185853), at commit `03435d3f631a328d83e096c081e3d5d6256bbcc1`:

- [Ubuntu job](https://github.com/santoshsibyala/streamtrust-action/actions/runs/42166185853/job/127723098371): success.
- [macOS job](https://github.com/santoshsibyala/streamtrust-action/actions/runs/42166185853/job/127723098192): success.
- Both ran all 11 unit tests, the published HTTP adapter (9 PASS scenario executions), the failure-policy/unsupported/harness-error cases, version-range rejection, shell-metacharacter input and actual Node 20 rejection.
- Both uploaded and downloaded the passing artifact and compared report.json byte-for-byte. Six artifacts were confirmed: pass, fail and missing-adapter reports for each OS.
- Rendered GitHub summaries were inspected: version, counts, scenario tables and adapter-initialization/invalid-version/old-Node diagnostics are visible.

[Expected failure smoke test #1](https://github.com/santoshsibyala/streamtrust-action/actions/runs/42166279626) also behaved correctly: `expected-failure` failed, `assert-failed-job` succeeded, and the `streamtrust-report` artifact was retained. The overall workflow is intentionally red. This demonstrates failure propagation without continue-on-error on the negative job.

The ordinary test workflow has expected error annotations from its negative controls; explicit assertions verify those failures, and both overall jobs are green. This is not evidence of a production application defect.

Artifacts expire after seven days. Workflow links, this record and the README screenshot preserve the validation context. Windows and GitHub Enterprise Server remain unvalidated. This validation was completed before publishing the v1.0.0/v1 tags or Marketplace release.
