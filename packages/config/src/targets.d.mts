export type CloudProjects = { test?: string; production?: string }
export type Target = {
  name: string
  project: string
}
export function loadCloudProjects(
  selected?: string,
  readConfig?: (name: string) => { projectId?: string } | undefined,
): CloudProjects
export function environmentTarget(
  name: string,
  projects?: CloudProjects,
): Target
