# Participant PDF rendering

`@aerpp/documents/pdf` owns shared server-side rendering for Web downloads and Admin reissue. It generates PDF bytes in RAM without storing or logging filled copies. [Document sets](../../docs/document-sets.md) owns original identity, archives and accepted-record binding; [identifier contracts](../../docs/identifiers.md) owns PID/DID derivation.

## Rendering boundary

The [source entrypoint](src/pdf.ts) exports two functions:

| Function | Responsibility |
| --- | --- |
| `readDocumentFont(workspaceDirectory)` | Read the bundled Japanese font using the explicitly supplied workspace root |
| `renderDocumentPdf(templateBytes, fontBytes, documentSet, participant?)` | Render the version footer; when participant fields are supplied, fill email/date, flatten form fields and draw the caller-supplied DID and document-set SHA-256 |

Callers authorize the request, select the accepted participation record, verify the matching original and derive the original date, email and DID. The renderer validates the version/hash shape; it does not fetch archives, verify original hashes or establish participant ownership. Missing required form fields or pages fail rendering. Explanation and plan downloads omit participant fields and receive only the version footer.

Web owns current and historical download selection in its [PDF feature](../../apps/web/src/features/pdf/). Admin owns record selection, authorization and reissue audit in its [reissue action](../../apps/admin/src/features/participant/actions-document-reissue.ts). Preserve these application boundaries when changing shared rendering.

## Runtime and font delivery

`@aerpp/documents/pdf` exports its TypeScript source, which is also the type contract; there is no separate hand-maintained declaration or package build. Web/Admin bundle it through Next.js. Local PDF tooling runs the linked workspace source with Node.js 24 type stripping. Keep the source compatible with `erasableSyntaxOnly`; raw TypeScript under an installed `node_modules` directory is not a supported standalone distribution.

`fonts/NotoSansJP-Regular.ttf` is the single source copy. Web, Admin and the PDF check command load it through `readDocumentFont(workspaceDirectory)`. Callers pass the installation workspace root, and both Next.js configurations explicitly trace the shared font. Each application image includes this package file once. The font is for PDF generation and does not change browser typography.

The font uses the bundled [SIL Open Font License](../../docs/licenses/OFL-1.1.txt). The [LibPDF patch guide](../../patches/README.md) explains the maintained Japanese Unicode handling. Preserve the font, patch and [distribution notices](../../THIRD_PARTY_NOTICES.md) together on dependency or artifact changes.

## Verification

Run `pnpm run check:documents` from the workspace root for strict TypeScript, style and import-boundary checks. Root `typecheck` includes its compiler check, and `verify` runs the complete package check.

Web PDF unit suites exercise rendering and Japanese Unicode mappings through the shared implementation; Admin tests cover authorized reissue and audit handling. The [PDF form check](../../apps/web/docs/testing.md#pdf-form-test) uses synthetic participant fields with the selected research templates and writes local review outputs. Inspect those PDFs for Japanese text, footer positioning and clipping. Source templates remain read-only during verification.

Use the [change-based verification matrix](../../docs/development.md#verification-by-change) for consumer checks, font/build tracing and browser download changes. Package checks alone do not establish visual correctness or operational archive access.
