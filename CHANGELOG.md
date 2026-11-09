# Changelog

## v1.1.0

- Add opt-in installation of a generated browser adapter's dependencies and Chromium.
- Default to StreamTrust 0.6.1. The CLI's 0.6.0 release renamed HTTP/SSE, NextChat and Open WebUI scenarios. Update filters using the [migration table](https://github.com/santoshsibyala/streamtrust/blob/v0.6.0/CHANGELOG.md#breaking-changes).


## v1.0.1

- Default to StreamTrust CLI 0.5.0.
- Reject Windows runners before Node setup and report npm installation failures with the requested version and exit code 2.
- Set the Action author to Santosh Sibyala.

## v1.0.0 - 2026-11-05

- Composite wrapper around pinned StreamTrust 0.3.0.
- Optional Node setup, validated inputs, argument-array CLI invocation.
- Job summary, scenario counts, report upload and configurable failure policy.
- Reject stale, malformed and mismatched reports.
- Ubuntu/macOS test workflows, deliberate failure workflow and local tests.
- No changes to StreamTrust verification logic or report format.
