# Shared application inputs

This public directory contains environment-independent configuration used directly by the applications. Keep credentials, project identifiers and participant data out of these files. Environment-specific decisions and secrets remain in the private profiles described in the [configuration guide](../../docs/configuration.md); `config/example/` contains their templates.

| Directory | Purpose |
| --- | --- |
| `documents/` | Human version input for the exact-byte MDX/PDF [document set](../../docs/document-sets.md), fixed into Web builds and retained on consent/withdrawal records. |
| `llm/` | Local LLM presets, including model, generation settings, prompts and license metadata. `web.llmPresetFile` selects a filename here; the default is `lms-medgemma.json`. |
| `survey/` | The authoritative `survey-initial.json` and `survey-follow-up.json` consumed by Web in every environment and archived by content hash for Admin research ZIPs. There is no environment-specific selection or copy into either Web asset directory. |

Web Docker and standalone builds include the required shared inputs. Source builds and isolated tests use the same configuration paths. A built image does not read later changes in this checkout. Admin reads archived questionnaire definitions for research ZIPs and archived document originals for explicit verification/reissue; it does not bundle these source inputs.

Follow the [questionnaire definition and replacement procedure](../../docs/examples.md#questionnaire-definitions) when editing surveys: stop operation, validate the definitions, rebuild Web, register its canonical questionnaire definitions, then export the bundle before restarting. Keep `survey_version` as a nonempty string; it remains descriptive metadata while the canonical hash identifies the exact definition. Preserve model settings and prompts unless an intentional model change has been authorized; see [local model settings](../../docs/examples.md#local-model-settings).

From the repository root, verify changes with `pnpm run verify`, `pnpm run build`, `pnpm run test:e2e:web`, and `pnpm run test:e2e:admin`. Validate the selected application profile separately with `pnpm run env:check <environment> <app>`; local results do not establish cloud or local-model acceptance.
