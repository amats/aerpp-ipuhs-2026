# Source releases and publishing

This guide owns workspace versions, the root changelog and versioned GitHub source releases. Private delivery and production acceptance follow [deployment](deployment.md). Study conditions and provenance remain governed by [research releases](research-release.md).

## Release, publish and deploy

| Operation | Outcome |
| --- | --- |
| Prepare a release | Review a version, changelog section, local release-note draft and verification evidence |
| Publish a release | Push the reviewed version tag and publish its GitHub Release against the verified commit |
| Deploy an application | Deliver and accept application images/configuration in an explicitly selected environment |

A request to prepare a release covers local metadata, notes and checks. Follow the user's existing authorization for PR submission/integration, tag pushes, remote drafts, GitHub publishing, visibility changes and deployment; preparation alone does not authorize these external operations.

Published releases contain source only. Keep all workspace packages `private: true`; do not publish npm packages or attach images, compiled bundles, installed dependencies, model weights, private assets, settings or acceptance evidence. Private deployment and research provenance follow their owning guides.

## Single workspace version

The root `package.json` owns the version. Every application and shared package's `package.json` mirrors it; applications and packages are released together rather than independently. Use Semantic Versioning, including explicit prerelease versions while the source is a candidate. Review compatibility and required operator action when selecting a version; do not infer a version solely from commit subjects.

Keep the following identities aligned:

| Record | Form |
| --- | --- |
| Root and workspace manifests | `<version>`, for example `1.0.0-rc.1` |
| Root changelog heading | `## [<version>] - YYYY-MM-DD` |
| Annotated Git tag and GitHub Release title | `v<version>`, for example `v1.0.0-rc.1` |
| Tag target and GitHub Release target | The same verified integration commit |

Review this mapping manually; the existing publication gate does not enforce it. Use a new version for a new source release and preserve published tags. Do not use a version command that creates commits/tags as a side effect.

Keep the single root lockfile synchronized where required without incidental dependency upgrades. API/export-schema versions, questionnaire metadata and private deployment identities remain separate contracts; a workspace version change does not rewrite them.

Web records the mirrored workspace version as `analysisWorkspaceVersion` for each completed analysis and its linked questionnaire. Keep every deployed version fixed to its reviewed GitHub tag/commit, and assign a new workspace version to each delivered source update, including security maintenance. Preserve the recorded analysis version across later submissions and retries. See [research provenance](research-release.md#release-provenance).

## Manual changelog

Maintain root [CHANGELOG.md](../CHANGELOG.md) by hand for public source releases. Keep `Unreleased` at the top and use only the `Added`, `Changed`, `Fixed` and `Removed` categories that apply.

- Record notable outcomes for users, independent installers and maintainers. Include setup/configuration changes, API or stored-data incompatibilities, required coordinated updates and migration limits.
- Consolidate related work into one outcome. Explain the resulting behavior and necessary operator action; omit commit-by-commit narration, routine formatting, test inventories and internal refactors without a material effect.
- Keep ordinary development entries under `Unreleased`. Cut a dated section only as part of a requested release preparation, using the intended publication date in UTC. Reconcile that date before publishing if the schedule changes.
- Preserve published version sections as historical records. Do not silently rewrite their behavior to match the current implementation or invent missing releases from version bumps.
- Derive the GitHub Release description from the matching changelog section. Keep the same outcomes and compatibility notes instead of independently maintaining another change list or generating it from commit titles.

Keep exact test commands/results, prerequisites and unverified external behavior in the task/PR record. Changelog entries and release notes contain no private cloud identities, participant data, analysis documents/results or secrets.

## Prepare a source release

1. Confirm the integration branch and intended version. Use a work branch and inspect release/tag history for reuse or conflicts; unresolved remote state must be checked before publishing.
2. Update the root and all workspace manifest versions together. Review the lockfile and retain package privacy. Keep model, prompt, generation settings and supplied research assets unchanged unless separately authorized.
3. Review `Unreleased` against changes since the preceding release and follow the [manual changelog policy](#manual-changelog) to prepare the version section and local release notes. Record the proposed version/tag and remaining checks for review.

Keep preparation distinct from publication evidence: a dated section or version commit alone does not establish a published release.

## Source verification

Integrate the reviewed release changes through the [workspace PR procedure](../CONTRIBUTING.md#before-opening-a-pr), then verify the resulting integration commit. Do not push directly to `main` or substitute checks from an earlier work-branch commit.

Run pnpm commands from the workspace root in an isolated clean checkout of that commit, with synthetic public inputs and no maintainer private configurations/credentials. Follow [tool prerequisites](development.md#prerequisites) and [synthetic environment setup](development.md#first-run-without-cloud-credentials), including the emulator JAR and Chromium. Build before tests so generated files cannot conceal fresh-clone failures:

```sh
pnpm install --frozen-lockfile
pnpm run env:check example
pnpm run build
pnpm run verify:publication
pnpm run test:e2e:web
pnpm run test:e2e:admin
```

Review the version/tag mapping, public file set, new Git history and third-party notices. Inspect staged changes, commit/tag metadata and release attachments for private identifiers, credentials and real data. `privacy:check` scans current files only; a checkout without private configurations also lacks its private project-ID inputs. Keep private configurations, operator notes, local agent files and generated artifacts out of source releases. Preserve full license texts and provenance for included third-party files. Dependency changes also require the [contributor dependency checks](../CONTRIBUTING.md#before-opening-a-pr), including the production audit.

Record the tested integration commit, intended tag, notes and check results in task/PR evidence. Changes after verification require the affected checks again and an updated tested-commit record. Failed checks, missing prerequisites and unresolved public-file findings prevent publishing.

`verify:publication` currently delegates to `verify`; build and browser checks above are additional source-release checks. They use synthetic/local services and do not establish production, real OAuth/mail or operational-machine acceptance. Root `verify:release` remains the application production-acceptance gate described in [deployment](deployment.md#release-acceptance); source publishing does not require production credentials or deployment evidence.

## Publish the verified source

Use the authorized GitHub target and the verified commit, version and notes.

1. Confirm the repository, integration commit, version, notes and verification record. Check the remote tag/Release before writing: a new release requires an unused version; a partial publish follows the recovery rule below.
2. Create the annotated `v<version>` tag on the verified integration commit and push that specific tag to the intended repository. Reuse a matching existing tag only when resuming the same partial publish; do not push unrelated tags.
3. Publish the GitHub Release using the existing tag, the matching changelog text and no generated artifact attachments. Mark candidate versions as prereleases; a stable release requires the corresponding stable workspace version.
4. Confirm that the remote tag and published Release resolve to the verified commit and that the published notes match the version section. Record the public release URL and outcome in task/PR evidence, keeping deployment evidence private.

If publishing is interrupted, inspect the existing remote tag and Release before retrying. Resume only missing steps for the same verified commit. Conflicting identities require review; do not move or force-update a published tag to repair a partial operation. Publish source corrections under a new version.

## Historical release audits

Use this section only when auditing or reconstructing confirmed releases. A package version or untagged development commit alone does not establish publication. Ordinary `Unreleased` edits do not require a release-history inventory.

- Compare version headings with release tags and explicit publication records first. Inspect detailed history only for confirmed gaps. A package/lockfile bump or untagged preparation commit alone is insufficient evidence of publication.
- Use the root package version at the release commit. For historical tags with different preview labels, retain the evidence and explain the discrepancy instead of renaming tags. Collapse tags for the same commit and package version into one release.
- For a confirmed missing release, use the diff from the preceding confirmed release boundary. Prefer resulting trees and relevant diffs over conflicting or incomplete commit subjects.
- For the earliest confirmed release without a preceding boundary, inspect its snapshot, README and major application contracts, then summarize it as the initial release.
- Reconstruct only supported notable outcomes, preserving existing entries and avoiding duplicates across version sections. Do not invent test-only/refactor bullets to fill a section.
- Keep one dated section per confirmed release in newest-first order. Report ambiguous identity, version, date or scope instead of guessing; finish with duplicate-heading and `git diff --check` checks.
