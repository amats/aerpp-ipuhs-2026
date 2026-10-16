import { readSupportEnvironment } from "@aerpp/config/support"
import { Firestore } from "@google-cloud/firestore"
import { createSupportApp } from "./app.js"
import { logger } from "./logger.js"
import { GmailMailer, type Mailer, MailSink } from "./mail.js"

try {
  const runtime = readSupportEnvironment(process.env)
  if (runtime.environment === "local")
    process.env.METADATA_SERVER_DETECTION = "none"
  const database = new Firestore({ projectId: runtime.projectId })
  let mailer: Mailer
  if (runtime.mailMode === "sink") mailer = new MailSink()
  else {
    if (!runtime.gmail) throw new Error("Missing Gmail configuration")
    mailer = new GmailMailer(runtime.gmail)
  }
  const port = Number(process.env.PORT ?? "8080")
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port")
  const server = createSupportApp(runtime, database, mailer).listen(
    port,
    runtime.environment === "local"
      ? new URL(runtime.baseUrl).hostname.replace(/^\[|\]$/g, "")
      : "0.0.0.0",
    () => {
      logger.info({ operation: "startup" }, "Support server ready")
    },
  )
  server.on("error", () => {
    logger.error(
      { operation: "startup", code: "LISTEN_FAILED" },
      "Support listener failed",
    )
    process.exit(1)
  })
  const shutdown = () => {
    server.close(() => {
      void database.terminate().then(
        () => process.exit(0),
        () => {
          logger.error(
            { operation: "shutdown", code: "SHUTDOWN_FAILED" },
            "Support shutdown failed",
          )
          process.exit(1)
        },
      )
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
} catch {
  logger.error(
    { operation: "startup", code: "INVALID_CONFIGURATION" },
    "Support startup failed; check required configuration",
  )
  process.exitCode = 1
}
