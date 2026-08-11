import assert from "node:assert/strict"
import test from "node:test"

import type {
  EnvironmentalBuildingArchetypeV3,
  GeometryDefinitionV3,
  Vec2,
} from "../../lib/journey-v2/contracts/world.ts"
import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import { checksumJson } from "../../lib/journey-v2/generator/checksum.ts"
import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import {
  BRIDGE_APPROACH_TANGENT_BLEND_THRESHOLD_V3,
  BRIDGE_SHOULDER_TERMINAL_LENGTH_V3,
  ROAD_VERGE_WIDTH_V3,
  bridgeApproachOwnedSegmentCount,
  realignRoadsForBridgeApproaches,
  roadEdgeSegment,
} from "../../lib/journey-v2/generator/bridges.ts"
import {
  BRIDGE_DRY_LANDING_FACTOR_V3,
  compileWaterShapes,
  deriveBridgeCrossings,
} from "../../lib/journey-v2/generator/hydrology.ts"
import { sampleRoad } from "../../lib/journey-v2/generator/roads.ts"
import { validateWorldManifestV3 } from "../../lib/journey-v2/generator/validation-v3.ts"
import {
  ROCK_CLEARANCE_V3,
  VEGETATION_TRAVEL_CLEARANCE_V3,
} from "../../lib/journey-v2/generator/vegetation.ts"

const RECORD_IDS = [
  "town-square",
  "rangpur-zilla-school",
  "carmichael-college",
  "baust",
  "codez-info-tech",
  "drra",
  "multiversal-software",
  "mymedicalhub",
  "learning-library",
  "project-workshop",
  "community-hall",
  "contact-pavilion",
]

const EXPECTED_ARRIVAL_ARCHETYPES = {
  "structure.arrival-00": "town-pavilion",
  "structure.arrival-01": "schoolhouse",
  "structure.arrival-02": "academic-hall",
  "structure.arrival-03": "engineering-campus",
  "structure.arrival-04": "tech-office",
  "structure.arrival-05": "service-centre",
  "structure.arrival-06": "software-studio",
  "structure.arrival-07": "health-clinic",
  "structure.arrival-08": "reading-room",
  "structure.arrival-09": "maker-workshop",
  "structure.arrival-10": "community-hall",
  "structure.arrival-11": "garden-pavilion",
} as const satisfies Record<string, EnvironmentalBuildingArchetypeV3>

const MAX_BUILDING_GEOMETRIES_PER_ARRIVAL = 3
const MAX_BUILDING_GEOMETRIES_PER_CELL = 4
const MAX_BUILDING_GEOMETRIES_TOTAL = 36
const MAX_BUILDING_TRIANGLES_PER_ARRIVAL = 600
const MAX_BUILDING_TRIANGLES_TOTAL = 6_000

const WORLD = compileJourneyWorldV3()

function geometryHasVertex(
  geometry: GeometryDefinitionV3,
  vertex: readonly [number, number, number]
) {
  for (let index = 0; index < geometry.positions.length; index += 3) {
    if (
      Math.abs(geometry.positions[index] - vertex[0]) <= 0.001 &&
      Math.abs(geometry.positions[index + 1] - vertex[1]) <= 0.001 &&
      Math.abs(geometry.positions[index + 2] - vertex[2]) <= 0.001
    ) {
      return true
    }
  }
  return false
}

function geometryHasXZVertex(
  geometry: GeometryDefinitionV3,
  vertex: readonly [number, number]
) {
  for (let index = 0; index < geometry.positions.length; index += 3) {
    if (
      Math.abs(geometry.positions[index] - vertex[0]) <= 0.0015 &&
      Math.abs(geometry.positions[index + 2] - vertex[1]) <= 0.0015
    ) {
      return true
    }
  }
  return false
}

function offsetAwayFromEdge(
  edge: Vec2,
  oppositeEdge: Vec2,
  amount: number
): Vec2 {
  const dx = edge[0] - oppositeEdge[0]
  const dz = edge[1] - oppositeEdge[1]
  const length = Math.hypot(dx, dz) || 1
  return [edge[0] + (dx / length) * amount, edge[1] + (dz / length) * amount]
}

function pointInRing(point: Vec2, ring: readonly Vec2[]) {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    if (
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1] || Number.EPSILON) +
          currentPoint[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function planarDistance(
  a: readonly [number, number],
  b: readonly [number, number]
) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  const amount =
    lengthSquared <= 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
              lengthSquared
          )
        )
  return Math.hypot(
    point[0] - start[0] - dx * amount,
    point[1] - start[1] - dz * amount
  )
}

function distanceToRoadCenterline(
  point: Vec2,
  centerline: readonly (readonly [number, number, number])[]
) {
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < centerline.length - 1; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(
        point,
        [centerline[index][0], centerline[index][2]],
        [centerline[index + 1][0], centerline[index + 1][2]]
      )
    )
  }
  return nearest
}

function routeOrder(recordId: string) {
  return (
    WORLD.portfolioRecords.find((record) => record.recordId === recordId)
      ?.routeOrder ?? 0
  )
}

test("Journey V3 complete-world compilation is deterministic", () => {
  const first = compileJourneyWorldV3()
  const second = compileJourneyWorldV3()
  assert.deepEqual(first, second)
  assert.equal(first.checksum, second.checksum)
  assert.notEqual(first.checksum, "")
})

test("all twelve arrival structures retain distinct semantic archetypes within the render budget", () => {
  const expectedBuildingIds = Object.keys(EXPECTED_ARRIVAL_ARCHETYPES).sort()
  const expectedArchetypes = Object.values(EXPECTED_ARRIVAL_ARCHETYPES)
  assert.equal(new Set(expectedArchetypes).size, 12)

  assert.deepEqual(
    JOURNEY_V3_WORLD.environmentalBuildings
      .map((building) => building.id)
      .sort(),
    expectedBuildingIds
  )
  assert.deepEqual(
    WORLD.environmentalBuildings.map((building) => building.id).sort(),
    expectedBuildingIds
  )

  const authoredBuildings = new Map(
    JOURNEY_V3_WORLD.environmentalBuildings.map((building) => [
      building.id,
      building,
    ])
  )
  const compiledBuildings = new Map(
    WORLD.environmentalBuildings.map((building) => [building.id, building])
  )
  const geometries = new Map(
    WORLD.geometries.map((geometry) => [geometry.id, geometry])
  )
  const materials = new Set(WORLD.materials.map((material) => material.id))
  const claimedGeometryIds = new Set<string>()
  const forbiddenPortfolioFields = [
    "recordId",
    "title",
    "shortTitle",
    "description",
    "landmarkId",
    "checkpointId",
    "project",
    "skill",
  ]

  let totalTriangles = 0
  for (const [buildingId, expectedArchetype] of Object.entries(
    EXPECTED_ARRIVAL_ARCHETYPES
  )) {
    const authored = authoredBuildings.get(buildingId)
    const compiled = compiledBuildings.get(buildingId)
    assert.ok(authored, `${buildingId} is authored`)
    assert.ok(compiled, `${buildingId} is compiled`)
    assert.equal(authored.archetype, expectedArchetype)
    assert.equal(compiled.archetype, expectedArchetype)
    assert.ok(compiled.archetype, `${buildingId} serializes its archetype`)

    const serialized = compiled as unknown as Record<string, unknown>
    for (const forbidden of forbiddenPortfolioFields) {
      assert.equal(
        forbidden in serialized,
        false,
        `${buildingId} keeps ${forbidden} in the DOM portfolio layer`
      )
    }
    assert.equal(
      [compiled.id, ...compiled.geometryIds, ...compiled.materialIds].some(
        (id) => id.toLowerCase().includes("bench")
      ),
      false,
      `${buildingId} does not restore a forecourt bench`
    )

    assert.ok(
      compiled.geometryIds.length > 0 &&
        compiled.geometryIds.length <= MAX_BUILDING_GEOMETRIES_PER_ARRIVAL,
      `${buildingId} uses at most ${MAX_BUILDING_GEOMETRIES_PER_ARRIVAL} static draw groups`
    )
    assert.equal(
      new Set(compiled.geometryIds).size,
      compiled.geometryIds.length,
      `${buildingId} does not duplicate geometry references`
    )
    assert.ok(
      compiled.materialIds.length > 0 &&
        compiled.materialIds.length <= MAX_BUILDING_GEOMETRIES_PER_ARRIVAL,
      `${buildingId} keeps its material groups bounded`
    )
    assert.equal(
      new Set(compiled.materialIds).size,
      compiled.materialIds.length,
      `${buildingId} does not duplicate material references`
    )

    const cell = WORLD.cells.find(
      (candidate) => candidate.id === compiled.cellId
    )
    assert.ok(cell, `${buildingId} has a streaming cell`)
    let buildingTriangles = 0
    const usedMaterialIds = new Set<string>()
    for (const geometryId of compiled.geometryIds) {
      assert.equal(
        claimedGeometryIds.has(geometryId),
        false,
        `${geometryId} belongs to only one world-space building`
      )
      claimedGeometryIds.add(geometryId)
      const geometry = geometries.get(geometryId)
      assert.ok(geometry, `${buildingId} references existing ${geometryId}`)
      assert.equal(geometry.kind, "building")
      assert.ok(geometry.positions.length > 0)
      assert.equal(geometry.positions.length % 3, 0)
      assert.ok(geometry.indices.length > 0)
      assert.equal(geometry.indices.length % 3, 0)
      assert.ok(
        materials.has(geometry.materialId),
        `${geometryId} references an existing material`
      )
      assert.ok(
        compiled.materialIds.includes(geometry.materialId),
        `${geometryId} material is declared by ${buildingId}`
      )
      assert.equal(
        cell.geometryIds.filter((id) => id === geometryId).length,
        1,
        `${geometryId} is streamed exactly once`
      )
      usedMaterialIds.add(geometry.materialId)
      buildingTriangles += geometry.indices.length / 3
    }
    assert.deepEqual(
      [...usedMaterialIds].sort(),
      [...compiled.materialIds].sort(),
      `${buildingId} does not retain unused material groups`
    )
    assert.ok(
      buildingTriangles <= MAX_BUILDING_TRIANGLES_PER_ARRIVAL,
      `${buildingId} stays below ${MAX_BUILDING_TRIANGLES_PER_ARRIVAL} triangles`
    )
    totalTriangles += buildingTriangles
  }

  assert.equal(
    new Set(WORLD.environmentalBuildings.map((building) => building.archetype))
      .size,
    12,
    "all twelve structures expose a distinct semantic archetype"
  )
  assert.ok(
    claimedGeometryIds.size <= MAX_BUILDING_GEOMETRIES_TOTAL,
    `arrival structures stay below ${MAX_BUILDING_GEOMETRIES_TOTAL} static draw groups`
  )
  assert.ok(
    totalTriangles <= MAX_BUILDING_TRIANGLES_TOTAL,
    `arrival structures stay below ${MAX_BUILDING_TRIANGLES_TOTAL} triangles`
  )

  for (const cell of WORLD.cells) {
    const buildingDrawGroups = cell.environmentalBuildingIds.reduce(
      (total, buildingId) =>
        total + (compiledBuildings.get(buildingId)?.geometryIds.length ?? 0),
      0
    )
    assert.ok(
      buildingDrawGroups <= MAX_BUILDING_GEOMETRIES_PER_CELL,
      `${cell.id} contributes at most ${MAX_BUILDING_GEOMETRIES_PER_CELL} building draw groups`
    )
  }

  const authoredArrivalIds = new Set(
    JOURNEY_V3_WORLD.checkpoints.map(
      (checkpoint) => checkpoint.arrivalBuildingId
    )
  )
  assert.deepEqual(authoredArrivalIds, new Set(expectedBuildingIds))

  const secondCompilation = compileJourneyWorldV3()
  assert.deepEqual(
    secondCompilation.environmentalBuildings.map(({ id, archetype }) => ({
      id,
      archetype,
    })),
    WORLD.environmentalBuildings.map(({ id, archetype }) => ({
      id,
      archetype,
    })),
    "archetype serialization remains deterministic"
  )
})

test("all twelve canonical records get one physical checkpoint without professional evidence in the world", () => {
  assert.equal(WORLD.scope, "complete")
  assert.deepEqual(
    WORLD.portfolioRecords.map((record) => record.recordId),
    RECORD_IDS
  )
  for (const record of WORLD.portfolioRecords) {
    assert.deepEqual(Object.keys(record).sort(), [
      "districtId",
      "recordId",
      "routeOrder",
    ])
  }

  assert.equal(WORLD.checkpoints.length, RECORD_IDS.length)
  assert.deepEqual(
    new Set(WORLD.checkpoints.map((checkpoint) => checkpoint.recordId)),
    new Set(RECORD_IDS)
  )
  for (const checkpoint of WORLD.checkpoints) {
    assert.equal("buildingId" in checkpoint, false)
    assert.equal("title" in checkpoint, false)
    assert.equal("description" in checkpoint, false)
    assert.equal(checkpoint.approachGeometryIds.length, 2)
    assert.ok(
      checkpoint.approachGeometryIds.every(
        (id) => !id.includes(checkpoint.recordId)
      )
    )
  }
  for (const building of WORLD.environmentalBuildings) {
    assert.equal("recordId" in building, false)
    assert.equal("title" in building, false)
    assert.equal("landmarkId" in building, false)
  }

  const cellDistricts = new Set(WORLD.cells.map((cell) => cell.districtId))
  for (const districtId of new Set(
    WORLD.portfolioRecords.map((record) => record.districtId)
  )) {
    assert.ok(cellDistricts.has(districtId), `${districtId} owns a cell`)
  }
})

test("every retained forecourt has one wayfinding-only arrival building and no bench", () => {
  const geometryIds = WORLD.geometries.map((geometry) => geometry.id)
  assert.equal(new Set(geometryIds).size, geometryIds.length)
  assert.equal(WORLD.environmentalBuildings.length, RECORD_IDS.length)
  assert.equal(
    WORLD.geometries.filter((geometry) =>
      /^geometry\.structure\.arrival-\d{2}\.access$/.test(geometry.id)
    ).length,
    0,
    "arrival sites must not compile a second road-to-door access mesh"
  )
  assert.equal(
    WORLD.geometries.some((geometry) => geometry.id.includes("arrival-bench")),
    false
  )
  assert.equal(
    WORLD.instanceBatches.some((batch) => batch.id.includes("bench")),
    false
  )
  assert.equal(
    WORLD.colliders.some((collider) => collider.id.includes("bench")),
    false
  )

  const claimedBuildingIds = new Set<string>()
  const claimedJunctionSurfaceIds = new Set<string>()

  for (const [index, checkpoint] of WORLD.checkpoints.entries()) {
    const suffix = String(index).padStart(2, "0")
    assert.deepEqual(checkpoint.approachGeometryIds, [
      `geometry.checkpoint-approach.${suffix}`,
      `geometry.checkpoint-clearing.${suffix}`,
    ])
    assert.equal("buildingId" in checkpoint, false)
    assert.equal(
      checkpoint.arrivalBuildingId,
      JOURNEY_V3_WORLD.checkpoints[index].arrivalBuildingId
    )

    const owningCells = WORLD.cells.filter((cell) =>
      cell.geometryIds.includes(checkpoint.approachGeometryIds[1])
    )
    assert.equal(owningCells.length, 1, `${checkpoint.id} forecourt cell`)
    const [cell] = owningCells
    for (const surfaceId of checkpoint.approachGeometryIds) {
      assert.equal(
        cell.geometryIds.filter((geometryId) => geometryId === surfaceId)
          .length,
        1,
        `${checkpoint.id} owns ${surfaceId} exactly once`
      )
      const definitions = WORLD.geometries.filter(
        (geometry) => geometry.id === surfaceId
      )
      assert.equal(definitions.length, 1)
      assert.equal(definitions[0].kind, "surface")
      assert.equal(definitions[0].materialId, "surface.access-sand")
    }

    const clearing = WORLD.geometries.find(
      (geometry) => geometry.id === checkpoint.approachGeometryIds[1]
    )
    assert.ok(clearing)
    for (let vertex = 0; vertex < clearing.positions.length; vertex += 3) {
      assert.ok(
        Math.abs(
          planarDistance(
            [clearing.positions[vertex], clearing.positions[vertex + 2]],
            [checkpoint.position[0], checkpoint.position[2]]
          ) - checkpoint.interactionRadius
        ) <= 0.002,
        `${checkpoint.id} retains its circular forecourt`
      )
    }

    const arrivalBuildings = WORLD.environmentalBuildings.filter(
      (building) =>
        building.cellId === cell.id &&
        building.districtId === checkpoint.districtId &&
        Math.abs(
          planarDistance(
            [building.entrance[0], building.entrance[2]],
            [checkpoint.position[0], checkpoint.position[2]]
          ) - 3.9
        ) <= 0.001
    )
    assert.equal(
      arrivalBuildings.length,
      1,
      `${checkpoint.id} has one 3.9m arrival building`
    )
    const [arrivalBuilding] = arrivalBuildings
    assert.match(arrivalBuilding.id, /^structure\.arrival-\d{2}$/)
    assert.equal(arrivalBuilding.id, checkpoint.arrivalBuildingId)
    assert.equal(claimedBuildingIds.has(arrivalBuilding.id), false)
    claimedBuildingIds.add(arrivalBuilding.id)
    for (const metadataKey of [
      "recordId",
      "title",
      "description",
      "landmarkId",
      "checkpointId",
    ]) {
      assert.equal(metadataKey in arrivalBuilding, false)
    }

    const arrivalJunctions = WORLD.accessJunctions.filter(
      (junction) => junction.buildingId === arrivalBuilding.id
    )
    assert.equal(arrivalJunctions.length, 1)
    const [arrivalJunction] = arrivalJunctions
    assert.equal(arrivalJunction.roadId, checkpoint.roadId)
    assert.deepEqual(
      arrivalJunction.surfaceGeometryIds,
      checkpoint.approachGeometryIds,
      `${checkpoint.id} junction reuses the retained circle and access strip`
    )
    for (const surfaceId of arrivalJunction.surfaceGeometryIds) {
      assert.equal(claimedJunctionSurfaceIds.has(surfaceId), false)
      claimedJunctionSurfaceIds.add(surfaceId)
    }
  }

  assert.equal(claimedBuildingIds.size, RECORD_IDS.length)
  assert.equal(claimedJunctionSurfaceIds.size, RECORD_IDS.length * 2)
})

test("the physical journey is compact, ordered, bounded, and fully reachable", () => {
  const orderedCheckpoints = [...WORLD.checkpoints].sort(
    (a, b) => routeOrder(a.recordId) - routeOrder(b.recordId)
  )
  let bridgeAdjustedGapCount = 0
  for (let index = 1; index < orderedCheckpoints.length; index += 1) {
    const previousCheckpoint = orderedCheckpoints[index - 1]
    const currentCheckpoint = orderedCheckpoints[index]
    const previous = previousCheckpoint.position
    const current = currentCheckpoint.position
    const previousPoint: Vec2 = [previous[0], previous[2]]
    const currentPoint: Vec2 = [current[0], current[2]]
    const separation = Math.hypot(
      current[0] - previous[0],
      current[2] - previous[2]
    )
    const interveningBridge = WORLD.bridges.find(
      (bridge) =>
        bridge.roadId === previousCheckpoint.roadId &&
        bridge.roadId === currentCheckpoint.roadId &&
        pointSegmentDistance(
          [bridge.center[0], bridge.center[2]],
          previousPoint,
          currentPoint
        ) <=
          bridge.width / 2 +
            Math.max(
              previousCheckpoint.interactionRadius,
              currentCheckpoint.interactionRadius
            )
    )
    const maximumSeparation = 36 + (interveningBridge?.length ?? 0) / 2
    assert.ok(separation >= 14 && separation <= maximumSeparation)
    if (separation > 36) {
      assert.ok(interveningBridge)
      bridgeAdjustedGapCount += 1
    }
  }
  assert.ok(bridgeAdjustedGapCount >= 1)
  for (const cell of WORLD.cells) {
    assert.ok(cell.bounds[2] - cell.bounds[0] <= WORLD.world.cellSize)
    assert.ok(cell.bounds[3] - cell.bounds[1] <= WORLD.world.cellSize)
  }

  const adjacency = new Map<string, Set<string>>(
    WORLD.navigation.nodes.map((node) => [node.id, new Set()])
  )
  for (const edge of WORLD.navigation.edges) {
    adjacency.get(edge.a)?.add(edge.b)
    adjacency.get(edge.b)?.add(edge.a)
  }
  const start = WORLD.navigation.nodes.find((node) => node.kind === "road")
  assert.ok(start)
  const visited = new Set([start.id])
  const queue = [start.id]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  for (const checkpoint of WORLD.checkpoints) {
    assert.ok(visited.has(checkpoint.navNodeId), checkpoint.id)
  }
})

test("the finite journey road ends in an intentional streamed turnaround", () => {
  const road = WORLD.roads.find((candidate) => candidate.id === "journey-spine")
  assert.ok(road)
  assert.equal(road.endTurnaroundRadius, 4.8)
  const geometryId = `geometry.road-turnaround.${road.id}`
  const geometry = WORLD.geometries.find(
    (candidate) => candidate.id === geometryId
  )
  assert.ok(geometry)
  assert.ok(road.surfaceGeometryIds.includes(geometryId))

  const ring: Vec2[] = []
  for (let index = 0; index < geometry.positions.length; index += 3) {
    ring.push([geometry.positions[index], geometry.positions[index + 2]])
  }
  const endpoint = road.centerline[road.centerline.length - 1]
  assert.equal(pointInRing([endpoint[0], endpoint[2]], ring), true)
  assert.ok(
    ring.every(
      ([x, z]) =>
        x >= WORLD.world.bounds[0] + 2 &&
        x <= WORLD.world.bounds[2] - 2 &&
        z >= WORLD.world.bounds[1] + 2 &&
        z <= WORLD.world.bounds[3] - 2
    )
  )

  const owningCells = WORLD.cells.filter((cell) =>
    cell.geometryIds.includes(geometryId)
  )
  assert.equal(owningCells.length, 1)
  assert.ok(
    WORLD.navigation.nodes.some(
      (node) =>
        node.kind === "road" &&
        Math.hypot(
          node.position[0] - endpoint[0],
          node.position[2] - endpoint[2]
        ) <= 0.1 &&
        pointInRing([node.position[0], node.position[2]], ring)
    )
  )

  for (const marking of WORLD.geometries.filter((candidate) =>
    candidate.id.startsWith(`geometry.road-markings.${road.id}.`)
  )) {
    for (let index = 0; index < marking.positions.length; index += 3) {
      assert.ok(
        Math.hypot(
          marking.positions[index] - endpoint[0],
          marking.positions[index + 2] - endpoint[2]
        ) >
          road.endTurnaroundRadius - 0.05
      )
    }
  }

  for (const batch of WORLD.instanceBatches) {
    for (const transform of batch.transforms) {
      assert.ok(
        Math.hypot(transform[0] - endpoint[0], transform[2] - endpoint[2]) >=
          road.endTurnaroundRadius + 0.75
      )
    }
  }
})

test("terrain tiles share deterministic border samples", () => {
  const samples = new Map<string, number>()
  let duplicateSamples = 0
  for (const tile of WORLD.terrain.tiles) {
    for (let row = 0; row < tile.resolution[1]; row += 1) {
      for (let column = 0; column < tile.resolution[0]; column += 1) {
        const x = tile.bounds[0] + column * tile.sampleSpacing
        const z = tile.bounds[1] + row * tile.sampleSpacing
        const key = `${x}:${z}`
        const height = tile.heights[row * tile.resolution[0] + column]
        if (samples.has(key)) {
          duplicateSamples += 1
          assert.equal(height, samples.get(key), `terrain seam ${key}`)
        }
        samples.set(key, height)
      }
    }
  }
  assert.ok(duplicateSamples > 0)
})

test("terrain seam drift is rejected after checksum verification", () => {
  const world = structuredClone(WORLD)
  const tile = world.terrain.tiles[1]
  tile.heights[0] += 0.2
  const payload: Partial<typeof tile> = { ...tile }
  delete payload.checksum
  tile.checksum = checksumJson(payload)
  assert.throws(() => validateWorldManifestV3(world), /Terrain seam/)
})

test("both rivers are crossed by one derived bridge and roads respect grade limits", () => {
  assert.ok(
    BRIDGE_SHOULDER_TERMINAL_LENGTH_V3 >= 0.5 &&
      BRIDGE_SHOULDER_TERMINAL_LENGTH_V3 <= 0.9,
    "bridge shoulders end as a compact square terminal near the rail"
  )
  assert.ok(
    BRIDGE_DRY_LANDING_FACTOR_V3 >= 0.6 && BRIDGE_DRY_LANDING_FACTOR_V3 <= 0.8,
    "the straight bridge keeps a compact dry landing for the curved bank loft"
  )
  assert.equal(
    WORLD.materials.find((material) => material.id === "surface.road-summer")
      ?.kind,
    "unlit",
    "the road stays visually uniform across generated surface quads"
  )
  assert.equal(WORLD.bridges.length, 2)
  assert.deepEqual(
    new Set(WORLD.bridges.map((bridge) => bridge.waterBodyId)),
    new Set(["water.northern-river", "water.coastal-creek"])
  )
  for (const bridge of WORLD.bridges) {
    assert.equal(bridge.walkable, true)
    assert.ok((bridge.deckCenterline?.length ?? 0) >= 5)
    assert.ok((bridge.crownRise ?? 0) >= 0.2)
    assert.ok((bridge.deckThickness ?? 0) >= 0.2)
    const profile = bridge.deckCenterline ?? []
    const endpointMaximum = Math.max(
      profile[0]?.[1] ?? bridge.deckHeight,
      profile[profile.length - 1]?.[1] ?? bridge.deckHeight
    )
    assert.ok(bridge.deckHeight >= endpointMaximum + 0.15)
    for (let index = 0; index < profile.length - 1; index += 1) {
      const horizontal = Math.hypot(
        profile[index + 1][0] - profile[index][0],
        profile[index + 1][2] - profile[index][2]
      )
      const grade =
        horizontal === 0
          ? 0
          : Math.abs(profile[index + 1][1] - profile[index][1]) / horizontal
      assert.ok(grade <= 0.0801, `${bridge.id} profile grade ${grade}`)
    }
    const bridgeGeometries = bridge.geometryIds.map(
      (id) => WORLD.geometries.find((geometry) => geometry.id === id)!
    )
    const deck = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".deck")
    )
    const structure = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".structure")
    )
    const rails = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".rails")
    )
    const approachVerges = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".approach-verges")
    )
    assert.ok(deck)
    assert.ok(structure)
    assert.ok(rails)
    assert.ok(approachVerges)
    assert.equal(deck.walkable, true)
    assert.equal(deck.materialId, "surface.road-summer")
    assert.equal(structure.walkable, false)
    assert.equal(structure.materialId, "surface.bridge-support")
    assert.equal(rails.walkable, false)
    assert.equal(approachVerges.walkable, false)
    assert.equal(approachVerges.materialId, "surface.road-verge")
    assert.equal(approachVerges.colors?.length, approachVerges.positions.length)
    assert.ok(rails.positions.length > profile.length * 150)
    const authoredRoad = JOURNEY_V3_WORLD.roads.find(
      (candidate) => candidate.id === bridge.roadId
    )
    assert.ok(authoredRoad)
    const authoredSampledRoads = JOURNEY_V3_WORLD.roads.map((road) =>
      sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
    )
    const renderedSampledRoads = realignRoadsForBridgeApproaches(
      authoredSampledRoads,
      deriveBridgeCrossings(
        authoredSampledRoads,
        compileWaterShapes(
          JOURNEY_V3_WORLD.waterBodies,
          JOURNEY_V3_WORLD.bounds
        )
      )
    )
    const sampledRoad = renderedSampledRoads.find(
      (candidate) => candidate.source.id === authoredRoad.id
    )
    assert.ok(sampledRoad)
    const sampledSegments = sampledRoad.points
      .slice(0, -1)
      .map((_, index) => roadEdgeSegment(sampledRoad, index))
    const insideDeck = sampledSegments.map((segment) =>
      pointInRing(segment.center, bridge.deckPolygon)
    )
    const firstInside = insideDeck.findIndex(Boolean)
    const lastInside = insideDeck.lastIndexOf(true)
    assert.ok(firstInside > 0)
    assert.ok(lastInside >= firstInside)
    assert.ok(lastInside < sampledSegments.length - 1)
    const startApproachSegments = bridgeApproachOwnedSegmentCount(
      bridge.tangent,
      sampledSegments[firstInside - 1].tangent
    )
    const endApproachSegments = bridgeApproachOwnedSegmentCount(
      bridge.tangent,
      sampledSegments[lastInside + 1].tangent
    )
    const before = sampledSegments[firstInside - startApproachSegments]
    const after = sampledSegments[lastInside + endApproachSegments]
    for (const edge of [
      before.left[0],
      before.right[0],
      after.left[1],
      after.right[1],
    ]) {
      assert.ok(
        geometryHasXZVertex(deck, edge),
        `${bridge.id} apron must own one full bank segment and meet the road edge ${edge.join(",")}`
      )
    }
    for (const [edge, opposite] of [
      [before.left[0], before.right[0]],
      [before.right[0], before.left[0]],
      [after.left[1], after.right[1]],
      [after.right[1], after.left[1]],
    ] as const) {
      const outerShoulder = offsetAwayFromEdge(
        edge,
        opposite,
        ROAD_VERGE_WIDTH_V3
      )
      assert.ok(
        geometryHasXZVertex(approachVerges, outerShoulder),
        `${bridge.id} shoulder must retain its full width at the road seam`
      )
    }
    const approachFrames = [
      {
        center: profile[0],
        left: before.left[0],
        right: before.right[0],
        outward: [-bridge.tangent[0], -bridge.tangent[1]] as Vec2,
        roadTangent: before.tangent,
        ownedSegments: startApproachSegments,
      },
      {
        center: profile[profile.length - 1],
        left: after.left[1],
        right: after.right[1],
        outward: bridge.tangent,
        roadTangent: after.tangent,
        ownedSegments: endApproachSegments,
      },
    ]
    for (const approach of approachFrames) {
      const outerCenter: Vec2 = [
        (approach.left[0] + approach.right[0]) / 2,
        (approach.left[1] + approach.right[1]) / 2,
      ]
      const delta: Vec2 = [
        outerCenter[0] - approach.center[0],
        outerCenter[1] - approach.center[2],
      ]
      const forward =
        delta[0] * approach.outward[0] + delta[1] * approach.outward[1]
      const lateral = Math.abs(
        delta[0] * -approach.outward[1] + delta[1] * approach.outward[0]
      )
      const tangentDot = Math.max(
        -1,
        Math.min(
          1,
          bridge.tangent[0] * approach.roadTangent[0] +
            bridge.tangent[1] * approach.roadTangent[1]
        )
      )
      const tangentDelta = (Math.acos(tangentDot) * 180) / Math.PI
      const chordDelta =
        (Math.acos(Math.max(-1, Math.min(1, forward / Math.hypot(...delta)))) *
          180) /
        Math.PI
      const outerSpan = planarDistance(approach.left, approach.right)
      assert.ok(
        forward > 0.5 && forward >= lateral * 0.65,
        `${bridge.id} approach must have positive forward run before turning`
      )
      assert.ok(
        tangentDelta <= 48,
        `${bridge.id} approach tangent delta ${tangentDelta.toFixed(2)}°`
      )
      if (approach.ownedSegments === 1) {
        assert.ok(
          tangentDelta <= BRIDGE_APPROACH_TANGENT_BLEND_THRESHOLD_V3,
          `${bridge.id} compact approach tangent delta ${tangentDelta.toFixed(2)}°`
        )
        assert.ok(
          chordDelta <= 12,
          `${bridge.id} compact approach chord delta ${chordDelta.toFixed(2)}°`
        )
      } else {
        let straightRun = 0
        for (let vertex = 0; vertex < deck.positions.length; vertex += 3) {
          const fromDeck: Vec2 = [
            deck.positions[vertex] - approach.center[0],
            deck.positions[vertex + 2] - approach.center[2],
          ]
          const vertexForward =
            fromDeck[0] * approach.outward[0] +
            fromDeck[1] * approach.outward[1]
          const vertexLateral = Math.abs(
            fromDeck[0] * -approach.outward[1] +
              fromDeck[1] * approach.outward[0]
          )
          if (vertexForward >= 0 && vertexLateral <= 0.002) {
            straightRun = Math.max(straightRun, vertexForward)
          }
        }
        assert.ok(
          straightRun >= authoredRoad.width * 0.9,
          `${bridge.id} extended approach needs a straight tangent before its curve`
        )
      }
      assert.ok(
        outerSpan >= authoredRoad.width * 0.95 &&
          outerSpan <= authoredRoad.width * 1.35,
        `${bridge.id} approach width must remain bounded and symmetric`
      )
      assert.ok(
        Math.hypot(delta[0], delta[1]) <=
          Math.max(
            authoredRoad.width * 1.5,
            approach.ownedSegments *
              JOURNEY_V3_WORLD.roadSampleSpacing *
              1.35
          ),
        `${bridge.id} approach loft must remain compact`
      )
    }
    const bridgeNormal: Vec2 = [-bridge.tangent[1], bridge.tangent[0]]
    const bridgeEnds = [profile[0], profile[profile.length - 1]]
    for (const center of bridgeEnds) {
      const left: Vec2 = [
        center[0] + bridgeNormal[0] * (bridge.width / 2),
        center[2] + bridgeNormal[1] * (bridge.width / 2),
      ]
      const right: Vec2 = [
        center[0] - bridgeNormal[0] * (bridge.width / 2),
        center[2] - bridgeNormal[1] * (bridge.width / 2),
      ]
      for (const [edge, opposite] of [
        [left, right],
        [right, left],
      ] as const) {
        const outerShoulder = offsetAwayFromEdge(
          edge,
          opposite,
          ROAD_VERGE_WIDTH_V3
        )
        assert.ok(
          geometryHasXZVertex(approachVerges, outerShoulder),
          `${bridge.id} full-width abutment shoulder must cover the deck seam`
        )
      }
    }
    for (let index = 0; index < deck.indices.length; index += 3) {
      const [a, b, c] = deck.indices
        .slice(index, index + 3)
        .map((vertexIndex) => vertexIndex * 3)
      const normalY =
        (deck.positions[b + 2] - deck.positions[a + 2]) *
          (deck.positions[c] - deck.positions[a]) -
        (deck.positions[b] - deck.positions[a]) *
          (deck.positions[c + 2] - deck.positions[a + 2])
      assert.ok(
        normalY > 1e-8,
        `${bridge.id} deck must not contain a folded apron triangle`
      )
    }
    for (let index = 0; index < approachVerges.indices.length; index += 3) {
      const vertices = approachVerges.indices
        .slice(index, index + 3)
        .map((vertexIndex) => vertexIndex * 3)
      const [a, b, c] = vertices
      const normalY =
        (approachVerges.positions[b + 2] - approachVerges.positions[a + 2]) *
          (approachVerges.positions[c] - approachVerges.positions[a]) -
        (approachVerges.positions[b] - approachVerges.positions[a]) *
          (approachVerges.positions[c + 2] - approachVerges.positions[a + 2])
      assert.ok(
        normalY > 1e-6,
        `${bridge.id} shoulder terminal must not fold or collapse`
      )
      const squaredEdgeLengths = [
        [a, b],
        [b, c],
        [c, a],
      ].map(
        ([from, to]) =>
          (approachVerges.positions[to] - approachVerges.positions[from]) ** 2 +
          (approachVerges.positions[to + 2] -
            approachVerges.positions[from + 2]) **
            2
      )
      const triangleQuality = Math.max(...squaredEdgeLengths) / normalY
      assert.ok(
        triangleQuality < 180,
        `${bridge.id} shoulder terminal must not form a spear triangle`
      )
    }
    assert.ok(bridge.navNodeIds.every(Boolean))
    assert.equal(bridge.railColliderIds.length, 2)
    assert.equal(new Set(bridge.railColliderIds).size, 2)
    for (const railColliderId of bridge.railColliderIds) {
      const collider = WORLD.colliders.find(
        (candidate) => candidate.id === railColliderId
      )
      assert.ok(collider, `${bridge.id} rail collider must be compiled`)
      assert.ok(
        WORLD.cells
          .find((cell) => cell.id === collider.cellId)
          ?.colliderIds.includes(collider.id)
      )
      assert.ok(collider.maxY >= bridge.deckHeight + 0.4)
    }
    assert.ok(
      WORLD.navigation.edges.some(
        (edge) => edge.waterOverrideBridgeId === bridge.id
      )
    )
    assert.equal(
      WORLD.waterBodies.find((water) => water.id === bridge.waterBodyId)
        ?.walkable,
      false
    )
  }
  for (const road of WORLD.roads) {
    const geometries = road.surfaceGeometryIds.map(
      (id) => WORLD.geometries.find((geometry) => geometry.id === id)!
    )
    for (const geometry of geometries) {
      for (let index = 0; index < geometry.indices.length; index += 3) {
        const [a, b, c] = geometry.indices
          .slice(index, index + 3)
          .map((vertex) => vertex * 3)
        const normalY =
          (geometry.positions[b + 2] - geometry.positions[a + 2]) *
            (geometry.positions[c] - geometry.positions[a]) -
          (geometry.positions[b] - geometry.positions[a]) *
            (geometry.positions[c + 2] - geometry.positions[a + 2])
        assert.ok(normalY > 0, `${geometry.id} must face upward`)
      }
    }
    for (let index = 0; index < road.centerline.length - 1; index += 1) {
      const a = road.centerline[index]
      const b = road.centerline[index + 1]
      const horizontal = Math.hypot(b[0] - a[0], b[2] - a[2])
      const grade = horizontal === 0 ? 0 : Math.abs(b[1] - a[1]) / horizontal
      assert.ok(grade <= 0.0801)
    }
  }
})

test("bridge validation rejects missing rails and a blocked navigation centerline", () => {
  const missingRail = structuredClone(WORLD)
  const bridge = missingRail.bridges[0]
  missingRail.colliders = missingRail.colliders.filter(
    (collider) => collider.id !== bridge.railColliderIds[0]
  )
  assert.throws(() => validateWorldManifestV3(missingRail), /missing collider/)

  const blockedCenterline = structuredClone(WORLD)
  const blockedBridge = blockedCenterline.bridges[0]
  const collider = blockedCenterline.colliders.find(
    (candidate) => candidate.id === blockedBridge.railColliderIds[0]
  )
  assert.ok(collider)
  collider.polygon = [
    [blockedBridge.center[0] - 0.5, blockedBridge.center[2] - 0.5],
    [blockedBridge.center[0] + 0.5, blockedBridge.center[2] - 0.5],
    [blockedBridge.center[0] + 0.5, blockedBridge.center[2] + 0.5],
    [blockedBridge.center[0] - 0.5, blockedBridge.center[2] + 0.5],
  ]
  assert.throws(
    () => validateWorldManifestV3(blockedCenterline),
    /blocks its nav centerline/
  )
})

test("the ocean has a genuine dry island hole populated by code-generated vegetation", () => {
  assert.equal(WORLD.waterBodies.length, 5)
  assert.equal(WORLD.validation.counts.islands, 1)
  const ocean = WORLD.waterBodies.find(
    (water) => water.id === "water.western-ocean"
  )
  assert.ok(ocean)
  assert.ok(Array.isArray(ocean.polygon[0]?.[0]))
  const rings = ocean.polygon as Vec2[][]
  assert.equal(rings.length, 2)
  const island = rings[1]
  const islandCenter: Vec2 = [
    island.reduce((sum, point) => sum + point[0], 0) / island.length,
    island.reduce((sum, point) => sum + point[1], 0) / island.length,
  ]
  assert.equal(pointInRing(islandCenter, rings[0]), true)
  assert.equal(pointInRing(islandCenter, island), true)

  const islandVegetation = WORLD.instanceBatches.flatMap((batch) =>
    batch.transforms.filter((transform) =>
      pointInRing([transform[0], transform[2]], island)
    )
  )
  assert.ok(islandVegetation.length > 0)
})

test("building and checkpoint access reuse exact road-edge topology", () => {
  const geometry = new Map(
    WORLD.geometries.map((definition) => [definition.id, definition])
  )
  for (const junction of WORLD.accessJunctions) {
    const road = WORLD.roads.find(
      (candidate) => candidate.id === junction.roadId
    )
    assert.ok(road)
    for (const vertex of junction.sharedBoundary) {
      assert.ok(
        junction.surfaceGeometryIds.some((id) =>
          geometryHasVertex(geometry.get(id)!, vertex)
        )
      )
      assert.ok(
        road.surfaceGeometryIds.some((id) =>
          geometryHasVertex(geometry.get(id)!, vertex)
        )
      )
    }
  }

  for (const checkpoint of WORLD.checkpoints) {
    const approach = geometry.get(checkpoint.approachGeometryIds[0])
    const road = WORLD.roads.find(
      (candidate) => candidate.id === checkpoint.roadId
    )
    assert.ok(approach)
    assert.ok(road)
    for (const vertex of checkpoint.sharedRoadBoundary) {
      assert.ok(geometryHasVertex(approach, vertex))
      assert.ok(
        road.surfaceGeometryIds.some((id) =>
          geometryHasVertex(geometry.get(id)!, vertex)
        )
      )
    }
  }
})

test("vegetation carries deterministic species, LOD, rank, and color metadata", () => {
  // The inhabited compound masks deliberately exchange a small amount of
  // random vegetation for houses, fences, gardens and water-edge ecology.
  assert.ok(WORLD.validation.counts.uniqueTrees >= 340)
  assert.ok(WORLD.validation.counts.uniqueGrassTufts >= 3_000)
  assert.ok(WORLD.instanceBatches.length > 0)
  assert.ok(
    WORLD.instanceBatches.some(
      (batch) => batch.speciesId === "broadleaf" && batch.lod === "near"
    )
  )
  assert.ok(
    WORLD.instanceBatches.some(
      (batch) => batch.kind === "grass" && batch.lod === "mid"
    )
  )
  for (const batch of WORLD.instanceBatches) {
    assert.equal(batch.transforms.length, batch.densityRanks.length)
    assert.equal(batch.transforms.length, batch.colors.length)
    assert.ok(
      batch.densityRanks.every(
        (rank, index, ranks) =>
          rank >= 0 && rank <= 1 && (index === 0 || rank >= ranks[index - 1])
      )
    )
  }
})

test("rocks are sparse, varied, and reuse low-cost near and mid primitives", () => {
  const rockBatches = WORLD.instanceBatches.filter(
    (batch) => batch.kind === "rock"
  )
  const nearBatches = rockBatches.filter((batch) => batch.lod === "near")
  const midBatches = rockBatches.filter((batch) => batch.lod === "mid")
  const nearTransforms = nearBatches.flatMap((batch) => batch.transforms)
  const midTransforms = midBatches.flatMap((batch) => batch.transforms)

  assert.ok(nearTransforms.length >= 12 && nearTransforms.length <= 42)
  assert.equal(midTransforms.length, nearTransforms.length)
  assert.deepEqual(
    new Set(rockBatches.map((batch) => batch.lod)),
    new Set(["near", "mid"])
  )
  assert.ok(
    rockBatches.every(
      (batch) =>
        batch.speciesId === "rock" &&
        batch.materialId === "environment.rock" &&
        batch.geometryId === `primitive.rock.${batch.lod}`
    )
  )

  const positions = (transforms: typeof nearTransforms) =>
    transforms
      .map((transform) => `${transform[0]}:${transform[2]}`)
      .sort((a, b) => a.localeCompare(b))
  assert.deepEqual(positions(midTransforms), positions(nearTransforms))
  const orderedTransforms = (transforms: typeof nearTransforms) =>
    transforms
      .map((transform) => [...transform])
      .sort((a, b) => a[2] - b[2] || a[0] - b[0])
  assert.deepEqual(
    orderedTransforms(midTransforms),
    orderedTransforms(nearTransforms),
    "rock size must not pop when its geometry LOD changes"
  )
  assert.ok(
    new Set(nearTransforms.map((transform) => transform[3])).size > 8,
    "rock rotations should be visibly varied"
  )
  assert.ok(
    new Set(
      nearTransforms.map(
        (transform) => `${transform[4]}:${transform[5]}:${transform[6]}`
      )
    ).size > 8,
    "rock proportions should be visibly varied"
  )
  const majorScales = nearTransforms.map((transform) =>
    Math.max(transform[4], transform[6])
  )
  const smallRocks = majorScales.filter(
    (scale) => scale >= 0.55 && scale <= 0.95
  )
  const mediumRocks = majorScales.filter(
    (scale) => scale >= 1.35 && scale <= 1.85
  )
  const largeRocks = majorScales.filter(
    (scale) => scale >= 2.45 && scale <= 3.15
  )
  assert.ok(smallRocks.length >= 5, "small stones remain present")
  assert.ok(mediumRocks.length >= 4, "medium rocks remain present")
  assert.ok(largeRocks.length >= 3, "large boulders remain present")
  assert.equal(
    smallRocks.length + mediumRocks.length + largeRocks.length,
    majorScales.length,
    "rock scales stay inside three visibly separated bands"
  )
  assert.ok(
    Math.max(...nearTransforms.map((transform) => transform[5] * 0.88)) >= 1.6,
    "large boulders have a human-scale visible height"
  )

  const rockColliders = WORLD.colliders.filter((collider) =>
    collider.id.startsWith("collider.rock.")
  )
  assert.equal(
    rockColliders.length,
    mediumRocks.length + largeRocks.length,
    "every medium or large boulder has one collision footprint"
  )
  assert.ok(
    rockColliders.every(
      (collider) =>
        collider.polygon.length === 8 &&
        collider.maxY > collider.minY &&
        WORLD.cells
          .find((cell) => cell.id === collider.cellId)
          ?.colliderIds.includes(collider.id)
    )
  )
  const visibleVegetation = WORLD.instanceBatches
    .filter(
      (batch) =>
        batch.lod === "near" &&
        (batch.kind === "tree-trunk" ||
          batch.kind === "tree-canopy" ||
          batch.kind === "grass" ||
          batch.kind === "shrub")
    )
    .flatMap((batch) =>
      batch.transforms.map((transform) => ({
        kind: batch.kind,
        point: [transform[0], transform[2]] as Vec2,
      }))
    )
  for (const rock of nearTransforms) {
    const exclusionRadius = Math.max(rock[4], rock[6]) * 0.92
    for (const vegetation of visibleVegetation) {
      const margin = vegetation.kind === "grass" ? 0.22 : 0.8
      assert.ok(
        Math.hypot(
          vegetation.point[0] - rock[0],
          vegetation.point[1] - rock[2]
        ) >=
          exclusionRadius + margin - 0.001,
        `${vegetation.kind} clips through a rock footprint`
      )
    }
  }

  const rockGeometries = WORLD.geometries.filter((geometry) =>
    geometry.id.startsWith("primitive.rock.")
  )
  assert.deepEqual(rockGeometries.map((geometry) => geometry.id).sort(), [
    "primitive.rock.mid",
    "primitive.rock.near",
  ])
  for (const geometry of rockGeometries) {
    assert.equal(geometry.kind, "primitive")
    assert.equal(geometry.materialId, "environment.rock")
    assert.ok(
      geometry.indices.length / 3 <= (geometry.id.endsWith(".near") ? 28 : 20)
    )
    assert.equal(
      geometry.positions.length / 3,
      geometry.indices.length,
      `${geometry.id} keeps one hard-normal-ready vertex per face corner`
    )
    assert.deepEqual(
      geometry.indices,
      geometry.indices.map((_, index) => index),
      `${geometry.id} remains crisply faceted after runtime normal generation`
    )
  }
})

test("rock validation enforces the larger road-side safety margin", () => {
  const world = structuredClone(WORLD)
  const batch = world.instanceBatches.find(
    (candidate) => candidate.kind === "rock" && candidate.lod === "near"
  )
  assert.ok(batch)
  const road = world.roads[0]
  const start = road.centerline[0]
  const end = road.centerline[1]
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const length = Math.hypot(dx, dz)
  const normal: Vec2 = [-dz / length, dx / length]
  const offset = road.width / 2 + ROCK_CLEARANCE_V3.road - 0.2
  const point: Vec2 = [
    (start[0] + end[0]) / 2 - normal[0] * offset,
    (start[2] + end[2]) / 2 - normal[1] * offset,
  ]
  const transform = batch.transforms[0]
  batch.transforms[0] = [
    point[0],
    transform[1],
    point[1],
    transform[3],
    transform[4],
    transform[5],
    transform[6],
  ]

  assert.throws(
    () => validateWorldManifestV3(world),
    /rock violates road clearance/
  )
})

test("real-world validator rejects vegetation placed on the road", () => {
  const world = structuredClone(WORLD)
  const batch = world.instanceBatches.find(
    (candidate) => candidate.speciesId !== "infrastructure"
  )
  assert.ok(batch)
  const roadPoint = world.roads[0].centerline[0]
  const transform = batch.transforms[0]
  batch.transforms[0] = [
    roadPoint[0],
    transform[1],
    roadPoint[2],
    transform[3],
    transform[4],
    transform[5],
    transform[6],
  ]
  assert.throws(
    () => validateWorldManifestV3(world),
    /places vegetation on a road/
  )
})

test("compiled grass preserves a full shoulder clearance along road segments", () => {
  assert.ok(
    VEGETATION_TRAVEL_CLEARANCE_V3.grass >= ROAD_VERGE_WIDTH_V3 + 0.4,
    "grass origins include the full verge plus the maximum tuft radius"
  )
  const grass = WORLD.instanceBatches
    .filter((batch) => batch.kind === "grass" && batch.lod === "near")
    .flatMap((batch) => batch.transforms)
  assert.ok(grass.length > 0)
  for (const transform of grass) {
    const point: Vec2 = [transform[0], transform[2]]
    for (const road of WORLD.roads) {
      assert.ok(
        distanceToRoadCenterline(point, road.centerline) >=
          road.width / 2 + VEGETATION_TRAVEL_CLEARANCE_V3.grass - 0.001,
        `grass at ${point.join(",")} enters ${road.id}'s shoulder`
      )
    }
  }
})

test("travel-surface validation rejects terrain piercing a bridge deck", () => {
  const world = structuredClone(WORLD)
  const deckId = world.bridges[0].geometryIds.find((geometryId) =>
    geometryId.endsWith(".deck")
  )
  const deck = world.geometries.find((geometry) => geometry.id === deckId)
  assert.ok(deck)
  for (let index = 1; index < deck.positions.length; index += 3) {
    deck.positions[index] -= 2
  }
  assert.throws(
    () => validateWorldManifestV3(world),
    /intersected by rendered terrain/
  )
})

test("the complete world remains code-only with no external environmental assets", () => {
  const serialized = JSON.stringify(WORLD)
  assert.doesNotMatch(
    serialized,
    /\.(?:glb|gltf|obj|fbx|png|jpe?g|webp|ktx2|hdr)\b/i
  )
  assert.doesNotMatch(
    serialized,
    /(?:texture|image|model|mesh|asset)(?:Url|Path|Uri)/i
  )
})
