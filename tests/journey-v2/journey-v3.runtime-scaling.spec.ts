import { expect, test } from "@playwright/test"
import * as THREE from "three"
import {
  resolveJourneyV2Quality,
  type JourneyV2Quality,
} from "../../lib/journey-v2/design"
import { JourneyCollisionWorld } from "../../lib/journey-v2/runtime/collision-world"
import { JourneyNavigation } from "../../lib/journey-v2/runtime/navigation"
import {
  checkpointArrivalDistance,
  distancePointToSegment2D,
} from "../../lib/journey-v2/runtime/proximity"
import {
  JourneyCellManager,
  JourneyWorldAssetRegistry,
} from "../../lib/journey-v2/runtime/scene-assets"
import {
  JOURNEY_CELL_LIMITS,
  nextAdaptiveEnvironmentDensity,
} from "../../lib/journey-v2/runtime/streaming-policy"
import { JourneySurfaceWorld } from "../../lib/journey-v2/runtime/surface-world"
import type {
  JourneyWorldManifest,
  JourneyWorldPerformance,
} from "../../lib/journey-v2/runtime/types"
import { selectInitialJourneyCellIds } from "../../lib/journey-v2/runtime/world-loader"

function scalingManifest(columns = 7, rows = 7) {
  const cellSize = 20
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      id: `cell-${String(row).padStart(2, "0")}-${String(column).padStart(2, "0")}`,
      districtId: "district",
      bounds: [
        column * cellSize,
        row * cellSize,
        (column + 1) * cellSize,
        (row + 1) * cellSize,
      ],
      terrainTileId: "",
      geometryIds: [],
      batchIds: [],
      colliderIds: [],
      waterBodyIds: [],
      bridgeIds: [],
      environmentalBuildingIds: [],
      checksum: `checksum-${index}`,
    }
  })
  return {
    schemaVersion: 3,
    generatorVersion: "runtime-scaling-test",
    checksum: "runtime-scaling-checksum",
    seed: 7,
    units: "metres",
    scope: "vertical-slice",
    world: {
      bounds: [0, 0, columns * cellSize, rows * cellSize],
      cellSize,
      spawn: [cellSize * 0.5, 0, cellSize * 0.5],
      heightRange: [0, 1],
      waterLevel: -1,
    },
    materials: [],
    geometries: [],
    cells,
    roads: [],
    accessJunctions: [],
    portfolioRecords: [],
    checkpoints: [],
    terrain: { sampleSpacing: 1, tiles: [] },
    waterBodies: [],
    bridges: [],
    biomes: [],
    environmentalBuildings: [],
    instanceBatches: [],
    colliders: [],
    navigation: { nodes: [], edges: [], checkpointNodeIds: {} },
    validation: { valid: true, counts: {}, warnings: [] },
  } as unknown as JourneyWorldManifest
}

function cellAsset(manifest: JourneyWorldManifest, cellId: string) {
  if (manifest.schemaVersion !== 3) {
    throw new Error("Expected a V3 scaling manifest")
  }
  const cell = manifest.cells.find((candidate) => candidate.id === cellId)
  if (!cell) {
    throw new Error(`Missing V3 test cell ${cellId}`)
  }
  return {
    schemaVersion: 3 as const,
    generatorVersion: manifest.generatorVersion,
    checksum: cell.checksum,
    cell,
    geometries: [],
    terrainTiles: [],
    instanceBatches: [],
    colliders: [],
    environmentalBuildings: [],
    waterBodies: [],
    bridges: [],
  }
}

for (const quality of ["high", "balanced"] as JourneyV2Quality[]) {
  test(`${quality} selection stays below nine active cells across a large map`, () => {
    const manifest = scalingManifest()
    const registry = new JourneyWorldAssetRegistry(manifest)
    const manager = new JourneyCellManager(
      manifest,
      registry,
      quality,
      new Set(manifest.cells.map((cell) => cell.id))
    )

    for (const [x, z] of [
      [70, 70],
      [20, 20],
      [120, 120],
      [40, 100],
    ]) {
      manager.updateVisibility(x, z, true)
      const metrics = manager.getResidencyMetrics()
      expect(metrics.active).toBeLessThanOrEqual(
        JOURNEY_CELL_LIMITS[quality].active
      )
      expect(metrics.active).toBeLessThan(9)
      expect(metrics.gpuResident).toBeLessThanOrEqual(
        JOURNEY_CELL_LIMITS[quality].gpuResident
      )
      const overlapping = manifest.cells
        .filter(
          (cell) =>
            x >= cell.bounds[0] &&
            x <= cell.bounds[2] &&
            z >= cell.bounds[1] &&
            z <= cell.bounds[3]
        )
        .map((cell) => cell.id)
      expect(manager.getActiveCellIds()).toEqual(
        expect.arrayContaining(overlapping)
      )
    }

    manager.dispose()
    registry.dispose()
  })
}

test("automatic quality keeps desktop balanced and constrains mobile or resource-limited devices", () => {
  expect(
    resolveJourneyV2Quality({
      coarsePointer: false,
      viewportWidth: 1440,
      reducedMotion: false,
      deviceMemory: 8,
      hardwareConcurrency: 8,
    })
  ).toBe("balanced")

  for (const signals of [
    { coarsePointer: true },
    { viewportWidth: 390 },
    { reducedMotion: true },
    { saveData: true },
    { reducedData: true },
    { effectiveConnectionType: "3g" },
    { deviceMemory: 4 },
    { hardwareConcurrency: 4 },
  ]) {
    expect(
      resolveJourneyV2Quality({
        coarsePointer: false,
        viewportWidth: 1440,
        reducedMotion: false,
        ...signals,
      })
    ).toBe("low")
  }
  expect(JOURNEY_CELL_LIMITS.low.active).toBe(3)
})

test("low tier never activates more than three cells in a dense corridor", () => {
  const manifest = scalingManifest(3, 12)
  const registry = new JourneyWorldAssetRegistry(manifest)
  const manager = new JourneyCellManager(
    manifest,
    registry,
    "low",
    new Set(manifest.cells.map((cell) => cell.id))
  )

  for (let z = 1; z < 239; z += 7) {
    manager.updateVisibility(30, z, true)
    expect(manager.getResidencyMetrics().active).toBeLessThanOrEqual(3)
  }

  manager.dispose()
  registry.dispose()
})

test("route prefetch requests decoded cells without making them visible", () => {
  const manifest = scalingManifest()
  const requested: string[] = []
  const registry = new JourneyWorldAssetRegistry(manifest)
  const manager = new JourneyCellManager(
    manifest,
    registry,
    "balanced",
    new Set(),
    (cellId) => requested.push(cellId)
  )

  const prefetched = manager.prefetchRoute([
    [10, 0, 10],
    [130, 0, 130],
  ])
  expect(prefetched.length).toBeGreaterThan(2)
  expect(requested).toEqual(prefetched)
  expect(manager.getActiveCellIds()).toEqual([])
  expect(manager.getResidencyMetrics().active).toBe(0)

  const retryCell = prefetched[0]
  manager.markCellLoadFailed(retryCell)
  manager.prefetchRoute([
    [10, 0, 10],
    [130, 0, 130],
  ])
  expect(requested.filter((cellId) => cellId === retryCell)).toHaveLength(2)

  manager.dispose()
  registry.dispose()
})

test("decoded cell residency is bounded independently from visibility", () => {
  const manifest = scalingManifest()
  const released: string[] = []
  const registry = new JourneyWorldAssetRegistry(manifest)
  const manager = new JourneyCellManager(
    manifest,
    registry,
    "low",
    new Set(),
    () => undefined,
    (cellId) => released.push(cellId)
  )

  for (const cell of manifest.cells) {
    manager.registerCellAsset(cellAsset(manifest, cell.id))
  }

  expect(manager.getResidencyMetrics().active).toBe(0)
  expect(manager.getResidencyMetrics().streamed).toBeLessThanOrEqual(
    JOURNEY_CELL_LIMITS.low.streamed
  )
  expect(released.length).toBeGreaterThan(0)

  manager.dispose()
  registry.dispose()
})

test("bootstrap selection is deterministic and bounded to visible work before first render", () => {
  const manifest = scalingManifest(12, 12)
  for (const quality of ["high", "balanced", "low"] as const) {
    const first = selectInitialJourneyCellIds(
      manifest.cells,
      [120, 0, 120],
      manifest.world.cellSize,
      quality
    )
    const second = selectInitialJourneyCellIds(
      [...manifest.cells].reverse(),
      [120, 0, 120],
      manifest.world.cellSize,
      quality
    )
    expect(first).toEqual(second)
    expect(first.length).toBeLessThanOrEqual(
      JOURNEY_CELL_LIMITS[quality].active
    )
  }
})

test("checkpoint arrival detects a fast segment crossing", () => {
  expect(distancePointToSegment2D(5, 0, 0, 0, 10, 0)).toBe(0)
  expect(distancePointToSegment2D(5, 3, 0, 0, 10, 0)).toBe(3)
  expect(checkpointArrivalDistance(11)).toBe(2.65)
  expect(checkpointArrivalDistance(2)).toBe(1.35)
})

test("adaptive vegetation reacts to frame and draw-call budgets", () => {
  const metrics: JourneyWorldPerformance = {
    fps: 25,
    averageFrameMs: 40,
    p95FrameMs: 42,
    drawCalls: 130,
    triangles: 100_000,
    geometries: 32,
    textures: 0,
    dpr: 1.25,
    quality: "balanced",
  }
  expect(nextAdaptiveEnvironmentDensity(metrics, 1)).toBeCloseTo(0.88)
  expect(
    nextAdaptiveEnvironmentDensity(
      { ...metrics, fps: 60, p95FrameMs: 10, drawCalls: 40 },
      0.5
    )
  ).toBeCloseTo(0.54)
})

test("adaptive density never thins code-generated infrastructure", () => {
  const manifest = scalingManifest(1, 1)
  if (manifest.schemaVersion !== 3) throw new Error("Expected V3 manifest")
  const cell = manifest.cells[0]
  const transforms = Array.from(
    { length: 5 },
    (_, index) =>
      [2 + index * 2, 0, 10, 0, 1, 1, 1] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ]
  )
  manifest.materials = [
    {
      id: "material.scaling",
      kind: "toon",
      color: "#a56f4f",
      roughness: 0.96,
      vertexColors: false,
    },
  ]
  manifest.geometries = [
    {
      id: "geometry.scaling",
      kind: "primitive",
      materialId: "material.scaling",
      y: 0,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
    },
  ]
  manifest.instanceBatches = [
    {
      id: "batch.scaling.lamp",
      kind: "lamp",
      speciesId: "infrastructure",
      lod: "near",
      geometryId: "geometry.scaling",
      materialId: "material.scaling",
      cellId: cell.id,
      transforms,
      densityRanks: [0, 0.2, 0.4, 0.6, 0.8],
      colors: transforms.map(() => "#a56f4f"),
    },
    {
      id: "batch.scaling.grass",
      kind: "grass",
      speciesId: "meadow-grass",
      lod: "near",
      geometryId: "geometry.scaling",
      materialId: "material.scaling",
      cellId: cell.id,
      transforms,
      densityRanks: [0, 0.2, 0.4, 0.6, 0.8],
      colors: transforms.map(() => "#76ab88"),
    },
  ]
  cell.batchIds = manifest.instanceBatches.map((batch) => batch.id)

  const registry = new JourneyWorldAssetRegistry(manifest)
  const manager = new JourneyCellManager(manifest, registry, "low")
  manager.setAdaptiveDensityScale(0.28)
  manager.updateVisibility(10, 10, true)

  const lamp = manager.object.getObjectByName("batch.scaling.lamp")
  const grass = manager.object.getObjectByName("batch.scaling.grass")
  expect(lamp).toBeInstanceOf(THREE.InstancedMesh)
  expect(grass).toBeInstanceOf(THREE.InstancedMesh)
  if (
    !(lamp instanceof THREE.InstancedMesh) ||
    !(grass instanceof THREE.InstancedMesh)
  ) {
    throw new Error("Expected the scaling fixture to build instanced meshes")
  }
  expect(lamp.count).toBe(transforms.length)
  expect(grass.count).toBeLessThan(transforms.length)

  manager.dispose()
  registry.dispose()
})

test("surface eviction makes a V3 cell unavailable until it is reloaded", () => {
  const manifest = scalingManifest(1, 1)
  if (manifest.schemaVersion !== 3) throw new Error("Expected V3 manifest")
  const tile = {
    id: "terrain.cell",
    cellId: manifest.cells[0].id,
    bounds: [0, 0, 20, 20] as const,
    resolution: [2, 2] as const,
    sampleSpacing: 20,
    heights: [0, 0, 0, 0],
    minHeight: 0,
    maxHeight: 0,
    geometryId: "terrain.geometry",
    checksum: "terrain-checksum",
  }
  manifest.terrain.tiles = [tile]
  const surfaces = new JourneySurfaceWorld(manifest)

  expect(surfaces.hasCompiledSurfaceAt(10, 10)).toBe(true)
  surfaces.unregisterCell(manifest.cells[0].id)
  expect(surfaces.hasCompiledSurfaceAt(10, 10)).toBe(false)
  expect(surfaces.sample(10, 10).walkable).toBe(false)
  surfaces.registerCell({
    cell: manifest.cells[0],
    geometries: [],
    terrainTiles: [tile],
  })
  expect(surfaces.hasCompiledSurfaceAt(10, 10)).toBe(true)
})

test("streamed collider cells disable and restore without rebuilding the hash", () => {
  const collider = {
    id: "building.collider",
    kind: "polygon" as const,
    cellId: "cell",
    polygon: [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ] as const,
    minY: 0,
    maxY: 4,
  }
  const collision = new JourneyCollisionWorld(
    [{ ...collider, polygon: [...collider.polygon] }],
    [0, 0, 10, 10],
    10
  )
  const current = new THREE.Vector2(3, 5)
  const movement = new THREE.Vector2(2, 0)

  expect(collision.moveCircle(current, movement, 0.4).toArray()).not.toEqual([
    5, 5,
  ])
  collision.removeCell("cell")
  expect(collision.moveCircle(current, movement, 0.4).x).toBe(5)
  collision.addColliders([{ ...collider, polygon: [...collider.polygon] }])
  expect(collision.moveCircle(current, movement, 0.4).toArray()).not.toEqual([
    5, 5,
  ])
})

test("navigation remains stable across twelve checkpoint-scale nodes", () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({
    id: `node-${index}`,
    position: [index * 10, 0, 0] as const,
    cellId: `cell-${index}`,
    kind: index === 11 ? ("checkpoint" as const) : ("road" as const),
    walkableSurfaceId: `terrain-${index}`,
  }))
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${index}`,
    a: nodes[index].id,
    b: node.id,
    cost: 10,
    kind: "road" as const,
  }))
  const navigation = new JourneyNavigation(nodes, edges, {
    destination: nodes[11].id,
  })

  expect(
    navigation.routeToLandmark(new THREE.Vector3(0, 0, 0), "destination")
  ).toHaveLength(12)
})
