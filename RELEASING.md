# Review and release instructions

## v1.1.0 dependency and release order

First confirm `npm view streamtrust@0.6.1 version` returns `0.6.1`. Then open the Action PR and check the published-package integration, generated-browser-adapter job, and platform tests. After merge, tag the reviewed merge commit as v1.1.0, move v1 to the same commit, and publish the Marketplace release.


The source repository is public. Ubuntu/macOS validation is recorded in TEST-RESULTS.md. Review that record before publishing v1.0.0 or listing on Marketplace.

## Repository and Marketplace decision

Checked November 5, 2026: [GitHub Marketplace publishing requirements](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).

GitHub requires a public repository, a single root `action.yml` or `action.yaml`, a unique permitted action name, and files necessary for the action. Subfolder actions are permitted but are not automatically listed. Publication uses a tagged release; the owner must accept the Marketplace Developer Agreement and use 2FA. GitHub validates metadata; Marketplace name availability must be confirmed at publication.

Choose a separate `santoshsibyala/streamtrust-action` repository. This folder contains only the action, its tests, documentation and license. Its workflows test this action and belong here. The StreamTrust README patch is outside this folder, so it will not enter the action repository.

Third-party pins were resolved from official repository release tags on November 5, 2026:

| Repository | Tag | Commit |
|---|---|---|
| actions/setup-node | v7.1.0 | 949feb2413d6458794dcd2491c4babbbce0c15c1 |
| actions/upload-artifact | v7.0.2 | cf430e030ddbb5b0abf93d22962f4752f3646cd9 |
| actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/download-artifact | v8.0.2 | 9000827ccba6bdab643e8b6fd33ac0654aef8333 |

## 1. Check out the source

```sh
git clone https://github.com/santoshsibyala/streamtrust-action.git
cd streamtrust-action
```

Review changes before tagging. The public source repository does not imply that v1.0.0 or the Marketplace listing has been released.

## 2. Run hosted validation

```sh
gh workflow run test.yml --repo santoshsibyala/streamtrust-action --ref main
gh run list --repo santoshsibyala/streamtrust-action --workflow test.yml --limit 5
# Substitute the run ID printed above:
gh run watch RUN_ID --repo santoshsibyala/streamtrust-action --exit-status
gh run view RUN_ID --repo santoshsibyala/streamtrust-action --web
```

Both Ubuntu and macOS jobs must be green. Inspect their StreamTrust summaries, and confirm `pass-*`, `fail-*` and `missing-*` artifacts. The workflow downloads the pass artifact and compares its JSON to the local report. Expected failing Action steps use `continue-on-error` plus explicit outcome/exit assertions so the regression suite can stay green.

Then prove a failed Action propagates to a failed job:

```sh
gh workflow run expected-failure.yml --repo santoshsibyala/streamtrust-action --ref main
gh run list --repo santoshsibyala/streamtrust-action --workflow expected-failure.yml --limit 5
gh run view NEGATIVE_RUN_ID --repo santoshsibyala/streamtrust-action --web
```

This manual workflow MUST be red: `expected-failure` fails and `assert-failed-job` passes. The failed job must still have a summary and an uploaded report. A green run is a regression. Do not make this deliberately red workflow a required branch check.

Update TEST-RESULTS.md and the summary screenshot if subsequent code changes require new validation. Remove the README's unreleased notice and date the changelog once tests pass, then commit and push those changes. Do not claim Linux/macOS hosted validation from local tests alone.

## 3. Tag and draft the release

From the reviewed, clean main branch after the preceding checks:

```sh
git pull --ff-only origin main
git status --short
# Stop if there are uncommitted changes.
git tag -a v1.0.0 -m 'StreamTrust Action v1.0.0'
git tag -a v1 -m 'StreamTrust Action v1'
git push origin v1.0.0 v1
gh release create v1.0.0 --repo santoshsibyala/streamtrust-action --verify-tag --draft --title 'StreamTrust Action v1.0.0' --notes-file CHANGELOG.md
gh release view v1.0.0 --repo santoshsibyala/streamtrust-action --web
```

On GitHub, edit the draft release and select **Publish this Action to the GitHub Marketplace**. Accept the agreement yourself if prompted; resolve any metadata/name validation errors, choose a category (for example Testing), and publish the release with 2FA. If the checkbox is not offered in the draft, open root action.yml and use its **Draft a release** banner for the tagged version. Avoid publishing duplicate releases.

A GitHub release can also be published without Marketplace using `gh release edit v1.0.0 --draft=false --repo santoshsibyala/streamtrust-action`; that alone does not create a Marketplace listing. Use the UI route above when listing the Action.

For future compatible releases, never move `v1.0.0`. Create a new immutable version tag and move only `v1` after reviewing changes and passing tests:

```sh
git tag -a v1.0.1 -m 'StreamTrust Action v1.0.1'
git tag -fa v1 -m 'StreamTrust Action v1' v1.0.1^{}
git push origin v1.0.1
git push --force origin refs/tags/v1
```

## 4. Apply the main StreamTrust README patch only after approval and release

The prepared `../streamtrust-action-readme.patch` adds a GitHub Action section to the package README. Review it with `git apply --check` and `git diff` from the StreamTrust repository. Existing README changes are unrelated and must be reviewed separately. No package release is needed for this Action wrapper.
