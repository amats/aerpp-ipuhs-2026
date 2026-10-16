import { z } from "zod"

const regionSchema = z.string().regex(/^[a-z]+-[a-z]+[0-9]+$/)
const projectSchema = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)
const foundationSchema = z
  .object({
    version: z.literal(1),
    project: projectSchema,
    region: regionSchema,
    repository: z.string(),
    runtimeServiceAccount: z.string(),
    schedulerServiceAccount: z.string(),
    gmailSecretIds: z
      .object({
        clientSecret: z.literal("SUPPORT_GMAIL_CLIENT_SECRET"),
        refreshToken: z.literal("SUPPORT_GMAIL_REFRESH_TOKEN"),
      })
      .strict(),
    serviceEndpoint: z
      .object({
        name: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
        projectNumber: z.string().regex(/^[0-9]{6,20}$/),
        baseUrl: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict()

// Explicit projection: no secret resolution, automatic metadata, or runtime
// settings can become Terraform input through an object spread.
export function deriveSupportTerraformInputs(config, target) {
  if (
    !["test", "production"].includes(target?.name) ||
    config?.version !== 1 ||
    !projectSchema.safeParse(target.project).success ||
    target.project.startsWith("demo-") ||
    !regionSchema.safeParse(config.infrastructure?.region).success
  )
    throw new Error(
      "Support Terraform requires a selected cloud target and infrastructure.region",
    )
  const inputs = {
    project_id: target.project,
    environment: target.name,
    region: config.infrastructure.region,
  }
  if (config.infrastructure.monitoring !== undefined) {
    const monitoring = z
      .object({ notificationEmail: z.email() })
      .strict()
      .safeParse(config.infrastructure.monitoring)
    if (!monitoring.success)
      throw new Error(
        "Invalid infrastructure.monitoring; configure notificationEmail",
      )
    inputs.monitoring = {
      notification_email: monitoring.data.notificationEmail,
    }
  }
  if (config.infrastructure.firestore !== undefined) {
    const firestore = z
      .object({
        location: z.string().regex(/^[a-z][a-z0-9-]+$/),
        manageExistingIndexes: z.boolean().optional(),
        automaticBackups: z.boolean().optional(),
        backupRetentionDays: z.number().int().min(1).max(98).optional(),
      })
      .strict()
      .safeParse(config.infrastructure.firestore)
    if (!firestore.success)
      throw new Error(
        "Invalid infrastructure.firestore; configure location and backup policy",
      )
    if (
      firestore.data.automaticBackups === true &&
      firestore.data.backupRetentionDays === undefined
    )
      throw new Error(
        "Automatic backups require explicit backupRetentionDays (1-98)",
      )
    if (
      firestore.data.automaticBackups !== true &&
      firestore.data.backupRetentionDays !== undefined
    )
      throw new Error("backupRetentionDays requires automaticBackups")
    inputs.firestore = {
      location: firestore.data.location,
      ...(firestore.data.automaticBackups !== undefined
        ? { automatic_backups: firestore.data.automaticBackups }
        : {}),
      ...(firestore.data.backupRetentionDays !== undefined
        ? { backup_retention_days: firestore.data.backupRetentionDays }
        : {}),
      ...(firestore.data.manageExistingIndexes !== undefined
        ? { manage_existing_indexes: firestore.data.manageExistingIndexes }
        : {}),
    }
  }
  return inputs
}

export function validateSupportFoundation(value, target, region) {
  const result = foundationSchema.safeParse(value)
  if (!result.success)
    throw new Error("Invalid support Terraform output contract")
  const data = result.data
  const account = new RegExp(
    `^[a-z][a-z0-9-]{4,28}[a-z0-9]@${data.project}\\.iam\\.gserviceaccount\\.com$`,
  )
  if (
    !["test", "production"].includes(target.name) ||
    data.project !== target.project ||
    (region !== undefined && data.region !== region) ||
    !new RegExp(
      `^projects/${data.project}/locations/${data.region}/repositories/[a-z][a-z0-9-]+$`,
    ).test(data.repository) ||
    !account.test(data.runtimeServiceAccount) ||
    !account.test(data.schedulerServiceAccount) ||
    data.runtimeServiceAccount === data.schedulerServiceAccount
  )
    throw new Error("Support Terraform output target mismatch")
  if (
    data.serviceEndpoint &&
    data.serviceEndpoint.baseUrl !==
      `https://${data.serviceEndpoint.name}-${data.serviceEndpoint.projectNumber}.${data.region}.run.app`
  )
    throw new Error(
      "Support service endpoint does not match Terraform identity",
    )
  return data
}

export function parseSupportTerraformOutputs(outputs, target, region) {
  if (
    !outputs ||
    Object.keys(outputs).length !== 1 ||
    !Object.hasOwn(outputs, "support_foundation") ||
    outputs.support_foundation?.sensitive !== false
  )
    throw new Error("Unexpected or sensitive Terraform outputs")
  return validateSupportFoundation(
    outputs.support_foundation.value,
    target,
    region,
  )
}
