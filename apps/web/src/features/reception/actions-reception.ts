"use server"

import { env } from "@aerpp/config/server/web"

export async function getReceptionStatusAction() {
  return {
    remainingMs: Math.max(0, env.receptionExpiresAt.getTime() - Date.now()),
  }
}
