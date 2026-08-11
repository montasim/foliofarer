import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  CellWorldAsset,
  WorldIndexManifest,
  WorldManifest,
} from "../../lib/journey-v2/contracts/world.ts"
import {
  compileJourneyWorld,
  validateWorldManifest,
} from "../../lib/journey-v2/generator/compiler.ts"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = join(
  scriptDirectory,
  "..",
  "..",
  "public",
  "journey-v2",
  "generated"
)

async function readJson<T>(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as T
}

const generated = validateWorldManifest(
  await readJson<WorldManifest>(join(outputDirectory, "world.json"))
)
const rebuilt = compileJourneyWorld()

if (JSON.stringify(generated) !== JSON.stringify(rebuilt)) {
  throw new Error(
    "Generated world.json is stale. Run node scripts/journey-v2/generate.ts"
  )
}

const index = await readJson<WorldIndexManifest>(
  join(outputDirectory, "index.json")
)
if (index.cells.length !== generated.cells.length) {
  throw new Error("Index and full manifest cell counts differ")
}

for (const reference of index.cells) {
  const cell = await readJson<CellWorldAsset>(
    join(outputDirectory, "cells", `${reference.id}.json`)
  )
  if (cell.cell.id !== reference.id) {
    throw new Error(`${reference.id} package contains the wrong cell`)
  }
  if (
    cell.instanceBatches.some((batch) => batch.cellId !== reference.id) ||
    cell.colliders.some((collider) => collider.cellId !== reference.id) ||
    cell.buildings.some((building) => building.cellId !== reference.id)
  ) {
    throw new Error(`${reference.id} package contains cross-cell objects`)
  }
}

const residential = generated.buildings.filter(
  (building) => building.landmarkId === null
)
if (residential.length < 8) {
  throw new Error(
    "The generated town requires at least eight environmental houses"
  )
}

console.log(
  `Journey V2 valid: ${generated.landmarks.length} stops, ` +
    `${residential.length} environmental houses, ` +
    `${generated.navigation.nodes.length} nav nodes, ` +
    `${generated.features.crosswalks.length} matched crosswalks`
)
