---
name: repo-logging
description: Use when changing Web structured log events, sanitized context, request IDs or dependency retry logging; workspace logging rules apply separately to all apps.
---

# Web structured logging

Follow the [Web logging contract](../../docs/logging.md) alongside the workspace privacy rules. Source paths are relative to `apps/web`; run pnpm commands from the workspace root.

When adding a log field or event, update the allowlist and nearby tests. Review emitted context for privacy before running the Web checks.
