import test from "node:test"
import { assertImageCheckCleanup } from "../shared/test-support/image-check.mjs"

test("failed Admin image probes remove temporary settings even when container removal fails", (t) => {
  assertImageCheckCleanup(t, "admin")
})
