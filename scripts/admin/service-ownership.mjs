export function assertServiceOwnership(service, environment) {
  const expected = {
    "aerpp-component": "admin",
    "aerpp-environment": environment,
  }
  const templateLabels = service.spec?.template?.metadata?.labels
  const serviceLabels = service.metadata?.labels
  for (const [key, value] of Object.entries(expected)) {
    if (
      templateLabels?.[key] !== value ||
      (serviceLabels?.[key] !== undefined && serviceLabels[key] !== value)
    )
      throw new Error(
        "Existing service is not owned by this Admin deployment workflow",
      )
  }
}
