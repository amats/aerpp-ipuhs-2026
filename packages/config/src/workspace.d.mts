import type { Environment } from "./index.mjs"
import type { Application } from "./safety.mjs"
import type { CloudProjects, Target } from "./targets.mjs"
export const ROOT: string
export function environmentDirectory(name: string, root?: string): string
export function generatedEnvironmentDirectory(
  name: string,
  root?: string,
): string
export function initializeEnvironment(
  name: string,
  directory: string,
  projects?: CloudProjects,
): void
export function prepareApplicationRuntime(
  name: string,
  directory: string,
  options?: { projects?: CloudProjects; apps?: Application | Application[] },
): { target: Target; values: Record<string, Record<string, string>> }
export function validateTargetValues(
  target: Target,
  values: Record<string, Environment>,
): void
export function checkApplication(
  app: string,
  env: Environment,
  environment: string,
): void
export function checkCredential(
  file: string | undefined,
  project: string,
  label: string,
  expectedEmail?: string,
): void
export function checkEnvironment(
  name: string,
  directory: string,
  projects?: CloudProjects,
  selectedApp?: Application,
): void
export function generateEnvironment(
  name: string,
  directory: string,
  projects?: CloudProjects,
  output?: string,
  selectedApp?: Application,
): void
