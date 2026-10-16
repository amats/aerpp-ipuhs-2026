import { rolldown } from "rolldown"

const bundle = await rolldown({
  input: { server: "src/server.ts", mail: "src/mail.ts" },
  platform: "node",
  external: [
    "express",
    "pino",
    "@google-cloud/firestore",
    "google-auth-library",
    "zod",
  ],
})
await bundle.write({ dir: "dist", entryFileNames: "[name].mjs", format: "esm" })
await bundle.close()
