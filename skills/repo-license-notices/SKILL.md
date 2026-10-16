---
name: repo-license-notices
description: Use when changing production dependencies, bundled assets, model license metadata, license displays or distribution notices across the workspace.
---

# Workspace license notices

Root `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` are canonical. Keep full texts and the generated package inventory in `docs/licenses/`; allow generated app-local runtime copies, but do not maintain separate source copies or dependency tables. Preserve license texts verbatim and keep the project license unchanged unless explicitly requested.

Follow the [notice update procedure](../../THIRD_PARTY_NOTICES.md#updating-the-notices-and-display) and [development commands](../../docs/development.md#dependency-license-reports). Run root `pnpm run license` after production dependency changes, review its diff and missing-text report, then run `pnpm run license:check`. `license:audit` is a separate installed-dependency coverage diagnostic; freshness alone is not compliance evidence. GitHub publication is source-only, with licenses confirmed by the maintainer. Follow [source releases](../../docs/releases.md) for versioned publishing; do not block source publication on notice gaps in dependencies that are not included in the repository. Preserve runtime notice generation for privately operated applications. Review scope changes when adding third-party files or publishing generated artifacts.

The collector reads installed production dependency graphs, including transitive packages and bundled notice files. Keep deliberate DOMPurify Apache-2.0 and JSZip MIT selections. Record omitted upstream texts as version-scoped supplements with source provenance; missing copyright text must remain an open finding, not be invented from author metadata.

Native source-notice bundles under `docs/licenses/supplements/` record component versions, source archive hashes and verbatim texts with hashes. The collector requires an exact match to the installed binary's `versions.json` and validates text hashes. Review the matching build recipe and target architecture before adding a bundle mapping; never weaken these checks to reuse a previous version's notices. Coverage of collected notice texts remains separate from final artifact redistribution obligations.

Web and Admin `/license` consume only app-local `generated/licenses/` copies produced by root `license:stage`. Keep this staging in dev, test and build entrypoints and preserve it in browser staging, Next.js traces and images; do not read root files from the runtime pages. Staging reads all sources before updating outputs, preserves unchanged files, and replaces changed files atomically. Regenerate each image's app inventory from its installed graph. Support carries notice files in artifacts rather than introducing unrelated UI or public API routes.

Review fonts and model metadata separately. Do not change model selection, prompts or generation settings as part of license maintenance. Do not present license names, links or collected texts as proof that native-library source obligations, container components or model redistribution have been cleared.

After changes, run applicable tooling/component/browser/build checks, plus `node scripts/checks/check-docs.mjs` and `node scripts/checks/check-skills.mjs` from the workspace root. Report missing texts and unverified target-architecture/artifact obligations explicitly.
