import { resolve } from "node:path"
import { adminSecretNames } from "../admin/secret-names.mjs"
import { privateJson } from "../shared/delivery.mjs"

function secretReferences(value) {
  if (!value || typeof value !== "object") return []
  if (
    Object.keys(value).length === 1 &&
    typeof value.secret === "string" &&
    /^[A-Z][A-Z0-9_]*$/.test(value.secret)
  )
    return [value.secret]
  return Object.values(value).flatMap(secretReferences)
}

export function writeConsoleSettings(directory, config, auto) {
  const project = auto.project
  const consoleUrl = (path) =>
    `https://console.cloud.google.com/${path}?project=${encodeURIComponent(project)}`
  const callback = auto.adminUrl
    ? `${auto.adminUrl}/api/auth/callback/google`
    : null
  const authorizedRedirectUris = [
    callback,
    "http://localhost:3001/api/auth/callback/google",
  ].filter(Boolean)
  const values = {
    _comment:
      "Generated inputs and checks for manual Console setup. DO NOT EDIT. Edit config.json or secret.json and run env:sync. No secrets are included.",
    environment: auto.environment,
    projectId: project,
    ...(config.support
      ? {
          support: {
            gmail: {
              oauthClientsConsoleUrl: consoleUrl("auth/clients"),
              gmailApiConsoleUrl: consoleUrl(
                "apis/library/gmail.googleapis.com",
              ),
              oauthClientType: "Web application",
              downloadedClientJsonDestination: {
                file: "secret.json",
                key: "SUPPORT_GMAIL_OAUTH_CLIENT_JSON",
              },
              authorizedRedirectUris: [
                "https://developers.google.com/oauthplayground",
              ],
              requiredScopes: ["https://www.googleapis.com/auth/gmail.send"],
              senderEmail: config.support.gmail?.sender ?? null,
              note: "Use a separate sender OAuth client and your own credentials in Google OAuth Playground. See docs/setup.md#obtain-the-gmail-refresh-token; keep admission closed until acceptance.",
            },
            contactEmail: config.support.contactEmail ?? null,
            cloudRun: {
              consoleUrl: consoleUrl("run"),
              serviceUrl:
                auto.terraform?.support?.serviceEndpoint?.baseUrl ?? null,
              runtimeServiceAccountEmail:
                auto.terraform?.support?.runtimeServiceAccount ?? null,
              schedulerServiceAccountEmail:
                auto.terraform?.support?.schedulerServiceAccount ?? null,
              note: "Terraform endpoint metadata is not deployment or mail acceptance evidence.",
            },
          },
        }
      : {}),
    admin: {
      googleSignIn: {
        oauthClientsConsoleUrl: consoleUrl("auth/clients"),
        oauthClientType: "Web application",
        downloadedClientJsonDestination: {
          file: "secret.json",
          key: "ADMIN_GOOGLE_OAUTH_CLIENT_JSON",
        },
        authorizedJavaScriptOrigins: [
          ...new Set(authorizedRedirectUris.map((uri) => new URL(uri).origin)),
        ],
        authorizedRedirectUris,
        brandingConsoleUrl: consoleUrl("auth/branding"),
        audienceConsoleUrl: consoleUrl("auth/audience"),
        allowedLoginEmails: config.admin?.ADMIN_ALLOWED_EMAILS ?? "",
        note: "Application allowlist and OAuth audience/test users are separate controls. Set both intentionally.",
      },
      cloudRun: {
        consoleUrl: consoleUrl("run"),
        serviceUrl: auto.adminUrl ?? null,
        runtimeServiceAccountEmail: auto.serviceAccounts?.admin ?? null,
        note: "Assign this service identity on deployment; do not download runtime tokens or service-account private keys. Public invocation for NextAuth is separate from application authorization.",
      },
    },
    accessControl: {
      consoleUrl: consoleUrl("iam-admin/iam"),
      serviceAccountsUrl: consoleUrl("iam-admin/serviceaccounts"),
      serviceAccountRolesToReview: [
        {
          serviceAccountEmail: auto.serviceAccounts?.admin ?? null,
          projectRoles: [
            "roles/datastore.viewer",
            "roles/datastore.user",
            "roles/logging.viewer",
          ],
          secretAccess: {
            role: "roles/secretmanager.secretAccessor",
            secretNames: auto.deployment
              ? Object.values(adminSecretNames(auto.deployment))
              : [],
          },
        },
        {
          serviceAccountEmail: auto.serviceAccounts?.logging ?? null,
          projectRoles: ["roles/logging.logWriter"],
        },
      ],
      localAdminImpersonation: {
        serviceAccountEmail: auto.serviceAccounts?.localAdmin ?? null,
        credentialSource: "gcloud impersonation; no service-account key file",
        operatorAccountEmail: config.infrastructure?.operatorAccount ?? null,
        serviceAccountRole: "roles/iam.serviceAccountTokenCreator",
        requiredProjectRoles: [
          "roles/datastore.viewer",
          "roles/datastore.user",
          "roles/logging.viewer",
        ],
      },
      onPremisesLogging: {
        serviceAccountEmail: auto.serviceAccounts?.logging ?? null,
        credentialSource:
          "secret.json:LOGGING_SERVICE_ACCOUNT_JSON (operator input; runtime credential file is generated)",
        requiredProjectRoles: ["roles/logging.logWriter"],
      },
      deploymentOperator: {
        note: "Grant the deploying identity the required scoped roles; do not grant these to application runtime accounts.",
        rolesToReview: [
          "roles/run.admin",
          "roles/artifactregistry.writer",
          "roles/iam.serviceAccountUser",
          "roles/secretmanager.secretVersionAdder",
        ],
        secretVersionPermissionsToReview: [
          "secretmanager.versions.get",
          "secretmanager.versions.list",
          "secretmanager.versions.add",
          "secretmanager.versions.destroy",
        ],
        setupPermissionsToReview: [
          "serviceusage.services.enable",
          "iam.serviceAccounts.create",
          "iam.serviceAccounts.get",
          "resourcemanager.projects.getIamPolicy",
          "resourcemanager.projects.setIamPolicy",
          "artifactregistry.repositories.create",
          "secretmanager.secrets.create",
          "secretmanager.secrets.setIamPolicy",
        ],
      },
    },
    secretManager: {
      consoleUrl: consoleUrl("security/secret-manager"),
      localSecretFile: "secret.json",
      requiredLocalSecretKeys: [
        ...new Set([
          ...secretReferences(config).filter(
            (key) =>
              ![
                "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
                "SUPPORT_GMAIL_CLIENT_SECRET",
              ].includes(key),
          ),
          ...(config.web
            ? [
                "IDENTIFIER_HASH_SECRET",
                "SESSION_SEAL_PASSWORD",
                "SUPPORT_WEB_API_CREDENTIAL",
              ]
            : []),
          ...(config.admin
            ? [
                "NEXTAUTH_SECRET",
                "ADMIN_GOOGLE_OAUTH_CLIENT_JSON",
                "SESSION_SEAL_PASSWORD",
                "IDENTIFIER_HASH_SECRET",
              ]
            : []),
          ...(config.logging ? ["LOGGING_SERVICE_ACCOUNT_JSON"] : []),
          ...(config.support
            ? [
                "SUPPORT_TOKEN_KEY",
                ...(config.support.gmail
                  ? [
                      "SUPPORT_GMAIL_OAUTH_CLIENT_JSON",
                      "SUPPORT_GMAIL_REFRESH_TOKEN",
                    ]
                  : []),
              ]
            : []),
        ]),
      ],
      secretUploadPolicy: "local to cloud only; never retrieve secret values",
    },
  }
  privateJson(resolve(directory, "console-settings.json"), values)
}
