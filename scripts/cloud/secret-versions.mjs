import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { gcloud, privateJson, readJson } from "../shared/delivery.mjs"
import { protectedRevisionNames } from "./run-revisions.mjs"

export function versionId(value, secret) {
  const match =
    /^projects\/[^/]+\/secrets\/([^/]+)\/versions\/([1-9][0-9]*)$/.exec(
      value ?? "",
    )
  if (!match || match[1] !== secret)
    throw new Error("Invalid secret version metadata")
  return match[2]
}

export function prepareSecretVersion(
  project,
  secret,
  value,
  output,
  execute = gcloud,
) {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(secret) ||
    typeof value !== "string" ||
    !value.length
  )
    throw new Error("Invalid secret preparation input")
  const file = resolve(output, `secret-version-${secret}.json`)
  const sha256 = createHash("sha256").update(value).digest("hex")
  const previous = existsSync(file)
    ? readJson(file, "Secret upload receipt")
    : undefined
  if (previous && (previous.project !== project || previous.secret !== secret))
    throw new Error("Secret upload receipt target mismatch")
  // Only our successful upload receipt can establish byte equality. Never access cloud payloads.
  if (previous?.sha256 === sha256) {
    const versions = JSON.parse(
      execute(project, [
        "secrets",
        "versions",
        "list",
        secret,
        "--format=json(name,state,createTime)",
      ]),
    )
    const match = versions.find(
      (item) =>
        item.name === previous.name &&
        item.createTime === previous.createTime &&
        item.state === "ENABLED",
    )
    if (match) return versionId(match.name, secret)
  }
  const uploaded = JSON.parse(
    execute(
      project,
      [
        "secrets",
        "versions",
        "add",
        secret,
        "--data-file=-",
        "--format=json(name,state,createTime)",
      ],
      { input: value },
    ),
  )
  const version = versionId(uploaded.name, secret)
  if (
    uploaded.state !== "ENABLED" ||
    !Number.isFinite(Date.parse(uploaded.createTime))
  )
    throw new Error("Secret upload did not return enabled version metadata")
  // Persist immediately so later image/promotion failures do not cause duplicate uploads on retry.
  privateJson(file, {
    _comment: "Generated private secret upload receipt; do not edit",
    project,
    secret,
    sha256,
    name: uploaded.name,
    createTime: uploaded.createTime,
  })
  return version
}

export function selectSecretDestruction(versions, secret, pins) {
  const byId = new Map()
  for (const version of versions) {
    const id = versionId(version.name, secret)
    if (
      byId.has(id) ||
      !["ENABLED", "DISABLED", "DESTROYED"].includes(version.state)
    )
      throw new Error("Invalid secret version inventory")
    byId.set(id, version)
  }
  for (const pin of pins) {
    if (!/^[1-9][0-9]*$/.test(pin) || byId.get(pin)?.state !== "ENABLED")
      throw new Error("Protected secret version is missing or unavailable")
  }
  const active = [...byId.keys()]
    .filter((id) => byId.get(id).state !== "DESTROYED")
    .sort((a, b) => (BigInt(a) < BigInt(b) ? 1 : -1))
  const keep = new Set([...pins, ...active.slice(0, 1)])
  return active.filter((id) => !keep.has(id)).reverse()
}

export function retainedSecretVersions(
  services,
  revisions,
  secrets,
  projectIds,
) {
  const pins = Object.fromEntries(secrets.map((secret) => [secret, new Set()]))
  const inspect = (template) => {
    const aliases =
      template.metadata?.annotations?.["run.googleapis.com/secrets"]
    const aliasMap = {}
    for (const entry of aliases?.split(",") ?? []) {
      const parts = entry.split(":")
      if (
        parts.length !== 2 ||
        !parts.every(Boolean) ||
        Object.hasOwn(aliasMap, parts[0])
      )
        throw new Error("Invalid Cloud Run secret aliases")
      aliasMap[parts[0]] = parts[1]
    }
    const add = (name, version) => {
      name = aliasMap[name] ?? name
      const parts = name?.split("/") ?? []
      const secret = parts.at(-1)
      if (!pins[secret]) return
      if (
        parts.length !== 1 &&
        (parts.length !== 4 ||
          parts[0] !== "projects" ||
          parts[2] !== "secrets" ||
          !projectIds.includes(parts[1]))
      )
        throw new Error("Cross-project secret reference")
      if (!/^[1-9][0-9]*$/.test(version ?? ""))
        throw new Error("Protected secret must use a numeric version")
      pins[secret].add(version)
    }
    for (const container of template.spec?.containers ?? [])
      for (const env of container.env ?? [])
        if (env.valueFrom?.secretKeyRef)
          add(env.valueFrom.secretKeyRef.name, env.valueFrom.secretKeyRef.key)
    for (const volume of template.spec?.volumes ?? []) {
      if (!volume.secret) continue
      if (!volume.secret.items?.length) add(volume.secret.secretName, "latest")
      for (const item of volume.secret.items ?? [])
        add(volume.secret.secretName, item.key)
    }
  }
  const names = new Set()
  for (const service of services) {
    for (const name of protectedRevisionNames(service)) names.add(name)
    inspect(service.spec.template)
  }
  for (const name of names) {
    const revision = revisions.find((item) => item.metadata?.name === name)
    if (!revision?.spec?.containers?.length)
      throw new Error("Cannot resolve protected Cloud Run revision")
    inspect(revision)
  }
  return Object.fromEntries(
    Object.entries(pins).map(([secret, versions]) => [
      secret,
      [...versions].sort(),
    ]),
  )
}
