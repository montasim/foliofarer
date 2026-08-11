import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import { JOURNEY_V2_WORLD } from "../authored/world.ts"
import type {
  AuthoredWorld,
  Bounds2,
  CellManifest,
  DistrictManifest,
  GeometryDefinition,
  MaterialDefinition,
  RoadManifest,
  Vec2,
  WorldManifest,
} from "../contracts/world.ts"
import {
  boundsOfPoints,
  expandBounds,
  multiPolygonArea,
  round,
  stripSegmentPolygon,
  triangulateMultiPolygon,
} from "./geometry.ts"
import { compileNavigation } from "./navigation.ts"
import {
  buildingBounds,
  compileBuildings,
  createBuildingGeometry,
  landmarkBuildings,
  landmarkSkeleton,
  toBuildingCollider,
  toBuildingManifest,
} from "./placement.ts"
import {
  clipMultiPolygon,
  createCrosswalkPolygon,
  createRoadSurfaces,
  sampleRoad,
  type SampledRoad,
} from "./roads.ts"
import {
  compileScenery,
  sceneryGeometries,
  sceneryMaterials,
  type CompiledCrosswalk,
} from "./scenery.ts"
import {
  cellIdAt,
  cellsIntersectingBounds,
  createCellSkeletons,
} from "./spatial.ts"

export {
  compileJourneyWorldV3,
  JOURNEY_V3_GENERATOR_VERSION,
} from "./compiler-v3.ts"
export { validateWorldManifestV3 } from "./validation-v3.ts"

const { union } = polygonClipping

const GENERATOR_VERSION = "2.0.0"

const BASE_MATERIALS: MaterialDefinition[] = [
  {
    id: "surface.road",
    kind: "standard",
    color: "#5f7462",
    roughness: 0.93,
  },
  {
    id: "surface.curb",
    kind: "standard",
    color: "#cfd3c1",
    roughness: 0.95,
  },
  {
    id: "surface.sidewalk",
    kind: "standard",
    color: "#e7e1cc",
    roughness: 0.96,
  },
  {
    id: "surface.access",
    kind: "standard",
    color: "#d4cfbb",
    roughness: 0.94,
  },
  {
    id: "surface.journey-line",
    kind: "unlit",
    color: "#c45f3f",
    roughness: 0.7,
  },
]

const BUILDING_COLORS: Record<string, string> = {
  civic: "#d4cfb8",
  school: "#d8d3bd",
  college: "#d3c9ae",
  campus: "#c9cbb7",
  office: "#b8c5b3",
  library: "#c7c9ae",
  workshop: "#c9b48c",
  community: "#d2c7ac",
  pavilion: "#c5bda6",
  residential: "#d7cfb8",
}

function buildingMaterial(style: string): MaterialDefinition {
  return {
    id: `building.${style}`,
    kind: "standard",
    color: BUILDING_COLORS[style] ?? "#d4cfb8",
    roughness: 0.88,
  }
}

function polygonFromBounds(bounds: Bounds2): Polygon {
  return [
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[1]],
      [bounds[2], bounds[3]],
      [bounds[0], bounds[3]],
      [bounds[0], bounds[1]],
    ],
  ]
}

function surfaceBounds(surface: MultiPolygon) {
  return boundsOfPoints(
    surface.flatMap((polygon) =>
      polygon.flatMap((ring) => ring.map(([x, z]) => [x, z] as Vec2))
    )
  )
}

function clipSurfaceIntoCells(options: {
  surface: MultiPolygon
  prefix: string
  materialId: string
  y: number
  cells: CellManifest[]
  geometries: GeometryDefinition[]
}) {
  const ids: string[] = []
  if (options.surface.length === 0) return ids
  const bounds = surfaceBounds(options.surface)
  for (const cell of cellsIntersectingBounds(options.cells, bounds)) {
    const clipped = clipMultiPolygon(
      options.surface,
      polygonFromBounds(cell.bounds)
    )
    if (multiPolygonArea(clipped) < 0.001) continue
    const id = `${options.prefix}.${cell.id}`
    const geometry = triangulateMultiPolygon(
      id,
      "surface",
      options.materialId,
      options.y,
      clipped
    )
    if (geometry.indices.length === 0) continue
    options.geometries.push(geometry)
    cell.geometryIds.push(id)
    ids.push(id)
  }
  return ids
}

function journeyLineSurface(roads: readonly SampledRoad[]) {
  const parts: Polygon[] = []
  const points: Vec2[] = []
  for (const road of roads.filter((road) => road.source.journeyLine)) {
    for (let index = 0; index < road.points.length; index += 1) {
      const point = road.points[index]
      if (
        points.length === 0 ||
        points[points.length - 1][0] !== point[0] ||
        points[points.length - 1][1] !== point[1]
      ) {
        points.push(point)
      }
      if (index < road.points.length - 1) {
        parts.push(stripSegmentPolygon(point, road.points[index + 1], 0.075))
      }
    }
  }
  return {
    points: points.map(([x, z]) => [round(x), round(z)] as Vec2),
    surface: parts.length > 0 ? union(parts[0], ...parts.slice(1)) : [],
  }
}

function districtManifests(
  world: AuthoredWorld,
  cells: readonly CellManifest[],
  buildings: ReturnType<typeof compileBuildings>
) {
  return world.districts.map<DistrictManifest>((district) => {
    const landmarkIds = world.landmarks
      .filter((landmark) => landmark.districtId === district.id)
      .map((landmark) => landmark.id)
    const districtCells = new Set(
      cells
        .filter((cell) => cell.districtId === district.id)
        .map((cell) => cell.id)
    )
    for (const building of buildings) {
      if (building.districtId === district.id) {
        districtCells.add(cellIdAt(building.center, world.cellSize))
      }
    }
    const resolvedCells = [...districtCells]
      .map((id) => cells.find((cell) => cell.id === id))
      .filter((cell): cell is CellManifest => Boolean(cell))
    const bounds: Bounds2 =
      resolvedCells.length > 0
        ? [
            Math.min(...resolvedCells.map((cell) => cell.bounds[0])),
            Math.min(...resolvedCells.map((cell) => cell.bounds[1])),
            Math.max(...resolvedCells.map((cell) => cell.bounds[2])),
            Math.max(...resolvedCells.map((cell) => cell.bounds[3])),
          ]
        : [0, 0, 0, 0]
    return {
      id: district.id,
      kind: district.kind,
      order: district.order,
      bounds,
      cellIds: [...districtCells].sort(),
      landmarkIds,
    }
  })
}

function createRoadManifests(
  roads: readonly SampledRoad[],
  cells: readonly CellManifest[],
  roadGeometryIds: readonly string[]
) {
  const geometrySet = new Set(roadGeometryIds)
  return roads.map<RoadManifest>((road) => {
    const roadBounds = expandBounds(
      boundsOfPoints(road.points),
      road.source.width / 2 + 0.5
    )
    const surfaceGeometryIds = cellsIntersectingBounds(cells, roadBounds)
      .map((cell) => `surface.road.${cell.id}`)
      .filter((id) => geometrySet.has(id))
    return {
      id: road.source.id,
      from: road.source.from,
      to: road.source.to,
      width: road.source.width,
      centerline: road.points.map(([x, z]) => [round(x), round(z)] as Vec2),
      surfaceGeometryIds,
    }
  })
}

function assertUniqueIds(label: string, ids: readonly string[]) {
  const unique = new Set(ids)
  if (unique.size !== ids.length) {
    throw new Error(`${label} contains duplicate ids`)
  }
}

function validateGraph(manifest: WorldManifest) {
  const adjacency = new Map<string, string[]>()
  for (const node of manifest.navigation.nodes) adjacency.set(node.id, [])
  for (const edge of manifest.navigation.edges) {
    adjacency.get(edge.a)?.push(edge.b)
    adjacency.get(edge.b)?.push(edge.a)
    if (edge.kind === "crossing" && !edge.crosswalkId) {
      throw new Error(`Crossing edge ${edge.a} -> ${edge.b} has no crosswalk`)
    }
  }
  const start = manifest.navigation.nodes[0]?.id
  if (!start) throw new Error("Navigation graph is empty")
  const visited = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const neighbour of adjacency.get(current) ?? []) {
      if (visited.has(neighbour)) continue
      visited.add(neighbour)
      queue.push(neighbour)
    }
  }
  for (const landmark of manifest.landmarks) {
    if (!visited.has(landmark.navNodeId)) {
      throw new Error(`${landmark.id} is disconnected from the sidewalk graph`)
    }
  }
}

export function validateWorldManifest(manifest: WorldManifest) {
  if (manifest.schemaVersion !== 2) throw new Error("Unexpected schema version")
  if (manifest.landmarks.length !== 12) {
    throw new Error(`Expected 12 landmarks, found ${manifest.landmarks.length}`)
  }
  const routeOrders = manifest.landmarks
    .map((landmark) => landmark.routeOrder)
    .sort((a, b) => a - b)
  if (routeOrders.some((order, index) => order !== index)) {
    throw new Error("Landmark route order must be contiguous from 0 through 11")
  }
  assertUniqueIds(
    "landmarks",
    manifest.landmarks.map((item) => item.id)
  )
  assertUniqueIds(
    "geometries",
    manifest.geometries.map((item) => item.id)
  )
  assertUniqueIds(
    "instance batches",
    manifest.instanceBatches.map((item) => item.id)
  )
  assertUniqueIds(
    "colliders",
    manifest.colliders.map((item) => item.id)
  )
  const geometryIds = new Set(manifest.geometries.map((item) => item.id))
  for (const batch of manifest.instanceBatches) {
    if (!geometryIds.has(batch.geometryId)) {
      throw new Error(
        `${batch.id} references missing geometry ${batch.geometryId}`
      )
    }
  }
  for (const cell of manifest.cells) {
    for (const geometryId of cell.geometryIds) {
      if (!geometryIds.has(geometryId)) {
        throw new Error(`${cell.id} references missing geometry ${geometryId}`)
      }
    }
  }
  validateGraph(manifest)
  return manifest
}

export function compileJourneyWorld(
  world: AuthoredWorld = JOURNEY_V2_WORLD
): WorldManifest {
  const sampledRoads = world.roads.map((road) =>
    sampleRoad(road, world.roadSampleSpacing)
  )
  const roadMap = new Map(sampledRoads.map((road) => [road.source.id, road]))
  const surfaces = createRoadSurfaces(
    sampledRoads,
    world.curbWidth,
    world.sidewalkWidth
  )
  const compiledBuildings = compileBuildings(
    world,
    roadMap,
    surfaces.outer,
    surfaces.road
  )
  const accessSurface = union(
    compiledBuildings[0].accessPolygon,
    ...compiledBuildings.slice(1).map((building) => building.accessPolygon)
  )
  const crosswalks: CompiledCrosswalk[] = world.crosswalks.map((source) => {
    const road = roadMap.get(source.roadId)
    if (!road)
      throw new Error(`${source.id} references missing road ${source.roadId}`)
    const result = createCrosswalkPolygon(
      source,
      road,
      world.curbWidth,
      world.sidewalkWidth
    )
    return {
      id: source.id,
      roadId: source.roadId,
      polygon: result.polygon,
      center: result.frame.center,
      tangent: result.frame.tangent,
      normal: result.frame.normal,
      rotationY: result.rotationY,
      width: source.width,
    }
  })
  const navigation = compileNavigation({
    sidewalk: surfaces.sidewalk,
    accessPolygons: compiledBuildings.map((building) => building.accessPolygon),
    crosswalks,
    buildings: compiledBuildings,
    cellSize: world.cellSize,
  })
  const roadBounds = surfaceBounds(surfaces.outer)
  const structuresBounds = buildingBounds(compiledBuildings)
  const combinedBounds = expandBounds(
    boundsOfPoints([
      [roadBounds[0], roadBounds[1]],
      [roadBounds[2], roadBounds[3]],
      [structuresBounds[0], structuresBounds[1]],
      [structuresBounds[2], structuresBounds[3]],
    ]),
    14
  )
  const cells = createCellSkeletons(
    combinedBounds,
    world.cellSize,
    sampledRoads
  )
  const geometries: GeometryDefinition[] = []

  const roadGeometryIds = clipSurfaceIntoCells({
    surface: surfaces.road,
    prefix: "surface.road",
    materialId: "surface.road",
    y: 0,
    cells,
    geometries,
  })
  const curbGeometryIds = clipSurfaceIntoCells({
    surface: surfaces.curb,
    prefix: "surface.curb",
    materialId: "surface.curb",
    y: 0.025,
    cells,
    geometries,
  })
  const sidewalkGeometryIds = clipSurfaceIntoCells({
    surface: surfaces.sidewalk,
    prefix: "surface.sidewalk",
    materialId: "surface.sidewalk",
    y: 0.05,
    cells,
    geometries,
  })
  const accessGeometryIds = clipSurfaceIntoCells({
    surface: accessSurface,
    prefix: "surface.access",
    materialId: "surface.access",
    y: 0.052,
    cells,
    geometries,
  })
  const line = journeyLineSurface(sampledRoads)
  const journeyLineGeometryIds = clipSurfaceIntoCells({
    surface: line.surface,
    prefix: "surface.journey-line",
    materialId: "surface.journey-line",
    y: 0.032,
    cells,
    geometries,
  })

  const buildingMaterials = [
    ...new Set(compiledBuildings.map((building) => building.style)),
  ].map(buildingMaterial)
  for (const building of compiledBuildings) {
    const materialId = `building.${building.style}`
    const geometry = createBuildingGeometry(building, materialId)
    geometries.push(geometry)
    const cell = cells.find(
      (candidate) => candidate.id === cellIdAt(building.center, world.cellSize)
    )
    if (!cell) throw new Error(`No cell contains building ${building.id}`)
    cell.geometryIds.push(geometry.id)
  }
  geometries.push(...sceneryGeometries())

  const scenery = compileScenery({
    seed: world.seed,
    bounds: combinedBounds,
    cellSize: world.cellSize,
    roads: sampledRoads,
    streetOuter: surfaces.outer,
    curbWidth: world.curbWidth,
    sidewalkWidth: world.sidewalkWidth,
    buildings: compiledBuildings,
    crosswalks,
  })
  for (const batch of scenery.batches) {
    const cell = cells.find((candidate) => candidate.id === batch.cellId)
    cell?.batchIds.push(batch.id)
  }

  const colliders = compiledBuildings.map((building) =>
    toBuildingCollider(building, cellIdAt(building.center, world.cellSize))
  )
  for (const collider of colliders) {
    cells
      .find((candidate) => candidate.id === collider.cellId)
      ?.colliderIds.push(collider.id)
  }
  const buildings = compiledBuildings.map((building) =>
    toBuildingManifest(
      building,
      cellIdAt(building.center, world.cellSize),
      `building.${building.style}`
    )
  )
  const landmarks = landmarkBuildings(compiledBuildings).map((building) =>
    landmarkSkeleton(building, navigation.landmarkNodeIds[building.landmark.id])
  )
  const roadManifests = createRoadManifests(
    sampledRoads,
    cells,
    roadGeometryIds
  )
  const crosswalkManifests = crosswalks.map((crosswalk) => ({
    id: crosswalk.id,
    roadId: crosswalk.roadId,
    polygon: crosswalk.polygon[0]
      .slice(0, -1)
      .map(([x, z]) => [round(x), round(z)] as Vec2),
    center: [round(crosswalk.center[0]), round(crosswalk.center[1])] as Vec2,
    rotationY: round(crosswalk.rotationY),
    width: crosswalk.width,
    nodeIds: navigation.crosswalkNodeIds[crosswalk.id],
  }))

  const manifest: WorldManifest = {
    schemaVersion: 2,
    generatorVersion: GENERATOR_VERSION,
    seed: world.seed,
    units: "metres",
    world: {
      bounds: combinedBounds,
      cellSize: world.cellSize,
      spawn: [0, 0.08, 16],
    },
    materials: [...BASE_MATERIALS, ...buildingMaterials, ...sceneryMaterials()],
    geometries,
    districts: districtManifests(world, cells, compiledBuildings),
    cells,
    roads: roadManifests,
    features: {
      curbGeometryIds,
      sidewalkGeometryIds,
      accessGeometryIds,
      journeyLine: {
        geometryIds: journeyLineGeometryIds,
        points: line.points,
      },
      laneMarkers: scenery.batches.filter(
        (batch) => batch.kind === "lane-marker"
      ),
      crosswalks: crosswalkManifests,
    },
    landmarks,
    buildings,
    instanceBatches: scenery.batches,
    colliders,
    navigation: {
      nodes: navigation.nodes,
      edges: navigation.edges,
      landmarkNodeIds: navigation.landmarkNodeIds,
    },
    validation: {
      valid: true,
      counts: {
        roads: roadManifests.length,
        roadTriangles: geometries
          .filter((geometry) => geometry.id.startsWith("surface.road."))
          .reduce((sum, geometry) => sum + geometry.indices.length / 3, 0),
        landmarks: landmarks.length,
        cells: cells.length,
        buildings: buildings.length,
        environmentalHouses: buildings.filter(
          (building) => building.landmarkId === null
        ).length,
        colliders: colliders.length,
        navigationNodes: navigation.nodes.length,
        navigationEdges: navigation.edges.length,
        instanceBatches: scenery.batches.length,
        instances: scenery.batches.reduce(
          (sum, batch) => sum + batch.transforms.length,
          0
        ),
        trees: scenery.treeFootprints.length,
        grassClumps: scenery.batches
          .filter((batch) => batch.kind === "grass")
          .reduce((sum, batch) => sum + batch.transforms.length, 0),
        lamps: scenery.batches
          .filter((batch) => batch.kind === "lamp")
          .reduce((sum, batch) => sum + batch.transforms.length, 0),
        laneMarkers: scenery.batches
          .filter((batch) => batch.kind === "lane-marker")
          .reduce((sum, batch) => sum + batch.transforms.length, 0),
        crosswalkStripes: scenery.batches
          .filter((batch) => batch.kind === "crosswalk-stripe")
          .reduce((sum, batch) => sum + batch.transforms.length, 0),
      },
      warnings: [],
    },
  }

  return validateWorldManifest(manifest)
}
