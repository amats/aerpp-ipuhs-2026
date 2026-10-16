export function serviceCredential(project, app) {
  return {
    type: "service_account",
    project_id: project,
    client_email: `${app}-reader@${project}.iam.gserviceaccount.com`,
    private_key: "synthetic-not-a-key",
  }
}
export function adminSecrets(project) {
  return {
    IDENTIFIER_HASH_SECRET: "synthetic-identifier-secret",
    SESSION_SEAL_PASSWORD: "synthetic-email-seal-password-for-tests",
    NEXTAUTH_SECRET: "synthetic-session-secret",
    ADMIN_GOOGLE_OAUTH_CLIENT_JSON: {
      web: {
        project_id: project,
        client_id: "synthetic-admin.apps.googleusercontent.com",
        client_secret: "synthetic-oauth-secret",
      },
    },
  }
}
