---
name: repo-code-organization
description: Use when choosing or changing code ownership, definition files, shared UI or infrastructure, and import boundaries in the Web or Admin Next.js app.
---

# Web and Admin code organization

Follow the [shared contributor reference](../../docs/code-organization.md). Source paths in that guide are relative to the affected app; run pnpm commands from the workspace root.

Update the affected app's ownership map when boundaries move. Run the shared `node scripts/checks/check-boundaries.mjs` for affected source imports and the applicable owner checks. It covers Web/Admin layers and cross-app/package boundaries; see the guide for supported syntax and review limits.
