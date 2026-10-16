import {
  ApiContracts,
  ErrorResponseSchema,
} from "@aerpp/participant-api-contracts/participant-api"
import type { z } from "zod"

type ApiContractName = keyof typeof ApiContracts
type ApiContract<Name extends ApiContractName> = (typeof ApiContracts)[Name]

type ContractNameWithKey<Key extends string> = {
  [Name in ApiContractName]: Key extends keyof ApiContract<Name> ? Name : never
}[ApiContractName]

type InferSchema<TSchema> = TSchema extends z.ZodTypeAny
  ? z.infer<TSchema>
  : never

type ApiRequestContractName = ContractNameWithKey<"request">
type ApiSuccessContractName = ContractNameWithKey<"success">

export type ApiRequest<Name extends ApiRequestContractName> = InferSchema<
  ApiContract<Name>["request"]
>

// Parses the shared participant API contract at the Web boundary.
export function safeParseApiSuccess<Name extends ApiSuccessContractName>(
  name: Name,
  input: unknown,
): ReturnType<ApiContract<Name>["success"]["safeParse"]> {
  return ApiContracts[name].success.safeParse(input) as ReturnType<
    ApiContract<Name>["success"]["safeParse"]
  >
}

export function safeParseApiRequest<Name extends ApiRequestContractName>(
  name: Name,
  input: unknown,
): ReturnType<ApiContract<Name>["request"]["safeParse"]> {
  return ApiContracts[name].request.safeParse(input) as ReturnType<
    ApiContract<Name>["request"]["safeParse"]
  >
}

// A successful transport status alone is not confirmation of the operation.
export async function isApiSuccess<Name extends ApiSuccessContractName>(
  name: Name,
  response: Response,
): Promise<boolean> {
  if (response.status !== 200) return false
  const body: unknown = await response.json().catch(() => undefined)
  return safeParseApiSuccess(name, body).success
}

export async function readApiErrorCode(
  response: Response,
): Promise<string | null> {
  const body: unknown = await response.json().catch(() => undefined)
  const parsed = ErrorResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.code : null
}
