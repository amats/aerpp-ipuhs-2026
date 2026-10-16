export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
export function throwApiError(
  status: number,
  code: string,
  message: string,
): never {
  throw new ApiError(status, code, message)
}
