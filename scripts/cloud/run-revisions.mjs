export function protectedRevisionNames(service) {
  const status = service.status
  const named = (value) => typeof value === "string" && value.length > 0
  if (
    Array.isArray(service.spec?.template?.spec?.containers) !== true ||
    service.spec.template.spec.containers.length === 0 ||
    named(status?.latestCreatedRevisionName) !== true ||
    named(status?.latestReadyRevisionName) !== true ||
    Array.isArray(status?.traffic) !== true ||
    status.traffic.length === 0 ||
    (service.spec.traffic !== undefined &&
      Array.isArray(service.spec.traffic) !== true)
  )
    throw new Error("Incomplete Cloud Run service inventory")
  const names = new Set([
    status.latestCreatedRevisionName,
    status.latestReadyRevisionName,
  ])
  // Desired traffic can lead observed status during a rollout. Protect both.
  for (const traffic of [...status.traffic, ...(service.spec.traffic ?? [])]) {
    const name =
      traffic?.revisionName ??
      (traffic?.latestRevision === true
        ? status.latestReadyRevisionName
        : undefined)
    if (named(name) !== true)
      throw new Error("Cannot resolve Cloud Run traffic target")
    names.add(name)
  }
  return [...names]
}
