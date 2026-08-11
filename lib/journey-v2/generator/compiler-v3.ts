import { JOURNEY_V3_WORLD } from "../authored/world-v3.ts"
import type {
  AuthoredWorldV3,
  BiomeZoneManifestV3,
  CellManifestV3,
  PortfolioCheckpointManifestV3,
  WorldManifestV3,
} from "../contracts/world.ts"
import { sampleRoad } from "./roads.ts"
import { compileWaterShapes, deriveBridgeCrossings } from "./hydrology.ts"
import {
  compileTerrainTiles,
  createCellSkeletonsV3,
  createRenderedTerrainField,
  createTerrainField,
  createTravelSurfaceField,
} from "./terrain.ts"
import {
  compileBridges,
  compileRoadGeometry,
  compileWaterGeometry,
  realignRoadsForBridgeApproaches,
} from "./bridges.ts"
import {
  compileEnvironmentalBuildings,
  planEnvironmentalBuildings,
} from "./building-kit.ts"
import {
  compileNavigationV3,
  compilePortfolioCheckpoints,
} from "./navigation-v3.ts"
import { compileVegetation, vegetationGeometriesV3 } from "./vegetation.ts"
import { compileInhabitedSceneryV3 } from "./inhabited-scenery.ts"
import { V3_MATERIALS } from "./geometry-v3.ts"
import {
  compileFarLandscapeV3,
  FAR_LANDSCAPE_MATERIAL_V3,
} from "./far-landscape.ts"
import { checksumJson } from "./checksum.ts"
import { round } from "./geometry.ts"
import { validateWorldManifestV3 } from "./validation-v3.ts"

export const JOURNEY_V3_GENERATOR_VERSION = "3.10.0"

function compileBiomes(world: AuthoredWorldV3): BiomeZoneManifestV3[] {
  return world.biomes.map((biome) => ({
    id: biome.id,
    kind: biome.kind,
    polygon: biome.polygon.map(([x, z]) => [round(x), round(z)]),
    treeDensity: biome.treeDensity,
    grassDensity: biome.grassDensity,
  }))
}

function assignCellDistricts(
  world: AuthoredWorldV3,
  cells: CellManifestV3[],
  checkpoints: readonly PortfolioCheckpointManifestV3[]
) {
  const distanceToCheckpoint = (
    cell: CellManifestV3,
    checkpoint: PortfolioCheckpointManifestV3
  ) => {
    const x = (cell.bounds[0] + cell.bounds[2]) / 2
    const z = (cell.bounds[1] + cell.bounds[3]) / 2
    return Math.hypot(x - checkpoint.position[0], z - checkpoint.position[2])
  }
  for (const cell of cells) {
    const nearest = [...checkpoints].sort(
      (a, b) =>
        distanceToCheckpoint(cell, a) - distanceToCheckpoint(cell, b) ||
        a.recordId.localeCompare(b.recordId)
    )[0]
    if (nearest) cell.districtId = nearest.districtId
  }

  // Reserve the closest distinct cell for every authored district. This keeps
  // sparse coastal cells deterministic without allowing a short district to
  // disappear merely because the streaming grid is coarser than the route.
  const reserved = new Set<string>()
  for (const district of [...world.districts].sort(
    (a, b) => a.order - b.order
  )) {
    const districtCheckpoints = checkpoints.filter(
      (checkpoint) => checkpoint.districtId === district.id
    )
    const candidate = [...cells]
      .filter((cell) => !reserved.has(cell.id))
      .sort((a, b) => {
        const aDistance = Math.min(
          ...districtCheckpoints.map((checkpoint) =>
            distanceToCheckpoint(a, checkpoint)
          )
        )
        const bDistance = Math.min(
          ...districtCheckpoints.map((checkpoint) =>
            distanceToCheckpoint(b, checkpoint)
          )
        )
        return aDistance - bDistance || a.id.localeCompare(b.id)
      })[0]
    if (candidate && districtCheckpoints.length > 0) {
      candidate.districtId = district.id
      reserved.add(candidate.id)
    }
  }
}

export function compileJourneyWorldV3(
  world: AuthoredWorldV3 = JOURNEY_V3_WORLD
): WorldManifestV3 {
  const sampledRoads = world.roads.map((road) =>
    sampleRoad(road, world.roadSampleSpacing)
  )
  const waterShapes = compileWaterShapes(world.waterBodies, world.bounds)
  const bridgeDrafts = deriveBridgeCrossings(sampledRoads, waterShapes)
  const renderedRoads = realignRoadsForBridgeApproaches(
    sampledRoads,
    bridgeDrafts
  )
  const field = createTerrainField(world, sampledRoads, waterShapes)
  const cells = createCellSkeletonsV3(world)

  const terrain = compileTerrainTiles(world, cells, field, waterShapes)
  // Everything placed on the ground must sample the actual triangulated
  // terrain mesh, not the smoother analytic field used to generate its grid.
  const renderedField = createRenderedTerrainField(field, terrain.tiles)
  const surfaceField = createTravelSurfaceField(field, renderedField)
  const water = compileWaterGeometry(waterShapes, cells)
  const bridgeResult = compileBridges(
    bridgeDrafts,
    waterShapes,
    renderedRoads,
    world,
    cells,
    surfaceField
  )
  const roads = compileRoadGeometry({
    world,
    roads: renderedRoads,
    waters: waterShapes,
    bridges: bridgeResult.bridges,
    cells,
    field: surfaceField,
  })
  const farLandscape = compileFarLandscapeV3({
    world,
    field,
    roads: roads.manifests,
    waters: waterShapes,
  })
  const plannedBuildings = planEnvironmentalBuildings(
    world,
    sampledRoads,
    waterShapes,
    surfaceField
  )
  const checkpointResult = compilePortfolioCheckpoints({
    world,
    roads: renderedRoads,
    bridges: bridgeResult.bridges,
    buildings: plannedBuildings,
    cells,
    field: surfaceField,
  })
  const buildingResult = compileEnvironmentalBuildings({
    world,
    buildings: plannedBuildings,
    cells,
    roads: roads.manifests,
    field: surfaceField,
    cellOverrides: checkpointResult.arrivalBuildingCellIds,
    arrivalSurfaceOverrides: checkpointResult.arrivalBuildingSurfaceIds,
  })
  assignCellDistricts(world, cells, checkpointResult.checkpoints)
  const navigation = compileNavigationV3({
    world,
    roads: renderedRoads,
    waters: waterShapes,
    bridges: bridgeResult.bridges,
    buildings: plannedBuildings,
    checkpoints: checkpointResult.checkpoints,
    field: surfaceField,
  })
  const inhabitedScenery = compileInhabitedSceneryV3({
    world,
    cells,
    roads: renderedRoads,
    waters: water.manifests,
    bridges: bridgeResult.bridges,
    buildings: plannedBuildings,
    checkpoints: checkpointResult.checkpoints,
    field: renderedField,
  })
  const vegetation = compileVegetation({
    world,
    cells,
    roads: renderedRoads,
    waters: water.manifests,
    bridges: bridgeResult.bridges,
    buildings: plannedBuildings,
    checkpoints: checkpointResult.checkpoints,
    field: renderedField,
    exclusionPolygons: inhabitedScenery.vegetationExclusionPolygons,
  })
  const primitiveGeometries = vegetationGeometriesV3()
  const geometries = [
    farLandscape,
    ...terrain.geometries,
    ...water.geometries,
    ...bridgeResult.geometries,
    ...roads.geometries,
    ...buildingResult.geometries,
    ...checkpointResult.geometries,
    ...inhabitedScenery.geometries,
    ...primitiveGeometries,
  ]

  for (const cell of cells) {
    cell.geometryIds.sort()
    cell.batchIds.sort()
    cell.colliderIds.sort()
    cell.waterBodyIds.sort()
    cell.bridgeIds.sort()
    cell.environmentalBuildingIds.sort()
    cell.checksum = checksumJson({ ...cell, checksum: "" })
  }
  const allHeights = terrain.tiles.flatMap((tile) => tile.heights)
  const spawnHeight = renderedField.heightAt(world.spawn)
  const islandCount = water.manifests.reduce(
    (sum, waterBody) =>
      sum +
      (Array.isArray(waterBody.polygon[0]?.[0])
        ? Math.max(0, waterBody.polygon.length - 1)
        : 0),
    0
  )
  const manifest: WorldManifestV3 = {
    schemaVersion: 3,
    generatorVersion: JOURNEY_V3_GENERATOR_VERSION,
    checksum: "",
    seed: world.seed,
    units: "metres",
    scope: world.scope,
    world: {
      bounds: world.bounds,
      cellSize: world.cellSize,
      spawn: [world.spawn[0], round(spawnHeight + 0.08), world.spawn[1]],
      heightRange: [
        round(Math.min(...allHeights)),
        round(Math.max(...allHeights)),
      ],
      waterLevel: world.waterLevel,
    },
    materials: [
      ...V3_MATERIALS,
      FAR_LANDSCAPE_MATERIAL_V3,
      ...water.materials,
      ...inhabitedScenery.materials,
    ],
    geometries,
    cells,
    roads: roads.manifests,
    accessJunctions: buildingResult.accessJunctions,
    portfolioRecords: world.portfolioRecords.map((record) => ({ ...record })),
    checkpoints: checkpointResult.checkpoints,
    terrain: {
      sampleSpacing: world.terrainSampleSpacing,
      tiles: terrain.tiles,
    },
    waterBodies: water.manifests,
    bridges: bridgeResult.bridges,
    biomes: compileBiomes(world),
    environmentalBuildings: buildingResult.manifests,
    instanceBatches: [
      ...vegetation.batches,
      ...inhabitedScenery.instanceBatches,
    ],
    colliders: [
      ...buildingResult.colliders,
      ...bridgeResult.colliders,
      ...vegetation.colliders,
      ...inhabitedScenery.colliders,
    ],
    navigation,
    validation: {
      valid: true,
      counts: {
        portfolioRecords: world.portfolioRecords.length,
        activeCheckpoints: checkpointResult.checkpoints.length,
        cells: cells.length,
        terrainTiles: terrain.tiles.length,
        waterBodies: water.manifests.length,
        islands: islandCount,
        bridges: bridgeResult.bridges.length,
        bridgeRailColliders: bridgeResult.colliders.length,
        roads: roads.manifests.length,
        environmentalBuildings: buildingResult.manifests.length,
        accessJunctions: buildingResult.accessJunctions.length,
        vegetationBatches: vegetation.batches.length,
        vegetationInstances: vegetation.batches.reduce(
          (sum, batch) => sum + batch.transforms.length,
          0
        ),
        inhabitedSceneryMeshes: inhabitedScenery.validation.counts.cellMeshes,
        inhabitedSceneryBatches: inhabitedScenery.instanceBatches.length,
        inhabitedSceneryInstances: inhabitedScenery.instanceBatches.reduce(
          (sum, batch) => sum + batch.transforms.length,
          0
        ),
        ambientStructures: inhabitedScenery.validation.counts.ambientStructures,
        contextualPlantClusters:
          inhabitedScenery.validation.counts.plantInstances,
        utilityPoles: inhabitedScenery.validation.counts.utilityPoles,
        wireSpans: inhabitedScenery.validation.counts.wireSpans,
        uniqueTrees: vegetation.counts.trees,
        uniqueGrassTufts: vegetation.counts.grass,
        uniqueRocks: vegetation.counts.rocks,
        navigationNodes: navigation.nodes.length,
        navigationEdges: navigation.edges.length,
      },
      warnings: [...inhabitedScenery.validation.warnings],
    },
  }

  validateWorldManifestV3(manifest)
  manifest.checksum = checksumJson({ ...manifest, checksum: "" })
  return manifest
}
