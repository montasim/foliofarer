import { mkdir, readdir, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  CellWorldAsset,
  NavigationAsset,
  SharedWorldAsset,
  WorldIndexManifest,
} from "../../lib/journey-v2/contracts/world.ts"
import { compileJourneyWorld } from "../../lib/journey-v2/generator/compiler.ts"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = join(
  scriptDirectory,
  "..",
  "..",
  "public",
  "journey-v2",
  "generated"
)
const cellDirectory = join(outputDirectory, "cells")

function serialize(value: unknown) {
  return `${JSON.stringify(value)}\n`
}

async function clearStaleCells(validNames: ReadonlySet<string>) {
  const existing = await readdir(cellDirectory).catch(() => [])
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".json") && !validNames.has(name))
      .map((name) => unlink(join(cellDirectory, name)))
  )
}

async function generate() {
  const manifest = compileJourneyWorld()
  await mkdir(cellDirectory, { recursive: true })

  const primitiveGeometries = manifest.geometries.filter(
    (geometry) => geometry.kind === "primitive"
  )
  const shared: SharedWorldAsset = {
    schemaVersion: 2,
    materials: manifest.materials,
    geometries: primitiveGeometries,
  }
  const navigation: NavigationAsset = {
    schemaVersion: 2,
    navigation: manifest.navigation,
  }
  const index: WorldIndexManifest = {
    schemaVersion: 2,
    generatorVersion: manifest.generatorVersion,
    seed: manifest.seed,
    units: manifest.units,
    world: manifest.world,
    fullManifestAsset: "/journey-v2/generated/world.json",
    sharedAsset: "/journey-v2/generated/shared.json",
    navigationAsset: "/journey-v2/generated/navigation.json",
    districts: manifest.districts,
    cells: manifest.cells.map((cell) => ({
      id: cell.id,
      districtId: cell.districtId,
      bounds: cell.bounds,
      assetPath: `/journey-v2/generated/cells/${cell.id}.json`,
    })),
    roads: manifest.roads,
    landmarks: manifest.landmarks,
    crosswalks: manifest.features.crosswalks,
    journeyLinePoints: manifest.features.journeyLine.points,
  }

  const validCellNames = new Set(
    manifest.cells.map((cell) => `${cell.id}.json`)
  )
  await clearStaleCells(validCellNames)

  await Promise.all([
    writeFile(join(outputDirectory, "world.json"), serialize(manifest)),
    writeFile(join(outputDirectory, "index.json"), serialize(index)),
    writeFile(join(outputDirectory, "shared.json"), serialize(shared)),
    writeFile(join(outputDirectory, "navigation.json"), serialize(navigation)),
    ...manifest.cells.map((cell) => {
      const geometryIds = new Set(cell.geometryIds)
      const batches = manifest.instanceBatches.filter(
        (batch) => batch.cellId === cell.id
      )
      const asset: CellWorldAsset = {
        schemaVersion: 2,
        cell,
        geometries: manifest.geometries.filter(
          (geometry) =>
            geometryIds.has(geometry.id) && geometry.kind !== "primitive"
        ),
        instanceBatches: batches,
        colliders: manifest.colliders.filter(
          (collider) => collider.cellId === cell.id
        ),
        buildings: manifest.buildings.filter(
          (building) => building.cellId === cell.id
        ),
      }
      return writeFile(join(cellDirectory, `${cell.id}.json`), serialize(asset))
    }),
  ])

  const bytes = Buffer.byteLength(serialize(manifest))
  console.log(
    `Journey V2 generated: ${manifest.cells.length} cells, ` +
      `${manifest.buildings.length} buildings, ` +
      `${manifest.validation.counts.instances} instances, ` +
      `${(bytes / 1024).toFixed(1)} KiB debug manifest`
  )
}

await generate()
