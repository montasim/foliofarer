import { mkdir, readdir, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  CellWorldAssetV3,
  NavigationAssetV3,
  SharedWorldAssetV3,
  WorldIndexManifestV3,
} from "../../lib/journey-v2/contracts/world.ts"
import {
  compileJourneyWorldV3,
  JOURNEY_V3_GENERATOR_VERSION,
} from "../../lib/journey-v2/generator/compiler-v3.ts"
import { checksumJson } from "../../lib/journey-v2/generator/checksum.ts"
import { isSharedJourneyGeometryV3 } from "../../lib/journey-v2/generator/far-landscape.ts"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory =
  process.env.JOURNEY_V3_OUTPUT_DIRECTORY ??
  join(scriptDirectory, "..", "..", "public", "journey-v2", "generated-next")
const cellDirectory = join(outputDirectory, "cells")
const publicRoot =
  process.env.JOURNEY_V3_PUBLIC_ROOT ?? "/journey-v2/generated-next"

function serialize(value: unknown) {
  return `${JSON.stringify(value)}\n`
}

function withChecksum<T extends { checksum: string }>(value: T): T {
  return { ...value, checksum: checksumJson({ ...value, checksum: "" }) }
}

async function removeStaleCells(validNames: ReadonlySet<string>) {
  const existing = await readdir(cellDirectory).catch(() => [])
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".json") && !validNames.has(name))
      .map((name) => unlink(join(cellDirectory, name)))
  )
}

async function generate() {
  const manifest = compileJourneyWorldV3()
  await mkdir(cellDirectory, { recursive: true })
  const sharedGeometryIds = new Set(
    manifest.geometries
      .filter(isSharedJourneyGeometryV3)
      .map((geometry) => geometry.id)
  )
  const shared = withChecksum<SharedWorldAssetV3>({
    schemaVersion: 3,
    generatorVersion: JOURNEY_V3_GENERATOR_VERSION,
    checksum: "",
    materials: manifest.materials,
    geometries: manifest.geometries.filter((geometry) =>
      sharedGeometryIds.has(geometry.id)
    ),
  })
  const navigation = withChecksum<NavigationAssetV3>({
    schemaVersion: 3,
    generatorVersion: JOURNEY_V3_GENERATOR_VERSION,
    checksum: "",
    navigation: manifest.navigation,
  })
  const cellAssets = manifest.cells.map((cell) =>
    withChecksum<CellWorldAssetV3>({
      schemaVersion: 3,
      generatorVersion: JOURNEY_V3_GENERATOR_VERSION,
      checksum: "",
      cell,
      geometries: manifest.geometries.filter(
        (geometry) =>
          cell.geometryIds.includes(geometry.id) &&
          !sharedGeometryIds.has(geometry.id)
      ),
      terrainTiles: manifest.terrain.tiles.filter(
        (tile) => tile.cellId === cell.id
      ),
      instanceBatches: manifest.instanceBatches.filter(
        (batch) => batch.cellId === cell.id
      ),
      colliders: manifest.colliders.filter(
        (collider) => collider.cellId === cell.id
      ),
      environmentalBuildings: manifest.environmentalBuildings.filter(
        (building) => building.cellId === cell.id
      ),
      waterBodies: manifest.waterBodies
        .filter((water) => cell.waterBodyIds.includes(water.id))
        .map((water) => ({
          ...water,
          geometryIds: water.geometryIds.filter((id) =>
            cell.geometryIds.includes(id)
          ),
        })),
      bridges: manifest.bridges
        .filter((bridge) => cell.bridgeIds.includes(bridge.id))
        .map((bridge) => ({
          ...bridge,
          geometryIds: bridge.geometryIds.filter((id) =>
            cell.geometryIds.includes(id)
          ),
        })),
    })
  )
  const index = withChecksum<WorldIndexManifestV3>({
    schemaVersion: 3,
    generatorVersion: JOURNEY_V3_GENERATOR_VERSION,
    checksum: "",
    seed: manifest.seed,
    units: "metres",
    scope: manifest.scope,
    world: manifest.world,
    fullManifestAsset: `${publicRoot}/world.json`,
    sharedAsset: `${publicRoot}/shared.json`,
    sharedAssetChecksum: shared.checksum,
    navigationAsset: `${publicRoot}/navigation.json`,
    navigationAssetChecksum: navigation.checksum,
    cells: manifest.cells.map((cell, index) => ({
      id: cell.id,
      districtId: cell.districtId,
      bounds: cell.bounds,
      checksum: cellAssets[index].checksum,
      assetPath: `${publicRoot}/cells/${cell.id}.json`,
    })),
    roads: manifest.roads,
    portfolioRecords: manifest.portfolioRecords,
    checkpoints: manifest.checkpoints,
    waterBodies: manifest.waterBodies,
    bridges: manifest.bridges,
  })

  const validCellNames = new Set(
    manifest.cells.map((cell) => `${cell.id}.json`)
  )
  await removeStaleCells(validCellNames)
  await Promise.all([
    writeFile(join(outputDirectory, "world.json"), serialize(manifest)),
    writeFile(join(outputDirectory, "index.json"), serialize(index)),
    writeFile(join(outputDirectory, "shared.json"), serialize(shared)),
    writeFile(join(outputDirectory, "navigation.json"), serialize(navigation)),
    ...cellAssets.map((asset) =>
      writeFile(join(cellDirectory, `${asset.cell.id}.json`), serialize(asset))
    ),
  ])
  console.log(
    `Journey V3 complete world generated: ${manifest.cells.length} cells, ` +
      `${manifest.environmentalBuildings.length} environmental buildings, ` +
      `${manifest.bridges.length} bridges, checksum ${manifest.checksum}`
  )
}

await generate()
