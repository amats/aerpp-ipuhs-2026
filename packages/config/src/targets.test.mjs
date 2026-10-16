import assert from "node:assert/strict"
import test from "node:test"
import { environmentTarget, loadCloudProjects } from "./targets.mjs"

test("selected project validation does not depend on unfinished other-environment settings", () => {
  const read = (name) => ({
    projectId: name === "test" ? "synthetic-test" : "YOUR_PROJECT",
  })
  assert.equal(
    environmentTarget("test", loadCloudProjects("test", read)).project,
    "synthetic-test",
  )
  assert.throws(() => loadCloudProjects("production", read))
  assert.equal(
    environmentTarget(
      "test",
      loadCloudProjects("test", (name) => {
        if (name === "production") throw new Error("unfinished JSON")
        return read(name)
      }),
    ).project,
    "synthetic-test",
  )
})

test("cloud environments reject shared projects and never fall back to another environment", () => {
  const projects = {
    test: "synthetic-test",
    production: "synthetic-production",
  }
  for (const name of ["test", "production"])
    assert.equal(environmentTarget(name, projects).project, projects[name])
  assert.throws(() => environmentTarget("production", { test: projects.test }))
  assert.throws(() =>
    environmentTarget("test", {
      test: projects.test,
      production: projects.test,
    }),
  )
  assert.throws(() =>
    loadCloudProjects("test", () => ({ projectId: projects.test })),
  )
})
