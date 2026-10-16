import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { applicationEnvironment } from "@aerpp/config/process"
import { env } from "@aerpp/config/server/admin"
import { OAuth2Client } from "google-auth-library"

const execute = promisify(execFile)

export function createLocalAuthClient(
  project: string,
  operator: string,
  serviceAccount: string,
  configDirectory: string | undefined,
  requestToken = async (
    args: string[],
    environment: Record<string, string | undefined>,
  ) => {
    const result = await execute("gcloud", args, {
      env: { ...environment, NODE_ENV: "production" },
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    })
    return result.stdout.trim()
  },
) {
  if (
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator) ||
    serviceAccount !== `aerpp-admin-local@${project}.iam.gserviceaccount.com`
  ) {
    throw new Error("Invalid selected local Admin identity")
  }
  const client = new OAuth2Client()
  client.refreshHandler = async () => {
    try {
      const accessToken = await requestToken(
        [
          "auth",
          "print-access-token",
          `--account=${operator}`,
          `--project=${project}`,
          `--impersonate-service-account=${serviceAccount}`,
          "--quiet",
        ],
        {
          ...applicationEnvironment({}),
          ...(configDirectory ? { CLOUDSDK_CONFIG: configDirectory } : {}),
          CLOUDSDK_AUTH_ACCESS_TOKEN: "",
          CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: "",
          CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "",
          CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: "",
        },
      )
      if (!accessToken || /\s/.test(accessToken)) throw new Error()
      return {
        access_token: accessToken,
        expiry_date: Date.now() + 50 * 60_000,
      }
    } catch {
      throw new Error(
        "Local Admin authentication failed; verify the selected gcloud login and Terraform IAM",
      )
    }
  }
  return client
}

export const googleClientOptions = {
  projectId: env.gcpProjectId,
  ...(env.localGoogleAccount && env.localServiceAccount && env.gcpProjectId
    ? {
        authClient: createLocalAuthClient(
          env.gcpProjectId,
          env.localGoogleAccount,
          env.localServiceAccount,
          env.gcloudConfigDirectory,
        ),
      }
    : {}),
}
