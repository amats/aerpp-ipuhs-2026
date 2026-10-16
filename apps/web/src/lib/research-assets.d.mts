export const REQUIRED_ASSETS: readonly string[]
export function researchAssetsDirectory(
  webDirectory: string,
  privateOnly?: boolean,
): string
export function bundledResearchAssetsDirectory(webDirectory: string): string

export function readResearchDocumentSet(
  webDirectory: string,
  directory?: string,
): ReturnType<typeof import("@aerpp/config/document-set").createDocumentSet>
