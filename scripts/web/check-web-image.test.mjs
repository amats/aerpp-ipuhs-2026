import test from "node:test"
import { assertImageCheckCleanup } from "../shared/test-support/image-check.mjs"

test("Web image checks accept the complete asset manifest and remove settings after failed probes and container removal", (t) => {
  assertImageCheckCleanup(t, "web")
})
