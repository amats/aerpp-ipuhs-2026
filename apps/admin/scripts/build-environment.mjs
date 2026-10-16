export function assertAdminBuildEnvironment(environment, buildId) {
  if (!buildId.startsWith(`aerpp-${environment}-`))
    throw new Error(
      "Admin build differs from the selected environment; rebuild",
    )
}
