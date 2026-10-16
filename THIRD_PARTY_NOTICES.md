# Third-party notices

AERPP source is licensed under [MIT](LICENSE). Third-party software, fonts and models retain their own terms. The root `LICENSE`, `NOTICE` and this document are the canonical workspace notices; application runtime copies are generated from these sources rather than independently maintained.

## Publication scope

This project publishes its source repository on GitHub. Docker images, compiled applications, installed dependencies and model weights are not published. The maintainer has confirmed the licenses for this publication scope. Preserve notices for tracked files, including the bundled Noto font, and review additions or changes to the published materials.

Root `pnpm run verify:publication` runs the ordinary workspace checks, including notice freshness. Follow [source verification](docs/releases.md#source-verification) for Git history and file selection. Runtime notice coverage and private deployment acceptance are separate checks.

## JavaScript dependencies

[Generated dependency notices](docs/licenses/npm-notices.json) contain installed versions, package-declared authors and source repositories, selected license identifiers, application scopes, and verbatim license/copyright/NOTICE files. They cover the installed production dependency graphs of Web, Admin and Support, including transitive dependencies and nested bundled notice files. These graphs can include optional peers and build-time components; they are not a claim that every entry is shipped in every application.

The Web and Admin `/license` pages read package-local `generated/licenses/` copies containing only their applicable inventory and text files. Root `pnpm run license:stage` regenerates both; an optional `web` or `admin` argument selects one. These copies are Git-ignored and may be duplicated across packages. Each app stages them automatically before development, tests and builds, while standalone runtime needs no repository-root file access. Support has no end-user license page; their privately built artifacts include the root notices and `docs/licenses/`. First-party shared packages are covered by the root MIT license.

### License selections

- DOMPurify: Apache-2.0 is selected from MPL-2.0 OR Apache-2.0.
- JSZip: MIT is selected from MIT OR GPL-3.0-or-later.
- Upstream files may describe alternative licenses; retaining them does not change these selections.
- Version-scoped [supplements](docs/licenses/supplements.json) preserve upstream texts omitted from some package archives. Their provenance is recorded; they require review on upgrades and do not establish that every upstream version has identical terms.

### Installed dependency notice coverage

The generator reports missing texts rather than inferring copyright ownership from author metadata. Participant PDF filling uses `@libpdf/core`, which includes its MIT notice. A version-scoped supplement preserves the Apache-2.0 license for its FontBox-derived code from the matching upstream source commit. `pdf-lib` reads other PDFs and independently validates generated forms.

`@img/sharp-libvips-linux-arm64@1.3.4` and the Admin amd64 image's `@img/sharp-libvips-linux-x64@1.3.4` are installed native binaries, not files published in this repository. If these artifacts are distributed in the future, review libvips and bundled native libraries, including LGPL source/relinking requirements. A list of license names or links alone is not evidence of complete redistribution compliance. The v1.3.4 upstream build links multiple dependencies statically into a shared `libvips-cpp` library; replacing that shared library alone does not establish all bundled-library obligations. Preserve the exact binary component versions and matching build/source materials when preparing distribution. Other target architectures must be reviewed using their actual installed binaries.

The [sharp-libvips 1.3.4 source-notice bundle](docs/licenses/supplements/sharp-libvips-1.3.4.json) preserves notices from the 28 component source archives identified by the matching build recipe, plus the GPLv3/LGPLv3 texts. It records source URLs, archive hashes, notice paths, verbatim texts and text hashes. The Linux glibc arm64 and x64 package inventories were matched separately; other platform packages do not inherit this mapping. The collector rejects component-version drift, missing component notices and altered text. The build project's Apache-2.0 license is not substituted for the installed binary's LGPL license. The bundle covers the recorded component notices, not a complete audit of all source-file copyrights, embedded Rust dependencies, patches or redistribution obligations. It adds no generated-artifact publication or distribution requirement to this repository's source-only publication scope.

`pnpm run license:audit` reports missing texts and unknown license identifiers with a nonzero exit status. This diagnostic does not gate GitHub source publication. Even a passing audit checks notice coverage only: container OS/Node components, compiled third-party code without separate notices, source-offer obligations, private assets and model redistribution still require review of the final artifact. Do not describe the inventory or UI as a complete compliance certification.

## Bundled assets

| Asset | Attribution and license | Source |
| --- | --- | --- |
| Noto Sans JP Regular (`packages/documents/fonts/NotoSansJP-Regular.ttf`), embedded in participant PDFs | Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'; SIL Open Font License 1.1 | https://fonts.google.com/noto/specimen/Noto+Sans+JP |

The font's embedded copyright agrees with the preserved [OFL notice](docs/licenses/OFL-1.1.txt). Web and Admin display this notice in `/license`. OFL applies to the font software, not to the contents of documents created using it.

## Local models

Model attribution and terms remain in the selected [LLM configuration](apps/web/README.md#model-configuration). Web displays its model name, provider, license link and note. The configuration is separate from npm dependencies and must be reviewed when explicitly changing models. Displaying metadata does not itself establish permission to redistribute model weights or compliance with use restrictions. The MedGemma preset identifies the [HAI-DEF terms](https://developers.google.com/health-ai-developer-foundations/terms), as specified by the [official model card](https://huggingface.co/google/medgemma-27b-it), and Web supplies a local copy of the terms and prohibited-use policy. Model selection, generation values and prompts are unchanged.

HAI-DEF distribution includes hosted access to model functionality. Its section 3.1 requires the use restrictions to be incorporated into an enforceable user agreement, in addition to supplying the terms and notifying users. Service operation has a separate scope from publishing source/configuration without model weights. Externally provided consent documents remain read-only. The current consent UI collects research-participation checks; it does not explicitly collect a versioned HAI-DEF agreement. The public sample consent has no such provision. A link or expanded terms on `/license` does not demonstrate incorporation into the governing agreement. Before operation, the responsible operator must establish the governing user terms (including section 3.2 and its prohibited-use policy), notification and acceptance process, and whether any regulatory authorization applies. Any change to institutional research documents must follow their owning approval process; a separate service agreement may be appropriate. These service-operation considerations are not additional approval requirements for publishing this source repository.

## License texts

- [Apache License 2.0](docs/licenses/APACHE-2.0.txt)
- [Mozilla Public License 2.0](docs/licenses/MPL-2.0.txt) (retained alternative)
- [BSD 2-Clause License — mammoth](docs/licenses/BSD-2-CLAUSE.txt)
- [SIL Open Font License 1.1 — Noto Sans JP](docs/licenses/OFL-1.1.txt)
- [Generated package-specific texts and notices](docs/licenses/npm-notices.json)
- [HAI-DEF Terms of Use](docs/licenses/HAI-DEF-TERMS.txt) and [Prohibited Use Policy](docs/licenses/HAI-DEF-PROHIBITED-USE.txt)

## Updating the notices and display

1. Install the locked dependencies with `pnpm install --frozen-lockfile`.
2. Run root `pnpm run license` after dependency additions, updates or removals. The workspace-owned [collector](scripts/licenses/collect-license-notices.mjs) reads installed files locally without registry/network lookups and stages the application copies. No dependency table needs manual synchronization.
3. Review the generated diff, missing-text report, upstream NOTICE files, license selections and version-scoped supplements. Preserve third-party text verbatim; do not substitute AERPP's MIT copyright for dependency copyrights. An upstream source supplement needs its source and exact package version recorded.
   For a native source-notice bundle, obtain the component source archives from the matching upstream build recipe, preserve their legal texts verbatim, and record archive/text SHA-256 hashes. Match every component in the target package's `versions.json` before adding a package/version mapping. Routine generation is offline and never downloads sources or substitutes a newer component's notices.
4. Run `pnpm run license:check` to detect stale generated content, and `pnpm run license:audit` for installed-dependency missing-text/unknown-license coverage. A freshness check can pass while the coverage audit fails; this alone does not block source publication.
5. Rebuild and verify the affected `/license` pages and privately built artifacts. The root build checks license traces for every applicable staged notice and rejects private/test paths, credential filenames, all `.env*` names and app/package generated output other than that application's canonical license copies. These trace checks cover the `/license` page's dependencies; they do not inspect every file in an image. Image builds refresh the selected app's inventory from their installed production graph. Review differences across target architectures. Font or model changes require separate attribution/terms review.

The maintenance procedure is also indexed from [development](docs/development.md#dependency-license-reports).
