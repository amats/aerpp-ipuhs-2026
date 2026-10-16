import pino from "pino"

// Boundary callers supply only operation names, fixed codes and aggregate counts.
// Never serialize requests, bodies, credentials, URLs or raw SDK exceptions.
export const logger = pino({
  base: undefined,
  level: "info",
  messageKey: "message",
  formatters: {
    level(label) {
      const severity =
        label === "warn"
          ? "WARNING"
          : label === "fatal"
            ? "CRITICAL"
            : label.toUpperCase()
      return { severity }
    },
  },
})
