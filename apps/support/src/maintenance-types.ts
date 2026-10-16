import type { TokenPayload } from "google-auth-library"

export type OidcVerifier = (
  token: string,
  audience: string,
) => Promise<TokenPayload | undefined>
