"use server"

import { env } from "@aerpp/config/server/web"
import type { InformationTone } from "@aerpp/participant-api-contracts/participant-api"
import { headers } from "next/headers"
import { fetchWithRetry } from "@/lib/fetch-with-retry"
import { createLogger, getRequestContextFromHeaders } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { safeParseApiSuccess } from "@/lib/participant-api-contract-helpers"
import { participantApiHeaders } from "@/lib/participant-api-headers"

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_REQUEST_RETRIES = 0

export type InformationMessage = {
  id: string
  content: string
  tone: InformationTone
}

async function createInformationLogger(operation: string) {
  const headerStore = await headers()
  return createLogger({
    ...getRequestContextFromHeaders(headerStore),
    component: "information",
    operation,
  })
}

async function fetchInformationApi({
  logger,
}: {
  logger: ReturnType<typeof createLogger>
}) {
  return fetchWithRetry(
    env.getInformationUrl,
    {
      method: "GET",
      headers: {
        ...participantApiHeaders(),
      },
    },
    {
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      logging: {
        dependency: "get_information",
        logger,
        target: "participant_api",
      },
      retries: DEFAULT_REQUEST_RETRIES,
    },
  )
}

function parseInformationMessages(input: unknown): InformationMessage[] | null {
  const parsedResponse = safeParseApiSuccess("getInformation", input)
  if (!parsedResponse.success) {
    return null
  }

  return parsedResponse.data.messages.map(({ id, content, tone }) => ({
    id,
    content,
    tone,
  }))
}

export async function getInformationMessagesAction(): Promise<
  InformationMessage[] | null
> {
  const logger = await createInformationLogger("get_messages")

  try {
    const response = await fetchInformationApi({ logger })
    if (response.ok !== true) {
      logger.error({
        dependency: "get_information",
        event: LOG_EVENT.dependencyRequestFailed,
        outcome: "failed",
        statusCode: response.status,
        target: "participant_api",
      })
      return null
    }

    const messages = parseInformationMessages(await response.json())
    if (!messages) {
      logger.error({
        dependency: "get_information",
        event: LOG_EVENT.dependencyRequestFailed,
        operation: "invalid_response",
        outcome: "failed",
        target: "participant_api",
      })
      return null
    }

    return messages
  } catch (error) {
    logger.error({
      dependency: "get_information",
      error,
      event: LOG_EVENT.dependencyRequestFailed,
      outcome: "failed",
      target: "participant_api",
    })
    return null
  }
}
