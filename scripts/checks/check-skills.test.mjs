import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { findSkillViolations } from "./check-skills.mjs"
import { createWorkspace } from "./test-support/workspace.mjs"

function workspace(t) {
  const { root, write } = createWorkspace(t, "aerpp-guidance-")
  write("package.json", { name: "aerpp", scripts: { verify: "node --test" } })
  write("AGENTS.md", "[Web](apps/web/AGENTS.md)\n")
  for (const app of ["web", "admin", "support"]) {
    write(`apps/${app}/package.json`, {
      name: `@aerpp/${app}`,
      scripts: { test: "vitest" },
    })
    write(`apps/${app}/AGENTS.md`, "Run `pnpm run verify`.\n")
  }
  const addSkill = (owner, name, body = "") => {
    write(
      `${owner}/AGENTS.md`,
      `- \`${name}\`: [guidance](skills/${name}/SKILL.md)\n`,
    )
    write(
      `${owner}/skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: Apply this specific procedure.\n---\n${body}`,
    )
  }
  return { root, write, addSkill }
}

test("accepts root guidance commands, filtered app commands and linked references", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill(
    "apps/web",
    "repo-testing",
    "Run `pnpm run verify`, `pnpm --filter @aerpp/web run test` and `pnpm --filter @aerpp/support run test`. [Details](references/test.md)\nUse `src/features/**` and `actions-example.ts`. [External](https://example.com)\n",
  )
  write(
    "apps/web/skills/repo-testing/references/test.md",
    "Run `pnpm run verify`. [Agent](../../../AGENTS.md)\n",
  )
  assert.deepEqual(findSkillViolations(root), [])
})

test("rejects commands in the wrong package and removed filtered commands", (t) => {
  const { root, addSkill } = workspace(t)
  addSkill(
    "apps/admin",
    "repo-admin",
    "`pnpm run test`\n`pnpm --filter @aerpp/support run missing`\n`pnpm --filter @aerpp/absent run test`\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/admin/skills/repo-admin/SKILL.md: unknown pnpm script (test)",
    "apps/admin/skills/repo-admin/SKILL.md: unknown pnpm script (@aerpp/support: missing)",
    "apps/admin/skills/repo-admin/SKILL.md: unknown workspace package (@aerpp/absent)",
  ])
})

test("uses root scripts for shared and package skills and rejects app-only commands in references", (t) => {
  const { root, write, addSkill } = workspace(t)
  write(
    "packages/config/package.json",
    JSON.stringify({ name: "@aerpp/config", scripts: { test: "node --test" } }),
  )
  addSkill(".", "repo-shared", "Run `pnpm run verify`.\n")
  addSkill("packages/config", "repo-config", "Run `pnpm run verify`.\n")
  addSkill("apps/web", "repo-web", "[Details](references/CONTRIBUTING.md)\n")
  write(
    "apps/web/skills/repo-web/references/CONTRIBUTING.md",
    "Run `pnpm run test`.\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/skills/repo-web/references/CONTRIBUTING.md: unknown pnpm script (test)",
  ])
})

test("resolves contributor commands at the root and accepts explicit package selection", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/web/CONTRIBUTING.md",
    "`pnpm run test`\n" +
      "`pnpm -w run verify`\n" +
      "`pnpm --workspace-root run verify`\n" +
      "`pnpm --filter @aerpp/support run test`\n" +
      "`pnpm run verify`\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/CONTRIBUTING.md: unknown pnpm script (test)",
  ])
})

test("checks linked supporting references after a move", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill("apps/web", "repo-testing", "[Details](references/test.md)\n")
  write(
    "apps/web/skills/repo-testing/references/test.md",
    "Use `scripts/missing.mjs` and [Old](../../repo-old/SKILL.md).\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/skills/repo-testing/references/test.md: missing repository path (scripts/missing.mjs)",
    "apps/web/skills/repo-testing/references/test.md: missing link target (../../repo-old/SKILL.md)",
  ])
})

test("guidance checks require tracked research assets and application source paths", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/web/CONTRIBUTING.md",
    "Shared assets: `src/assets` and `src/assets/consent.pdf`.\n" +
      "Required source: `src/features/pdf/read-pdf.ts`, `src/assets-helper.ts` and `src/assets/../missing.ts`.\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/CONTRIBUTING.md: missing repository path (src/assets)",
    "apps/web/CONTRIBUTING.md: missing repository path (src/assets/consent.pdf)",
    "apps/web/CONTRIBUTING.md: missing repository path (src/features/pdf/read-pdf.ts)",
    "apps/web/CONTRIBUTING.md: missing repository path (src/assets-helper.ts)",
    "apps/web/CONTRIBUTING.md: missing repository path (src/assets/../missing.ts)",
  ])
})

test("requires an indexed skill and a real linked entrypoint", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill("apps/web", "repo-testing")
  write("apps/web/AGENTS.md", "- `repo-gone`: removed\n")
  const violations = findSkillViolations(root)
  assert.ok(
    violations.includes(
      "apps/web/AGENTS.md: indexed skill does not exist (repo-gone)",
    ),
  )
  assert.ok(
    violations.includes(
      "apps/web/skills/repo-testing/SKILL.md: skill is not indexed in AGENTS.md",
    ),
  )
})

test("rejects a missing entrypoint", (t) => {
  const { root, addSkill } = workspace(t)
  addSkill("apps/web", "repo-testing")
  rmSync(path.join(root, "apps/web/skills/repo-testing/SKILL.md"))
  assert.ok(
    findSkillViolations(root).includes(
      "apps/web/skills/repo-testing/SKILL.md: missing skill entrypoint",
    ),
  )
})

test("requires an indexed name to link directly to its own entrypoint", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill("apps/web", "repo-testing")
  write("apps/web/AGENTS.md", "- `repo-testing`: [guidance](CONTRIBUTING.md)\n")
  write("apps/web/CONTRIBUTING.md", "Web contributor guidance.\n")
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/AGENTS.md: skill index needs a direct entrypoint link (repo-testing)",
  ])
})

test("detects duplicate names across shared and app skills", (t) => {
  const { root, addSkill } = workspace(t)
  addSkill(".", "repo-testing")
  addSkill("apps/web", "repo-testing")
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/skills/repo-testing/SKILL.md: duplicate workspace skill name (repo-testing)",
  ])
})

test("rejects frontmatter mismatches and missing descriptions", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill("packages/config", "repo-config")
  write(
    "packages/config/skills/repo-config/SKILL.md",
    "---\nname: repo-other\n---\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "packages/config/skills/repo-config/SKILL.md: expected matching name and nonempty description in frontmatter",
  ])
})

test("checks Support agent links without requiring a skills directory", (t) => {
  const { root, write } = workspace(t)
  write("apps/support/AGENTS.md", "[Missing](missing.md)\n")
  assert.deepEqual(findSkillViolations(root), [
    "apps/support/AGENTS.md: missing link target (missing.md)",
  ])
})

test("shares Markdown link handling with documentation checks", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill(
    "apps/web",
    "repo-links",
    [
      "[Encoded](references/my%20guide.md#setup)",
      "[Angle](<references/my guide.md#setup>)",
      "[Reference][setup]",
      "[setup]: <references/my guide.md#setup>",
      "`[Example](missing.md)`",
      "<!-- [Retired](old.md) -->",
      "```md\n[Example](missing.md)\n```",
    ].join("\n"),
  )
  write("apps/web/skills/repo-links/references/my guide.md", "# Setup\n")
  assert.deepEqual(findSkillViolations(root), [])
})

test("excludes private, generated and installed files from skill references", (t) => {
  const { root, write, addSkill } = workspace(t)
  addSkill("apps/web", "repo-testing", "[Details](references/test.md)\n")
  write("apps/web/skills/repo-testing/references/test.md", "# Guide\n")
  for (const directory of [
    "private",
    "generated",
    "node_modules",
    ".terraform",
  ])
    write(
      `apps/web/skills/repo-testing/references/${directory}/README.md`,
      "[Missing](absent.md)\n`pnpm run removed`\nUse `src/missing.ts`.\n",
    )
  assert.deepEqual(findSkillViolations(root), [])
  write(
    "apps/web/skills/repo-testing/references/test.md",
    "[Missing](absent.md)\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/skills/repo-testing/references/test.md: missing link target (absent.md)",
  ])
})

test("detects broken fragments and reference definitions in guidance", (t) => {
  const { root, write } = workspace(t)
  write(
    "apps/support/AGENTS.md",
    "# Support\n[Gone](#removed)\n[Reference][missing]\n[missing]: absent.md\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/support/AGENTS.md: missing heading anchor (#removed)",
    "apps/support/AGENTS.md: missing link target (absent.md)",
  ])
})

test("resolves workspace-root and filtered scripts with pnpm option combinations", (t) => {
  const { root, addSkill } = workspace(t)
  addSkill(
    "apps/web",
    "repo-commands",
    "`pnpm --workspace-root run verify`\n" +
      "`pnpm -w run verify`\n" +
      "`pnpm --fail-if-no-match --filter @aerpp/support run test`\n" +
      "`pnpm --filter @aerpp/support --fail-if-no-match run test`\n" +
      "`pnpm --workspace-root run test`\n" +
      "`pnpm --fail-if-no-match --filter @aerpp/support run missing`\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "apps/web/skills/repo-commands/SKILL.md: unknown pnpm script (test)",
    "apps/web/skills/repo-commands/SKILL.md: unknown pnpm script (@aerpp/support: missing)",
  ])
})

test("does not silently skip skills outside the repository namespace", (t) => {
  const { root, write } = workspace(t)
  write(
    "skills/other/SKILL.md",
    "---\nname: other\ndescription: Apply this procedure.\n---\n",
  )
  assert.deepEqual(findSkillViolations(root), [
    "skills/other/SKILL.md: expected repo-<purpose> skill directory (other)",
    "skills/other/SKILL.md: skill is not indexed in AGENTS.md",
  ])
})
