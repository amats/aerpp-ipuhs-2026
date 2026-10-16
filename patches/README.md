# Dependency patches

`@libpdf__core@0.5.2.patch` is applied by pnpm through the root workspace configuration. Keep the patch in Docker dependency stages before frozen installation.

LibPDF 0.5.2 still needs both fixes: without the patch, the Japanese date ToUnicode regression test fails and the shared templates produce Type1 fallback-parser warnings. The patch is retained from 0.5.1; remove it only after an upstream release passes these checks unpatched.

The patch retains the actual Unicode mappings of used glyphs during full-font embedding, including Japanese characters outside LibPDF's default lookup ranges. It also uses a suitable explicitly assigned field font before parsing unused fallback fonts; this avoids Type1 parser warnings from preserved template resources.

The upstream package remains MIT-licensed, with its FontBox-derived code under Apache-2.0; the root license inventory and supplements preserve those texts. AERPP's changes do not alter these licenses.

Before upgrading or removing the patch, run the Web PDF tests and shared-template PDF checks described in [Web PDF checks](../apps/web/docs/testing.md#pdf-form-test). Verify Japanese date copy/search as well as rendering. `apps/web/scripts/test-pdf.test.ts` checks the generated ToUnicode maps independently with `pdf-lib`.
