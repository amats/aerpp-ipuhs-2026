import "server-only"
import { readAdminEnvironment } from "./admin.mjs"

export const env = readAdminEnvironment(process.env)
