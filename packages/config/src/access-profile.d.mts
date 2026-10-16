export interface AccessProfile {
  notBefore: string
  expiresAt: string
  backendStopsAt: string
  revoked: boolean
}
export function readAccessProfile(input: unknown): AccessProfile
