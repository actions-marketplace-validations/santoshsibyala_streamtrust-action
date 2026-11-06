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

## Not executed yet

- `act` is not installed. The local Docker cache has no appropriate GitHub Actions runner image; no extra runner image or test framework was downloaded.
- GitHub-hosted Ubuntu/macOS workflows have not run: the action repository has intentionally not been created.
- Artifact upload/download, GitHub's rendered summary, composite output plumbing, optional setup-node download and actual job-status propagation therefore remain **pending hosted validation**.
- Windows is not validated.

Run `.github/workflows/test.yml` on GitHub and require both OS jobs to pass. Then run `expected-failure.yml`: the negative job must fail, its assertion job must pass, and the overall workflow must be red. See RELEASING.md for exact commands and artifact checks. Record run URLs here before releasing v1.0.0.
