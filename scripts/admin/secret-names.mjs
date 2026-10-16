export function adminSecretNames(deployment) {
  return {
    NEXTAUTH_SECRET: `${deployment.service}-session`,
    SESSION_SEAL_PASSWORD: `${deployment.service}-email-seal`,
    IDENTIFIER_HASH_SECRET: `${deployment.service}-identifier-hash`,
    ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: `${deployment.service}-oauth`,
  }
}
