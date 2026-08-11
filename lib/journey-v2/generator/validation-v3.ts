import polygonClipping, { type MultiPolygon } from "polygon-clipping"

import type {
  BridgeManifestV3,
  EnvironmentalBuildingArchetypeV3,
  GeometryDefinitionV3,
  PortfolioCheckpointManifestV3,
  TerrainTileManifestV3,
  Vec2,
  Vec3,
  WorldManifestV3,
} from "../contracts/world.ts"
import {
  distance,
  multiPolygonArea,
  orientedRectangle,
  pointInMultiPolygon,
} from "./geometry.ts"
import { polygonFromPoints } from "./geometry-v3.ts"
import { checksumJson } from "./checksum.ts"
import { renderedTerrainHeightAt } from "./terrain.ts"
import {
  ROCK_CLEARANCE_V3,
  VEGETATION_TRAVEL_CLEARANCE_V3,
} from "./vegetation.ts"

const { intersection } = polygonClipping
const EPSILON = 0.001
const ENVIRONMENTAL_BUILDING_ARCHETYPES_V3 =
  new Set<EnvironmentalBuildingArchetypeV3>([
    "town-pavilion",
    "schoolhouse",
    "academic-hall",
    "engineering-campus",
    "tech-office",
    "service-centre",
    "software-studio",
    "health-clinic",
    "reading-room",
    "maker-workshop",
    "community-hall",
    "garden-pavilion",
  ])

const FORBIDDEN_ENVIRONMENTAL_BUILDING_FIELDS = [
  "recordId",
  "landmarkId",
  "title",
  "shortTitle",
  "description",
  "checkpointId",
  "project",
  "skill",
] as const

function assertUnique(label: string, ids: readonly string[]) {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Journey V3 ${label} IDs are not unique`)
  }
}

function tileSample(tile: TerrainTileManifestV3, column: number, row: number) {
  return tile.heights[row * tile.resolution[0] + column]
}

function validateTerrainSeams(tiles: readonly TerrainTileManifestV3[]) {
  const samples = new Map<string, number>()
  for (const tile of tiles) {
    const { checksum, ...payload } = tile
    if (checksumJson(payload) !== checksum) {
      throw new Error(`${tile.id} checksum does not match its height payload`)
    }
    for (let row = 0; row < tile.resolution[1]; row += 1) {
      for (let column = 0; column < tile.resolution[0]; column += 1) {
        const x = tile.bounds[0] + column * tile.sampleSpacing
        const z = tile.bounds[1] + row * tile.sampleSpacing
        const key = `${x.toFixed(5)}:${z.toFixed(5)}`
        const height = tileSample(tile, column, row)
        const existing = samples.get(key)
        if (existing !== undefined && Math.abs(existing - height) > EPSILON) {
          throw new Error(
            `Terrain seam ${key} differs by ${Math.abs(existing - height)}m`
          )
        }
        samples.set(key, height)
      }
    }
  }
}

function roadGrade(a: Vec3, b: Vec3) {
  const horizontal = distance([a[0], a[2]], [b[0], b[2]])
  return horizontal < 1e-6 ? 0 : Math.abs(b[1] - a[1]) / horizontal
}

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const squared = dx * dx + dz * dz
  if (squared < 1e-8) return distance(point, start)
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / squared
    )
  )
  return distance(point, [start[0] + dx * amount, start[1] + dz * amount])
}

/**
 * A longer chronology gap is only justified when the two arrivals sit on
 * opposite ends of the same bridge and their direct route crosses its deck.
 *
 * Merely putting a bridge centre close to the segment is insufficient: that
 * also matches two stops beside one bridge end, or a segment running across
 * the road instead of along it.
 */
export function bridgeIntervenesBetweenCheckpointsV3(
  bridge: BridgeManifestV3,
  previous: PortfolioCheckpointManifestV3,
  current: PortfolioCheckpointManifestV3
) {
  if (bridge.roadId !== previous.roadId || bridge.roadId !== current.roadId) {
    return false
  }

  const tangentLength = Math.hypot(bridge.tangent[0], bridge.tangent[1])
  if (
    !Number.isFinite(tangentLength) ||
    tangentLength < EPSILON ||
    !Number.isFinite(bridge.length) ||
    bridge.length <= 0
  ) {
    return false
  }
  const tangent: Vec2 = [
    bridge.tangent[0] / tangentLength,
    bridge.tangent[1] / tangentLength,
  ]
  const normal: Vec2 = [-tangent[1], tangent[0]]
  const center: Vec2 = [bridge.center[0], bridge.center[2]]
  const relative = (checkpoint: PortfolioCheckpointManifestV3): Vec2 => [
    checkpoint.position[0] - center[0],
    checkpoint.position[2] - center[1],
  ]
  const previousRelative = relative(previous)
  const currentRelative = relative(current)
  const previousAlong =
    previousRelative[0] * tangent[0] + previousRelative[1] * tangent[1]
  const currentAlong =
    currentRelative[0] * tangent[0] + currentRelative[1] * tangent[1]
  const halfLength = bridge.length / 2
  const spansBothEnds =
    (previousAlong <= -halfLength + EPSILON &&
      currentAlong >= halfLength - EPSILON) ||
    (currentAlong <= -halfLength + EPSILON &&
      previousAlong >= halfLength - EPSILON)
  if (!spansBothEnds) return false

  const alongDelta = currentAlong - previousAlong
  if (Math.abs(alongDelta) < EPSILON) return false
  const crossingProgress = -previousAlong / alongDelta
  if (crossingProgress <= 0 || crossingProgress >= 1) return false
  const previousAcross =
    previousRelative[0] * normal[0] + previousRelative[1] * normal[1]
  const currentAcross =
    currentRelative[0] * normal[0] + currentRelative[1] * normal[1]
  const acrossAtBridgeCenter =
    previousAcross + (currentAcross - previousAcross) * crossingProgress
  const crossingClearance =
    bridge.width / 2 +
    Math.max(previous.interactionRadius, current.interactionRadius)

  return Math.abs(acrossAtBridgeCenter) <= crossingClearance + EPSILON
}

function distanceToPolygon(point: Vec2, polygon: readonly Vec2[]) {
  if (pointInMultiPolygon(point, [polygonFromPoints(polygon)])) return 0
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(
        point,
        polygon[index],
        polygon[(index + 1) % polygon.length]
      )
    )
  }
  return nearest
}

function distanceToMultiPolygon(point: Vec2, multiPolygon: MultiPolygon) {
  if (pointInMultiPolygon(point, multiPolygon)) return 0
  let nearest = Number.POSITIVE_INFINITY
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      const points = ring.map(([x, z]) => [x, z] as Vec2)
      nearest = Math.min(nearest, distanceToPolygon(point, points))
    }
  }
  return nearest
}

function geometryRing(geometry: GeometryDefinitionV3) {
  const ring: Vec2[] = []
  for (let index = 0; index < geometry.positions.length; index += 3) {
    ring.push([geometry.positions[index], geometry.positions[index + 2]])
  }
  return ring
}

function geometrySurface(geometry: GeometryDefinitionV3): MultiPolygon {
  const surface: MultiPolygon = []
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const ring: Vec2[] = []
    for (const vertexIndex of geometry.indices.slice(index, index + 3)) {
      const offset = vertexIndex * 3
      ring.push([geometry.positions[offset], geometry.positions[offset + 2]])
    }
    surface.push(polygonFromPoints(ring))
  }
  return surface
}

function distanceToRoad(point: Vec2, road: WorldManifestV3["roads"][number]) {
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < road.centerline.length - 1; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(
        point,
        [road.centerline[index][0], road.centerline[index][2]],
        [road.centerline[index + 1][0], road.centerline[index + 1][2]]
      )
    )
  }
  return nearest
}

function waterPolygonToMultiPolygon(
  polygon: WorldManifestV3["waterBodies"][number]["polygon"]
): MultiPolygon {
  if (polygon.length === 0) return []
  if (typeof polygon[0][0] === "number") {
    return [polygonFromPoints(polygon as Vec2[])]
  }
  return [(polygon as Vec2[][]).map((ring) => polygonFromPoints(ring)[0])]
}

function geometryHasVertex(geometry: GeometryDefinitionV3, vertex: Vec3) {
  for (let index = 0; index < geometry.positions.length; index += 3) {
    if (
      Math.abs(geometry.positions[index] - vertex[0]) <= EPSILON &&
      Math.abs(geometry.positions[index + 1] - vertex[1]) <= EPSILON &&
      Math.abs(geometry.positions[index + 2] - vertex[2]) <= EPSILON
    )
      return true
  }
  return false
}

function terrainHeightAt(point: Vec2, tiles: readonly TerrainTileManifestV3[]) {
  const tile = tiles.find(
    (candidate) =>
      point[0] >= candidate.bounds[0] - EPSILON &&
      point[0] <= candidate.bounds[2] + EPSILON &&
      point[1] >= candidate.bounds[1] - EPSILON &&
      point[1] <= candidate.bounds[3] + EPSILON
  )
  if (!tile) throw new Error(`No terrain tile contains ${point.join(",")}`)
  const localX = Math.max(
    0,
    Math.min(
      tile.resolution[0] - 1,
      (point[0] - tile.bounds[0]) / tile.sampleSpacing
    )
  )
  const localZ = Math.max(
    0,
    Math.min(
      tile.resolution[1] - 1,
      (point[1] - tile.bounds[1]) / tile.sampleSpacing
    )
  )
  const x0 = Math.floor(localX)
  const z0 = Math.floor(localZ)
  const x1 = Math.min(tile.resolution[0] - 1, x0 + 1)
  const z1 = Math.min(tile.resolution[1] - 1, z0 + 1)
  const tx = localX - x0
  const tz = localZ - z0
  const top =
    tileSample(tile, x0, z0) * (1 - tx) + tileSample(tile, x1, z0) * tx
  const bottom =
    tileSample(tile, x0, z1) * (1 - tx) + tileSample(tile, x1, z1) * tx
  return top * (1 - tz) + bottom * tz
}

const MIN_TRAVEL_SURFACE_CLEARANCE = 0.012

function validateTravelSurfaceClearance(
  geometry: GeometryDefinitionV3,
  tiles: readonly TerrainTileManifestV3[]
) {
  const subdivisions = 5
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const vertices = geometry.indices.slice(offset, offset + 3).map((index) => {
      const positionOffset = index * 3
      return [
        geometry.positions[positionOffset],
        geometry.positions[positionOffset + 1],
        geometry.positions[positionOffset + 2],
      ] as Vec3
    })
    for (let aStep = 0; aStep <= subdivisions; aStep += 1) {
      for (let bStep = 0; bStep <= subdivisions - aStep; bStep += 1) {
        const aWeight = aStep / subdivisions
        const bWeight = bStep / subdivisions
        const cWeight = 1 - aWeight - bWeight
        const point: Vec2 = [
          vertices[0][0] * aWeight +
            vertices[1][0] * bWeight +
            vertices[2][0] * cWeight,
          vertices[0][2] * aWeight +
            vertices[1][2] * bWeight +
            vertices[2][2] * cWeight,
        ]
        const surfaceHeight =
          vertices[0][1] * aWeight +
          vertices[1][1] * bWeight +
          vertices[2][1] * cWeight
        const clearance = surfaceHeight - renderedTerrainHeightAt(point, tiles)
        if (clearance < MIN_TRAVEL_SURFACE_CLEARANCE - EPSILON) {
          throw new Error(
            `${geometry.id} is intersected by rendered terrain at ${point
              .map((value) => value.toFixed(3))
              .join(",")}`
          )
        }
      }
    }
  }
}

function validateReachability(manifest: WorldManifestV3) {
  const adjacency = new Map<string, Set<string>>()
  for (const node of manifest.navigation.nodes)
    adjacency.set(node.id, new Set())
  for (const edge of manifest.navigation.edges) {
    adjacency.get(edge.a)?.add(edge.b)
    adjacency.get(edge.b)?.add(edge.a)
  }
  const start =
    manifest.navigation.nodes.find((node) => node.kind === "road") ??
    manifest.navigation.nodes[0]
  if (!start) throw new Error("Journey V3 navigation graph is empty")
  const visited = new Set([start.id])
  const queue = [start.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const next of adjacency.get(id) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  for (const checkpoint of manifest.checkpoints) {
    if (!visited.has(checkpoint.navNodeId)) {
      throw new Error(`${checkpoint.id} is unreachable from spawn`)
    }
  }
  for (const building of manifest.environmentalBuildings) {
    if (!visited.has(`nav.access.${building.id}`)) {
      throw new Error(`${building.id} has no reachable entrance`)
    }
  }
}

export function validateWorldManifestV3(manifest: WorldManifestV3) {
  if (manifest.schemaVersion !== 3 || manifest.units !== "metres") {
    throw new Error("Journey V3 schema or units are invalid")
  }
  if (manifest.portfolioRecords.length !== 12) {
    throw new Error("Journey V3 must retain all twelve canonical record IDs")
  }
  if (
    manifest.scope === "complete" &&
    manifest.checkpoints.length !== manifest.portfolioRecords.length
  ) {
    throw new Error(
      "The complete Journey requires one physical checkpoint per record"
    )
  }
  const orders = manifest.portfolioRecords
    .map((record) => record.routeOrder)
    .sort((a, b) => a - b)
  if (orders.some((order, index) => order !== index)) {
    throw new Error("Journey V3 record route order must be contiguous")
  }
  assertUnique(
    "portfolio record",
    manifest.portfolioRecords.map((record) => record.recordId)
  )
  assertUnique(
    "geometry",
    manifest.geometries.map((geometry) => geometry.id)
  )
  assertUnique(
    "material",
    manifest.materials.map((material) => material.id)
  )
  assertUnique(
    "cell",
    manifest.cells.map((cell) => cell.id)
  )
  assertUnique(
    "environmental building",
    manifest.environmentalBuildings.map((building) => building.id)
  )
  assertUnique(
    "instance batch",
    manifest.instanceBatches.map((batch) => batch.id)
  )
  assertUnique(
    "collider",
    manifest.colliders.map((collider) => collider.id)
  )
  assertUnique(
    "navigation node",
    manifest.navigation.nodes.map((node) => node.id)
  )
  assertUnique(
    "navigation edge",
    manifest.navigation.edges.map((edge) => edge.id)
  )
  for (const cell of manifest.cells) {
    if (checksumJson({ ...cell, checksum: "" }) !== cell.checksum) {
      throw new Error(`${cell.id} checksum does not match its references`)
    }
  }
  const cellById = new Map(manifest.cells.map((cell) => [cell.id, cell]))
  const colliderById = new Map(
    manifest.colliders.map((collider) => [collider.id, collider])
  )
  for (const collider of manifest.colliders) {
    const cell = cellById.get(collider.cellId)
    if (!cell || !cell.colliderIds.includes(collider.id)) {
      throw new Error(`${collider.id} is not owned by its streaming cell`)
    }
  }
  for (const cell of manifest.cells) {
    for (const colliderId of cell.colliderIds) {
      if (!colliderById.has(colliderId)) {
        throw new Error(`${cell.id} references missing collider ${colliderId}`)
      }
    }
  }

  const recordIds = new Set(
    manifest.portfolioRecords.map((record) => record.recordId)
  )
  const environmentalBuildingsById = new Map(
    manifest.environmentalBuildings.map((building) => [building.id, building])
  )
  const claimedArrivalBuildingIds = new Set<string>()
  assertUnique(
    "checkpoint record",
    manifest.checkpoints.map((checkpoint) => checkpoint.recordId)
  )
  for (const checkpoint of manifest.checkpoints) {
    if (!recordIds.has(checkpoint.recordId)) {
      throw new Error(`${checkpoint.id} references a missing portfolio record`)
    }
    if ("buildingId" in checkpoint) {
      throw new Error(
        `${checkpoint.id} is coupled to an environmental building`
      )
    }
    const arrivalBuilding = environmentalBuildingsById.get(
      checkpoint.arrivalBuildingId
    )
    if (!arrivalBuilding) {
      throw new Error(
        `${checkpoint.id} references missing arrival building ${checkpoint.arrivalBuildingId}`
      )
    }
    if (arrivalBuilding.districtId !== checkpoint.districtId) {
      throw new Error(
        `${checkpoint.id} and ${arrivalBuilding.id} belong to different districts`
      )
    }
    if (claimedArrivalBuildingIds.has(arrivalBuilding.id)) {
      throw new Error(
        `${arrivalBuilding.id} is assigned to multiple compiled checkpoints`
      )
    }
    claimedArrivalBuildingIds.add(arrivalBuilding.id)
  }
  const expectedDistrictIds = new Set(
    manifest.portfolioRecords.map((record) => record.districtId)
  )
  const cellDistrictIds = new Set(manifest.cells.map((cell) => cell.districtId))
  for (const districtId of expectedDistrictIds) {
    if (!cellDistrictIds.has(districtId)) {
      throw new Error(`${districtId} has no deterministic streaming cell`)
    }
  }
  for (const building of manifest.environmentalBuildings) {
    const serialized = building as unknown as Record<string, unknown>
    if (
      typeof serialized.archetype !== "string" ||
      !ENVIRONMENTAL_BUILDING_ARCHETYPES_V3.has(
        serialized.archetype as EnvironmentalBuildingArchetypeV3
      )
    ) {
      throw new Error(`${building.id} has an invalid environmental archetype`)
    }
    for (const forbidden of FORBIDDEN_ENVIRONMENTAL_BUILDING_FIELDS) {
      if (forbidden in serialized) {
        throw new Error(
          `${building.id} contains forbidden portfolio field ${forbidden}`
        )
      }
    }
  }

  validateTerrainSeams(manifest.terrain.tiles)
  const geometryById = new Map(
    manifest.geometries.map((geometry) => [geometry.id, geometry])
  )
  const materialById = new Map(
    manifest.materials.map((material) => [material.id, material])
  )
  const buildingById = new Map(
    manifest.environmentalBuildings.map((building) => [building.id, building])
  )
  const batchById = new Map(
    manifest.instanceBatches.map((batch) => [batch.id, batch])
  )
  for (const geometry of manifest.geometries) {
    const material = materialById.get(geometry.materialId)
    if (!material) {
      throw new Error(
        `${geometry.id} references missing material ${geometry.materialId}`
      )
    }
    if (
      geometry.positions.length % 3 !== 0 ||
      geometry.indices.length % 3 !== 0 ||
      geometry.positions.some((value) => !Number.isFinite(value)) ||
      geometry.indices.some((value) => !Number.isInteger(value))
    ) {
      throw new Error(`${geometry.id} has invalid serialized geometry data`)
    }
    if (
      geometry.colors !== undefined &&
      geometry.colors.length !== geometry.positions.length
    ) {
      throw new Error(`${geometry.id} has misaligned vertex colors`)
    }
    if (material.vertexColors && geometry.colors === undefined) {
      throw new Error(
        `${geometry.id} uses ${material.id} without compiled vertex colors`
      )
    }
  }
  for (const cell of manifest.cells) {
    for (const geometryId of cell.geometryIds) {
      if (!geometryById.has(geometryId)) {
        throw new Error(`${cell.id} references missing geometry ${geometryId}`)
      }
    }
    for (const batchId of cell.batchIds) {
      if (!batchById.has(batchId)) {
        throw new Error(`${cell.id} references missing batch ${batchId}`)
      }
    }
    for (const buildingId of cell.environmentalBuildingIds) {
      if (!buildingById.has(buildingId)) {
        throw new Error(
          `${cell.id} references missing environmental building ${buildingId}`
        )
      }
    }
  }
  for (const batch of manifest.instanceBatches) {
    const cell = cellById.get(batch.cellId)
    const geometry = geometryById.get(batch.geometryId)
    if (!cell || !cell.batchIds.includes(batch.id)) {
      throw new Error(`${batch.id} is not owned by its streaming cell`)
    }
    if (!geometry || geometry.kind !== "primitive") {
      throw new Error(
        `${batch.id} references missing primitive ${batch.geometryId}`
      )
    }
    if (!materialById.has(batch.materialId)) {
      throw new Error(
        `${batch.id} references missing material ${batch.materialId}`
      )
    }
  }

  const benchReferences = [
    ...manifest.materials.map((material) => material.id),
    ...manifest.geometries.map((geometry) => geometry.id),
    ...manifest.colliders.map((collider) => collider.id),
    ...manifest.environmentalBuildings.flatMap((building) => [
      building.id,
      ...building.geometryIds,
      ...building.materialIds,
    ]),
    ...manifest.instanceBatches.flatMap((batch) => [
      batch.id,
      batch.kind,
      batch.speciesId,
      batch.geometryId,
      batch.materialId,
    ]),
  ].filter((value) => value.toLowerCase().includes("bench"))
  if (benchReferences.length > 0) {
    throw new Error(
      `Journey V3 must not compile bench scenery (${benchReferences[0]})`
    )
  }

  for (const building of manifest.environmentalBuildings) {
    if (
      building.geometryIds.length < 1 ||
      building.geometryIds.length > 3 ||
      new Set(building.geometryIds).size !== building.geometryIds.length
    ) {
      throw new Error(
        `${building.id} must reference one to three unique building geometries`
      )
    }
    if (
      building.materialIds.length < 1 ||
      new Set(building.materialIds).size !== building.materialIds.length
    ) {
      throw new Error(
        `${building.id} must reference unique compiled building materials`
      )
    }

    const ownerCells = manifest.cells.filter((cell) =>
      cell.environmentalBuildingIds.includes(building.id)
    )
    if (
      ownerCells.length !== 1 ||
      ownerCells[0].id !== building.cellId ||
      cellById.get(building.cellId) !== ownerCells[0]
    ) {
      throw new Error(
        `${building.id} is not owned by exactly one declared streaming cell`
      )
    }

    const usedMaterialIds = new Set<string>()
    for (const geometryId of building.geometryIds) {
      const geometry = geometryById.get(geometryId)
      if (!geometry || geometry.kind !== "building") {
        throw new Error(
          `${building.id} references missing or non-building geometry ${geometryId}`
        )
      }
      const geometryOwnerCells = manifest.cells.filter((cell) =>
        cell.geometryIds.includes(geometryId)
      )
      if (
        geometryOwnerCells.length !== 1 ||
        geometryOwnerCells[0].id !== building.cellId
      ) {
        throw new Error(
          `${geometryId} is not owned by ${building.id}'s streaming cell`
        )
      }
      if (!materialById.has(geometry.materialId)) {
        throw new Error(
          `${geometryId} references missing material ${geometry.materialId}`
        )
      }
      usedMaterialIds.add(geometry.materialId)
    }

    for (const materialId of building.materialIds) {
      if (!materialById.has(materialId)) {
        throw new Error(`${building.id} references missing ${materialId}`)
      }
      if (!usedMaterialIds.has(materialId)) {
        throw new Error(
          `${building.id} lists unused building material ${materialId}`
        )
      }
    }
    if (usedMaterialIds.size !== building.materialIds.length) {
      throw new Error(
        `${building.id} does not declare every compiled geometry material`
      )
    }
  }

  for (const road of manifest.roads) {
    for (let index = 0; index < road.centerline.length - 1; index += 1) {
      const a = road.centerline[index]
      const b = road.centerline[index + 1]
      const bridge = manifest.bridges.find((candidate) =>
        pointInMultiPolygon(
          [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2],
          [polygonFromPoints(candidate.deckPolygon)]
        )
      )
      const maximumGrade = bridge ? 0.08 : 0.05
      if (roadGrade(a, b) > maximumGrade + 1e-4) {
        throw new Error(
          `${road.id} exceeds ${(maximumGrade * 100).toFixed(0)}% grade`
        )
      }
    }
  }

  const waterPolygons = manifest.waterBodies.map((water) => ({
    water,
    multiPolygon: waterPolygonToMultiPolygon(water.polygon),
  }))
  for (const { water, multiPolygon } of waterPolygons) {
    const flowLength = Math.hypot(
      water.flowDirection[0],
      water.flowDirection[1]
    )
    if (
      !Number.isFinite(flowLength) ||
      Math.abs(flowLength - 1) > 0.001 ||
      !Number.isFinite(water.flowSpeed) ||
      water.flowSpeed < 0 ||
      water.flowSpeed > 1 ||
      !Number.isFinite(water.flowStrength) ||
      water.flowStrength < 0 ||
      water.flowStrength > 1
    ) {
      throw new Error(`${water.id} has invalid compiled water flow`)
    }
    const expectedMaterialId = `surface.${water.id}`
    const material = materialById.get(expectedMaterialId)
    if (
      !material ||
      material.kind !== "water" ||
      !material.flowDirection ||
      material.flowDirection.some(
        (value, index) => Math.abs(value - water.flowDirection[index]) > EPSILON
      ) ||
      Math.abs((material.flowSpeed ?? -1) - water.flowSpeed) > EPSILON ||
      Math.abs((material.flowStrength ?? -1) - water.flowStrength) > EPSILON
    ) {
      throw new Error(`${water.id} is missing its body-specific flow material`)
    }
    if (water.geometryIds.length === 0) {
      throw new Error(`${water.id} has no compiled water surface`)
    }
    for (const geometryId of water.geometryIds) {
      const geometry = geometryById.get(geometryId)
      if (
        !geometry ||
        geometry.kind !== "water" ||
        geometry.materialId !== expectedMaterialId ||
        geometry.positions.some(
          (value, index) =>
            index % 3 === 1 && Math.abs(value - water.waterLevel) > EPSILON
        )
      ) {
        throw new Error(`${water.id} has an invalid compiled water surface`)
      }
    }
    const bedHeights: number[] = []
    for (const tile of manifest.terrain.tiles) {
      for (let row = 0; row < tile.resolution[1]; row += 1) {
        for (let column = 0; column < tile.resolution[0]; column += 1) {
          const point: Vec2 = [
            tile.bounds[0] + column * tile.sampleSpacing,
            tile.bounds[1] + row * tile.sampleSpacing,
          ]
          if (pointInMultiPolygon(point, multiPolygon)) {
            bedHeights.push(tileSample(tile, column, row))
          }
        }
      }
    }
    bedHeights.sort((a, b) => a - b)
    const bedP90 = bedHeights[Math.floor(bedHeights.length * 0.9)]
    if (
      bedHeights.length === 0 ||
      !Number.isFinite(bedP90) ||
      bedP90 > water.waterLevel - 0.6
    ) {
      throw new Error(`${water.id} lacks a visibly incised water bed`)
    }
    if (Array.isArray(water.polygon[0]?.[0])) {
      const rings = water.polygon as Vec2[][]
      for (const island of rings.slice(1)) {
        const center: Vec2 = [
          island.reduce((sum, point) => sum + point[0], 0) / island.length,
          island.reduce((sum, point) => sum + point[1], 0) / island.length,
        ]
        if (pointInMultiPolygon(center, multiPolygon)) {
          throw new Error(`${water.id} classifies its island as water`)
        }
        if (
          terrainHeightAt(center, manifest.terrain.tiles) <=
          water.waterLevel + 0.05
        ) {
          throw new Error(`${water.id} island is not compiled as dry land`)
        }
      }
    }
  }

  const dryTerrainSamples: {
    point: Vec2
    height: number
  }[] = []
  for (const tile of manifest.terrain.tiles) {
    for (let row = 0; row < tile.resolution[1]; row += 1) {
      for (let column = 0; column < tile.resolution[0]; column += 1) {
        const point: Vec2 = [
          tile.bounds[0] + column * tile.sampleSpacing,
          tile.bounds[1] + row * tile.sampleSpacing,
        ]
        if (
          waterPolygons.some(({ multiPolygon }) =>
            pointInMultiPolygon(point, multiPolygon)
          )
        ) {
          continue
        }
        dryTerrainSamples.push({
          point,
          height: tileSample(tile, column, row),
        })
      }
    }
  }
  const orderedDryHeights = dryTerrainSamples
    .map((sample) => sample.height)
    .sort((a, b) => a - b)
  const dryP05 = orderedDryHeights[Math.floor(orderedDryHeights.length * 0.05)]
  const dryP95 = orderedDryHeights[Math.floor(orderedDryHeights.length * 0.95)]
  if (
    !Number.isFinite(dryP05) ||
    !Number.isFinite(dryP95) ||
    dryP95 - dryP05 < 0.85
  ) {
    throw new Error("Journey V3 mainland lacks broad low and high ground")
  }
  for (const { water, multiPolygon } of waterPolygons) {
    const nearbyDryClearances = dryTerrainSamples
      .filter(
        ({ point }) =>
          distanceToMultiPolygon(point, multiPolygon) <=
          manifest.terrain.sampleSpacing * 1.5
      )
      .map(({ height }) => height - water.waterLevel)
      .sort((a, b) => a - b)
    const medianClearance =
      nearbyDryClearances[Math.floor(nearbyDryClearances.length / 2)]
    const p10Clearance =
      nearbyDryClearances[Math.floor(nearbyDryClearances.length * 0.1)]
    const minimumMedian = water.kind === "ocean" ? 0.45 : 0.95
    const minimumP10 = water.kind === "ocean" ? 0.3 : 0.75
    if (
      nearbyDryClearances.length < 4 ||
      !Number.isFinite(medianClearance) ||
      !Number.isFinite(p10Clearance) ||
      medianClearance < minimumMedian ||
      p10Clearance < minimumP10
    ) {
      throw new Error(`${water.id} is not visibly recessed below its banks`)
    }
  }

  for (const [
    buildingIndex,
    building,
  ] of manifest.environmentalBuildings.entries()) {
    const footprint = polygonFromPoints(building.footprint)
    for (const { water, multiPolygon } of waterPolygons) {
      if (multiPolygonArea(intersection([footprint], multiPolygon)) > 0.001) {
        throw new Error(`${building.id} overlaps ${water.id}`)
      }
    }
    const padHeights = building.footprint.map((point) =>
      terrainHeightAt(point, manifest.terrain.tiles)
    )
    if (Math.max(...padHeights) - Math.min(...padHeights) > 0.02 + EPSILON) {
      throw new Error(`${building.id} building pad varies by more than 0.02m`)
    }
    for (const road of manifest.roads) {
      for (let index = 0; index < road.centerline.length - 1; index += 1) {
        const start = road.centerline[index]
        const end = road.centerline[index + 1]
        const roadSegment = orientedRectangle(
          [(start[0] + end[0]) / 2, (start[2] + end[2]) / 2],
          [end[0] - start[0], end[2] - start[2]],
          distance([start[0], start[2]], [end[0], end[2]]) + 0.02,
          road.width
        )
        if (
          multiPolygonArea(intersection([footprint], [roadSegment])) > 0.001
        ) {
          throw new Error(`${building.id} overlaps ${road.id}`)
        }
      }
    }
    for (
      let otherIndex = buildingIndex + 1;
      otherIndex < manifest.environmentalBuildings.length;
      otherIndex += 1
    ) {
      const other = manifest.environmentalBuildings[otherIndex]
      if (
        multiPolygonArea(
          intersection([footprint], [polygonFromPoints(other.footprint)])
        ) > 0.001
      ) {
        throw new Error(`${building.id} overlaps ${other.id}`)
      }
    }
  }

  for (const road of manifest.roads) {
    const radius = road.endTurnaroundRadius
    if (radius === undefined) continue
    if (!Number.isFinite(radius) || radius < road.width / 2) {
      throw new Error(`${road.id} turnaround does not cover the road width`)
    }
    const geometryId = `geometry.road-turnaround.${road.id}`
    const geometry = geometryById.get(geometryId)
    if (!geometry || !road.surfaceGeometryIds.includes(geometryId)) {
      throw new Error(`${road.id} is missing its turnaround surface`)
    }
    const endpoint = road.centerline[road.centerline.length - 1]
    const endpoint2: Vec2 = [endpoint[0], endpoint[2]]
    const ring = geometryRing(geometry)
    const polygon = polygonFromPoints(ring)
    if (!pointInMultiPolygon(endpoint2, [polygon])) {
      throw new Error(`${road.id} endpoint is outside its turnaround`)
    }
    if (
      ring.some(
        ([x, z]) =>
          x < manifest.world.bounds[0] + 2 ||
          x > manifest.world.bounds[2] - 2 ||
          z < manifest.world.bounds[1] + 2 ||
          z > manifest.world.bounds[3] - 2
      )
    ) {
      throw new Error(`${road.id} turnaround is too close to the world edge`)
    }
    const owningCells = manifest.cells.filter((cell) =>
      cell.geometryIds.includes(geometryId)
    )
    if (
      owningCells.length !== 1 ||
      ring.some(
        ([x, z]) =>
          x < owningCells[0].bounds[0] - EPSILON ||
          x > owningCells[0].bounds[2] + EPSILON ||
          z < owningCells[0].bounds[1] - EPSILON ||
          z > owningCells[0].bounds[3] + EPSILON
      )
    ) {
      throw new Error(
        `${road.id} turnaround is not contained by one streaming cell`
      )
    }
    for (const { water, multiPolygon } of waterPolygons) {
      if (multiPolygonArea(intersection([polygon], multiPolygon)) > 0.001) {
        throw new Error(`${road.id} turnaround overlaps ${water.id}`)
      }
    }
    for (const building of manifest.environmentalBuildings) {
      if (
        multiPolygonArea(
          intersection([polygon], [polygonFromPoints(building.footprint)])
        ) > 0.001
      ) {
        throw new Error(`${road.id} turnaround overlaps ${building.id}`)
      }
    }
    const terminalNode = manifest.navigation.nodes.find(
      (node) =>
        node.kind === "road" &&
        distance([node.position[0], node.position[2]], endpoint2) <= 0.1
    )
    if (
      !terminalNode ||
      !pointInMultiPolygon(
        [terminalNode.position[0], terminalNode.position[2]],
        [polygon]
      )
    ) {
      throw new Error(
        `${road.id} terminal navigation node is outside its turnaround`
      )
    }
  }
  const orderedCheckpoints = [...manifest.checkpoints].sort((a, b) => {
    const aOrder =
      manifest.portfolioRecords.find((record) => record.recordId === a.recordId)
        ?.routeOrder ?? 0
    const bOrder =
      manifest.portfolioRecords.find((record) => record.recordId === b.recordId)
        ?.routeOrder ?? 0
    return aOrder - bOrder
  })
  for (let index = 1; index < orderedCheckpoints.length; index += 1) {
    const previousCheckpoint = orderedCheckpoints[index - 1]
    const currentCheckpoint = orderedCheckpoints[index]
    const previous = previousCheckpoint.position
    const current = currentCheckpoint.position
    const previousPoint: Vec2 = [previous[0], previous[2]]
    const currentPoint: Vec2 = [current[0], current[2]]
    const separation = distance(previousPoint, currentPoint)
    const interveningBridge = manifest.bridges.find((bridge) =>
      bridgeIntervenesBetweenCheckpointsV3(
        bridge,
        previousCheckpoint,
        currentCheckpoint
      )
    )
    const maximumSeparation = interveningBridge
      ? 36 +
        Math.max(interveningBridge.length / 2, interveningBridge.width * 2)
      : 36
    if (separation < 14 || separation > maximumSeparation) {
      throw new Error(
        `${orderedCheckpoints[index].id} is ${separation.toFixed(1)}m from the previous checkpoint`
      )
    }
  }
  const claimedArrivalAnchorIds = new Set<string>()
  const claimedArrivalArchetypes = new Set<EnvironmentalBuildingArchetypeV3>()
  for (const checkpoint of manifest.checkpoints) {
    const point: Vec2 = [checkpoint.position[0], checkpoint.position[2]]
    if (
      point[0] < manifest.world.bounds[0] ||
      point[0] > manifest.world.bounds[2] ||
      point[1] < manifest.world.bounds[1] ||
      point[1] > manifest.world.bounds[3]
    ) {
      throw new Error(`${checkpoint.id} is outside the world`)
    }
    if (
      waterPolygons.some(({ multiPolygon }) =>
        pointInMultiPolygon(point, multiPolygon)
      )
    ) {
      throw new Error(`${checkpoint.id} is placed in water`)
    }
    for (const building of manifest.environmentalBuildings) {
      if (
        distanceToPolygon(point, building.footprint) <
        checkpoint.interactionRadius + 0.6
      ) {
        throw new Error(
          `${checkpoint.id} clearing overlaps environmental building ${building.id}`
        )
      }
    }
    if (checkpoint.approachGeometryIds.length !== 2) {
      throw new Error(`${checkpoint.id} lacks a path and arrival clearing`)
    }
    const [approachId, clearingId] = checkpoint.approachGeometryIds
    const approach = geometryById.get(approachId)
    const clearing = geometryById.get(clearingId)
    if (!approach || !clearing) {
      throw new Error(`${checkpoint.id} references missing approach geometry`)
    }
    const approachSurface = geometrySurface(approach)
    const clearingSurface = geometrySurface(clearing)
    if (!pointInMultiPolygon(point, clearingSurface)) {
      throw new Error(`${checkpoint.id} is outside its arrival clearing`)
    }
    if (
      multiPolygonArea(intersection(approachSurface, clearingSurface)) > EPSILON
    ) {
      throw new Error(`${checkpoint.id} has duplicate coplanar access surfaces`)
    }
    const road = manifest.roads.find(
      (candidate) => candidate.id === checkpoint.roadId
    )
    if (!road) throw new Error(`${checkpoint.id} references missing road`)
    const roadGeometries = road.surfaceGeometryIds
      .map((id) => geometryById.get(id))
      .filter(
        (geometry): geometry is GeometryDefinitionV3 => geometry !== undefined
      )
    for (const vertex of checkpoint.sharedRoadBoundary) {
      if (!geometryHasVertex(approach, vertex)) {
        throw new Error(`${checkpoint.id} path does not reuse the road edge`)
      }
      if (
        !roadGeometries.some((geometry) => geometryHasVertex(geometry, vertex))
      ) {
        throw new Error(`${checkpoint.id} road does not own its shared edge`)
      }
    }
    for (const { water, multiPolygon } of waterPolygons) {
      if (
        multiPolygonArea(intersection(approachSurface, multiPolygon)) > 0.001 ||
        multiPolygonArea(intersection(clearingSurface, multiPolygon)) > 0.001
      ) {
        throw new Error(`${checkpoint.id} approach overlaps ${water.id}`)
      }
    }

    const ownerCell = manifest.cells.find((cell) =>
      cell.geometryIds.includes(clearingId)
    )
    if (!ownerCell) {
      throw new Error(`${checkpoint.id} clearing has no streaming owner`)
    }
    const anchors = manifest.environmentalBuildings.filter(
      (building) =>
        building.districtId === checkpoint.districtId &&
        building.cellId === ownerCell.id &&
        distance(point, [building.entrance[0], building.entrance[2]]) >= 3.75 &&
        distance(point, [building.entrance[0], building.entrance[2]]) <= 4.05
    )
    if (anchors.length !== 1) {
      throw new Error(
        `${checkpoint.id} requires exactly one nearby visual building anchor`
      )
    }
    const anchor = anchors[0]
    if (claimedArrivalAnchorIds.has(anchor.id)) {
      throw new Error(`${anchor.id} frames more than one arrival forecourt`)
    }
    if (claimedArrivalArchetypes.has(anchor.archetype)) {
      throw new Error(
        `${anchor.archetype} is reused by more than one arrival structure`
      )
    }
    claimedArrivalAnchorIds.add(anchor.id)
    claimedArrivalArchetypes.add(anchor.archetype)
    const arrivalJunction = manifest.accessJunctions.find(
      (junction) => junction.buildingId === anchor.id
    )
    if (
      !arrivalJunction ||
      arrivalJunction.surfaceGeometryIds.length !== 2 ||
      checkpoint.approachGeometryIds.some(
        (geometryId) => !arrivalJunction.surfaceGeometryIds.includes(geometryId)
      )
    ) {
      throw new Error(
        `${checkpoint.id} does not share its access surface with ${anchor.id}`
      )
    }
    if (geometryById.has(`geometry.${anchor.id}.access`)) {
      throw new Error(`${anchor.id} emits a duplicate building access surface`)
    }
  }
  if (claimedArrivalAnchorIds.size !== manifest.checkpoints.length) {
    throw new Error("Arrival structures are not one-to-one with forecourts")
  }
  if (
    manifest.scope === "complete" &&
    (claimedArrivalAnchorIds.size !== 12 ||
      claimedArrivalArchetypes.size !== claimedArrivalAnchorIds.size)
  ) {
    throw new Error(
      "The complete Journey requires twelve distinct arrival archetypes"
    )
  }
  for (const road of manifest.roads) {
    for (const geometryId of road.surfaceGeometryIds) {
      const geometry = geometryById.get(geometryId)
      if (!geometry) {
        throw new Error(`${road.id} references missing ${geometryId}`)
      }
      for (let index = 0; index < geometry.indices.length; index += 3) {
        const a = geometry.indices[index] * 3
        const b = geometry.indices[index + 1] * 3
        const c = geometry.indices[index + 2] * 3
        const ax = geometry.positions[a]
        const az = geometry.positions[a + 2]
        const bx = geometry.positions[b]
        const bz = geometry.positions[b + 2]
        const cx = geometry.positions[c]
        const cz = geometry.positions[c + 2]
        const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
        if (normalY <= 1e-8) {
          throw new Error(`${geometryId} contains a downward road triangle`)
        }
      }
    }
  }
  for (const junction of manifest.accessJunctions) {
    const road = manifest.roads.find(
      (candidate) => candidate.id === junction.roadId
    )
    if (!road) throw new Error(`${junction.id} references missing road`)
    const accessGeometries = junction.surfaceGeometryIds.map((id) => {
      const geometry = geometryById.get(id)
      if (!geometry) throw new Error(`${junction.id} references missing ${id}`)
      return geometry
    })
    const roadGeometries = road.surfaceGeometryIds
      .map((id) => geometryById.get(id))
      .filter(
        (geometry): geometry is GeometryDefinitionV3 => geometry !== undefined
      )
    for (const vertex of junction.sharedBoundary) {
      if (
        !accessGeometries.some((geometry) =>
          geometryHasVertex(geometry, vertex)
        )
      ) {
        throw new Error(
          `${junction.id} access does not reuse its road boundary`
        )
      }
      if (
        !roadGeometries.some((geometry) => geometryHasVertex(geometry, vertex))
      ) {
        throw new Error(`${junction.id} road does not own its shared boundary`)
      }
    }
  }

  const travelSurfaceIds = new Set([
    ...manifest.roads.flatMap((road) => road.surfaceGeometryIds),
    ...manifest.accessJunctions.flatMap(
      (junction) => junction.surfaceGeometryIds
    ),
    ...manifest.bridges.flatMap((bridge) =>
      bridge.geometryIds.filter((geometryId) => geometryId.endsWith(".deck"))
    ),
  ])
  for (const geometryId of travelSurfaceIds) {
    const geometry = geometryById.get(geometryId)
    if (!geometry) {
      throw new Error(`Travel surface ${geometryId} is missing`)
    }
    validateTravelSurfaceClearance(geometry, manifest.terrain.tiles)
  }

  for (const bridge of manifest.bridges) {
    const profile = bridge.deckCenterline ?? []
    const highestProfilePoint = Math.max(...profile.map((point) => point[1]))
    const endpointMaximum = Math.max(
      profile[0]?.[1] ?? bridge.deckHeight,
      profile[profile.length - 1]?.[1] ?? bridge.deckHeight
    )
    if (
      profile.length < 5 ||
      !Number.isFinite(bridge.crownRise) ||
      (bridge.crownRise ?? 0) < 0.15 ||
      !Number.isFinite(bridge.deckThickness) ||
      (bridge.deckThickness ?? 0) < 0.2 ||
      Math.abs(highestProfilePoint - bridge.deckHeight) > EPSILON ||
      bridge.deckHeight - endpointMaximum < 0.12
    ) {
      throw new Error(`${bridge.id} is not a raised crowned bridge`)
    }
    for (let index = 0; index < profile.length - 1; index += 1) {
      if (roadGrade(profile[index], profile[index + 1]) > 0.08 + 1e-4) {
        throw new Error(`${bridge.id} crowned profile exceeds 8% grade`)
      }
    }
    const bridgeGeometries = bridge.geometryIds.map((geometryId) => {
      const geometry = geometryById.get(geometryId)
      if (!geometry) {
        throw new Error(`${bridge.id} references missing ${geometryId}`)
      }
      return geometry
    })
    const deck = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".deck")
    )
    const structure = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".structure")
    )
    const rails = bridgeGeometries.find((geometry) =>
      geometry.id.endsWith(".rails")
    )
    if (
      !deck ||
      deck.walkable !== true ||
      deck.materialId !== "surface.road-summer" ||
      !structure ||
      structure.walkable !== false ||
      structure.materialId !== "surface.bridge-support" ||
      !rails ||
      rails.walkable !== false
    ) {
      throw new Error(`${bridge.id} lacks a realistic deck, support, or rail`)
    }
    const water = waterPolygons.find(
      (candidate) => candidate.water.id === bridge.waterBodyId
    )
    if (!water) throw new Error(`${bridge.id} references missing water`)
    if (
      multiPolygonArea(
        intersection(
          [polygonFromPoints(bridge.deckPolygon)],
          water.multiPolygon
        )
      ) <= 0.01
    ) {
      throw new Error(`${bridge.id} does not cross ${bridge.waterBodyId}`)
    }
    if (bridge.navNodeIds.some((id) => !id)) {
      throw new Error(`${bridge.id} is missing grounded navigation anchors`)
    }
    if (
      bridge.railColliderIds.length !== 2 ||
      new Set(bridge.railColliderIds).size !== 2
    ) {
      throw new Error(`${bridge.id} must have two unique rail colliders`)
    }
    const railColliders = bridge.railColliderIds.map((id) => {
      const collider = colliderById.get(id)
      if (!collider)
        throw new Error(`${bridge.id} is missing rail collider ${id}`)
      if (
        !id.startsWith(`collider.${bridge.id}.rail.`) ||
        collider.minY > bridge.deckHeight + 0.05 ||
        collider.maxY < bridge.deckHeight + 0.4
      ) {
        throw new Error(`${id} is not a grounded bridge rail collider`)
      }
      if (
        multiPolygonArea(
          intersection(
            [polygonFromPoints(collider.polygon)],
            [polygonFromPoints(bridge.deckPolygon)]
          )
        ) <= 0.01
      ) {
        throw new Error(`${id} is detached from the bridge deck`)
      }
      return collider
    })
    for (const progress of [-0.45, -0.2, 0, 0.2, 0.45]) {
      const centerlinePoint: Vec2 = [
        bridge.center[0] + bridge.tangent[0] * bridge.length * progress,
        bridge.center[2] + bridge.tangent[1] * bridge.length * progress,
      ]
      if (
        railColliders.some(
          (collider) =>
            distanceToPolygon(centerlinePoint, collider.polygon) < 0.75
        )
      ) {
        throw new Error(`${bridge.id} rail collider blocks its nav centerline`)
      }
    }
    const halfLength = bridge.length / 2
    const banks: Vec2[] = [
      [
        bridge.center[0] - bridge.tangent[0] * halfLength,
        bridge.center[2] - bridge.tangent[1] * halfLength,
      ],
      [
        bridge.center[0] + bridge.tangent[0] * halfLength,
        bridge.center[2] + bridge.tangent[1] * halfLength,
      ],
    ]
    if (banks.some((bank) => pointInMultiPolygon(bank, water.multiPolygon))) {
      throw new Error(`${bridge.id} does not terminate on two grounded banks`)
    }
  }
  for (const road of manifest.roads) {
    for (const point of road.centerline) {
      const point2: Vec2 = [point[0], point[2]]
      const water = waterPolygons.find((candidate) =>
        pointInMultiPolygon(point2, candidate.multiPolygon)
      )
      if (!water) continue
      const bridges = manifest.bridges.filter(
        (bridge) =>
          bridge.roadId === road.id &&
          bridge.waterBodyId === water.water.id &&
          pointInMultiPolygon(point2, [polygonFromPoints(bridge.deckPolygon)])
      )
      if (bridges.length !== 1) {
        throw new Error(
          `${road.id} crosses ${water.water.id} without exactly one bridge`
        )
      }
    }
  }

  for (const batch of manifest.instanceBatches) {
    if (
      batch.transforms.length !== batch.densityRanks.length ||
      batch.transforms.length !== batch.colors.length
    ) {
      throw new Error(`${batch.id} instance metadata is misaligned`)
    }
    const isRock = batch.kind === "rock" || batch.speciesId === "rock"
    if (
      isRock &&
      (batch.kind !== "rock" ||
        batch.speciesId !== "rock" ||
        (batch.lod !== "near" && batch.lod !== "mid") ||
        batch.geometryId !== `primitive.rock.${batch.lod}` ||
        batch.materialId !== "environment.rock")
    ) {
      throw new Error(`${batch.id} has invalid rock LOD or material metadata`)
    }
    for (const transform of batch.transforms) {
      const point: Vec2 = [transform[0], transform[2]]
      const travelClearance = isRock
        ? ROCK_CLEARANCE_V3.road
        : batch.kind === "grass"
          ? VEGETATION_TRAVEL_CLEARANCE_V3.grass
          : VEGETATION_TRAVEL_CLEARANCE_V3.tree
      if (
        waterPolygons.some(({ multiPolygon }) =>
          pointInMultiPolygon(point, multiPolygon)
        )
      ) {
        throw new Error(`${batch.id} places vegetation in water`)
      }
      if (
        manifest.environmentalBuildings.some((building) =>
          pointInMultiPolygon(point, [polygonFromPoints(building.footprint)])
        )
      ) {
        throw new Error(`${batch.id} places vegetation inside a building`)
      }
      if (
        manifest.roads.some(
          (road) =>
            distanceToRoad(point, road) < road.width / 2 + travelClearance ||
            (road.endTurnaroundRadius !== undefined &&
              distance(point, [
                road.centerline[road.centerline.length - 1][0],
                road.centerline[road.centerline.length - 1][2],
              ]) <
                road.endTurnaroundRadius + travelClearance)
        )
      ) {
        throw new Error(
          isRock
            ? `${batch.id} rock violates road clearance`
            : `${batch.id} places vegetation on a road`
        )
      }
      if (
        manifest.accessJunctions.some((junction) =>
          junction.surfaceGeometryIds.some((geometryId) => {
            const geometry = geometryById.get(geometryId)
            return (
              geometry !== undefined &&
              distanceToMultiPolygon(point, geometrySurface(geometry)) <
                travelClearance
            )
          })
        )
      ) {
        throw new Error(`${batch.id} places vegetation on an access surface`)
      }
      if (
        manifest.bridges.some(
          (bridge) =>
            distanceToPolygon(point, bridge.deckPolygon) < travelClearance
        )
      ) {
        throw new Error(`${batch.id} places vegetation on a bridge`)
      }
      if (!isRock) continue
      if (
        waterPolygons.some(
          ({ multiPolygon }) =>
            distanceToMultiPolygon(point, multiPolygon) <
            ROCK_CLEARANCE_V3.water
        )
      ) {
        throw new Error(`${batch.id} rock violates water clearance`)
      }
      if (
        manifest.environmentalBuildings.some(
          (building) =>
            distanceToPolygon(point, building.footprint) <
            ROCK_CLEARANCE_V3.building
        )
      ) {
        throw new Error(`${batch.id} rock violates building clearance`)
      }
      if (
        manifest.accessJunctions.some((junction) =>
          junction.surfaceGeometryIds.some((geometryId) => {
            const geometry = geometryById.get(geometryId)
            return (
              geometry !== undefined &&
              distanceToMultiPolygon(point, geometrySurface(geometry)) <
                ROCK_CLEARANCE_V3.building
            )
          })
        )
      ) {
        throw new Error(`${batch.id} rock violates access-path clearance`)
      }
      if (
        manifest.bridges.some(
          (bridge) =>
            distanceToPolygon(point, bridge.deckPolygon) <
            ROCK_CLEARANCE_V3.bridge
        )
      ) {
        throw new Error(`${batch.id} rock violates bridge clearance`)
      }
      if (
        manifest.checkpoints.some(
          (checkpoint) =>
            distance(point, [checkpoint.position[0], checkpoint.position[2]]) <
              checkpoint.interactionRadius + ROCK_CLEARANCE_V3.checkpoint ||
            checkpoint.approachGeometryIds.some((geometryId) => {
              const geometry = geometryById.get(geometryId)
              return (
                geometry !== undefined &&
                distanceToMultiPolygon(point, geometrySurface(geometry)) <
                  ROCK_CLEARANCE_V3.checkpoint
              )
            })
        )
      ) {
        throw new Error(`${batch.id} rock violates checkpoint clearance`)
      }
      if (
        manifest.roads.some(
          (road) =>
            distanceToRoad(point, road) <
              road.width / 2 + ROCK_CLEARANCE_V3.road ||
            (road.endTurnaroundRadius !== undefined &&
              distance(point, [
                road.centerline[road.centerline.length - 1][0],
                road.centerline[road.centerline.length - 1][2],
              ]) <
                road.endTurnaroundRadius + ROCK_CLEARANCE_V3.road)
        )
      ) {
        throw new Error(`${batch.id} rock violates road clearance`)
      }
    }
  }

  const nearRockTransforms = manifest.instanceBatches
    .filter((batch) => batch.kind === "rock" && batch.lod === "near")
    .flatMap((batch) => batch.transforms)
  const midRockTransforms = manifest.instanceBatches
    .filter((batch) => batch.kind === "rock" && batch.lod === "mid")
    .flatMap((batch) => batch.transforms)
  const rockScale = (transform: (typeof nearRockTransforms)[number]) =>
    Math.max(transform[4], transform[6])
  const smallRocks = nearRockTransforms.filter(
    (transform) => rockScale(transform) >= 0.55 && rockScale(transform) <= 0.95
  )
  const mediumRocks = nearRockTransforms.filter(
    (transform) => rockScale(transform) >= 1.35 && rockScale(transform) <= 1.85
  )
  const largeRocks = nearRockTransforms.filter(
    (transform) => rockScale(transform) >= 2.45 && rockScale(transform) <= 3.15
  )
  if (
    nearRockTransforms.length < 12 ||
    smallRocks.length === 0 ||
    mediumRocks.length === 0 ||
    largeRocks.length < 3 ||
    smallRocks.length + mediumRocks.length + largeRocks.length !==
      nearRockTransforms.length
  ) {
    throw new Error("Journey V3 lacks distinct small, medium, and large rocks")
  }
  const transformSignature = (transform: (typeof nearRockTransforms)[number]) =>
    transform.join(":")
  const nearRockSignatures = nearRockTransforms.map(transformSignature).sort()
  const midRockSignatures = midRockTransforms.map(transformSignature).sort()
  if (
    nearRockSignatures.length !== midRockSignatures.length ||
    nearRockSignatures.some(
      (signature, index) => signature !== midRockSignatures[index]
    )
  ) {
    throw new Error("Journey V3 rock LOD transforms do not match")
  }
  const rockColliders = manifest.colliders.filter((collider) =>
    collider.id.startsWith("collider.rock.")
  )
  if (
    rockColliders.length !== mediumRocks.length + largeRocks.length ||
    rockColliders.some(
      (collider) =>
        collider.polygon.length !== 8 ||
        collider.maxY <= collider.minY ||
        (!collider.id.includes(".medium.") && !collider.id.includes(".large."))
    )
  ) {
    throw new Error("Journey V3 boulders lack grounded polygon colliders")
  }

  validateReachability(manifest)
  if (
    manifest.checksum &&
    checksumJson({ ...manifest, checksum: "" }) !== manifest.checksum
  ) {
    throw new Error("Journey V3 manifest checksum does not match its payload")
  }
  return manifest
}
