import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import { expect, test } from "@playwright/test"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const publicWorldRoot = join(repositoryRoot, "public", "journey-v2")
const sourceRoots = [
  join(repositoryRoot, "lib", "journey-v2"),
  join(repositoryRoot, "components", "journey-v2"),
  join(repositoryRoot, "app", "journey"),
]

const prohibitedSceneExtensions = new Set([
  ".3ds",
  ".avif",
  ".bmp",
  ".dds",
  ".exr",
  ".fbx",
  ".gif",
  ".glb",
  ".gltf",
  ".hdr",
  ".jpeg",
  ".jpg",
  ".ktx",
  ".ktx2",
  ".obj",
  ".png",
  ".psd",
  ".tga",
  ".tif",
  ".tiff",
  ".webp",
])

const prohibitedRuntimeVisualLoaders = [
  /\bDataTexture\b/,
  /\bTextureLoader\b/,
  /\bCubeTextureLoader\b/,
  /\bGLTFLoader\b/,
  /\bKTX2Loader\b/,
  /\bDRACOLoader\b/,
  /\bOBJLoader\b/,
  /\bFBXLoader\b/,
  /\bRGBELoader\b/,
  /\buseGLTF\b/,
  /\burl\s*\(/i,
]

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesBelow(path) : [path]
  })
}

test("the Journey environment remains code-authored", () => {
  const prohibitedPublicAssets = filesBelow(publicWorldRoot)
    .filter((path) => prohibitedSceneExtensions.has(extname(path).toLowerCase()))
    .map((path) => relative(repositoryRoot, path))

  const prohibitedSourceUses = sourceRoots.flatMap((root) =>
    filesBelow(root)
      .filter((path) => /\.(?:css|ts|tsx)$/.test(path))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8")
        return prohibitedRuntimeVisualLoaders
          .filter((pattern) => pattern.test(source))
          .map(
            (pattern) =>
              `${relative(repositoryRoot, path)} contains ${pattern.source}`
          )
      })
  )

  expect(prohibitedPublicAssets).toEqual([])
  expect(prohibitedSourceUses).toEqual([])
})
