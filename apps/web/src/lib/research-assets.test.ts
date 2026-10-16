import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { assertResearchAssets } from "../../scripts/image-inputs.mjs"
import {
  bundledResearchAssetsDirectory,
  REQUIRED_ASSETS,
  researchAssetsDirectory,
} from "./research-assets.mjs"

const directories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aerpp-research-assets-"))
  directories.push(root)
  const publicDirectory = join(root, "assets-public")
  mkdirSync(publicDirectory)
  for (const name of REQUIRED_ASSETS)
    writeFileSync(join(publicDirectory, name), `synthetic public ${name}`)
  return { root, publicDirectory, privateDirectory: join(root, "assets") }
}

describe("research asset selection", () => {
  it("pins PDF selection to the compiled MDX set across directory changes", () => {
    const { root, publicDirectory, privateDirectory } = fixture()
    vi.stubEnv("AERPP_WEB_ASSET_SOURCE", "assets-public")
    mkdirSync(privateDirectory)
    expect(bundledResearchAssetsDirectory(root)).toBe(publicDirectory)
    expect(researchAssetsDirectory(root)).toBe(privateDirectory)
    vi.stubEnv("AERPP_WEB_ASSET_SOURCE", "assets")
    rmSync(privateDirectory, { recursive: true })
    expect(bundledResearchAssetsDirectory(root)).toBe(privateDirectory)
    expect(researchAssetsDirectory(root)).toBe(publicDirectory)
  })

  it("supports a public fresh clone and requires private inputs for image delivery", () => {
    const { root, publicDirectory } = fixture()
    expect(researchAssetsDirectory(root)).toBe(publicDirectory)
    expect(() => assertResearchAssets(publicDirectory)).not.toThrow()
    expect(() => researchAssetsDirectory(root, true)).toThrow(/directory/)
  })

  it("uses the complete private set for development and production", () => {
    const { root, privateDirectory } = fixture()
    mkdirSync(privateDirectory)
    for (const name of REQUIRED_ASSETS)
      writeFileSync(join(privateDirectory, name), `synthetic private ${name}`)
    expect(researchAssetsDirectory(root)).toBe(privateDirectory)
    expect(researchAssetsDirectory(root, true)).toBe(privateDirectory)
    expect(() => assertResearchAssets(privateDirectory)).not.toThrow()
  })

  it("rejects an incomplete private set instead of mixing it with public inputs", () => {
    const { root, privateDirectory } = fixture()
    mkdirSync(privateDirectory)
    writeFileSync(join(privateDirectory, "welcome.mdx"), "synthetic private")
    expect(researchAssetsDirectory(root)).toBe(privateDirectory)
    expect(() => assertResearchAssets(researchAssetsDirectory(root))).toThrow(
      /Missing regular asset file/,
    )
  })

  it("rejects empty files, linked files and linked directories", () => {
    const { root, publicDirectory, privateDirectory } = fixture()
    const file = join(publicDirectory, "consent.pdf")
    writeFileSync(file, "")
    expect(() => assertResearchAssets(publicDirectory)).toThrow(/Empty/)
    rmSync(file)
    symlinkSync(join(publicDirectory, "welcome.mdx"), file)
    expect(() => assertResearchAssets(publicDirectory)).toThrow(/regular/)
    symlinkSync(publicDirectory, privateDirectory, "dir")
    expect(() => researchAssetsDirectory(root)).toThrow(/directory/)
    rmSync(privateDirectory)
    symlinkSync(join(root, "missing"), privateDirectory, "dir")
    expect(() => researchAssetsDirectory(root)).toThrow(/directory/)
  })
})
