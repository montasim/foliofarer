import { KdTreeSet } from "@thi.ng/geom-accel"
import { samplePoisson } from "@thi.ng/poisson"
import type { MultiPolygon, Polygon } from "polygon-clipping"

import type {
  AuthoredWorldV3,
  CellManifestV3,
  ColliderManifest,
  GeometryDefinitionV3,
  InstanceBatchV3,
  InstanceTransform,
  PortfolioCheckpointManifestV3,
  Vec2,
  VegetationLodV3,
  VegetationSpeciesV3,
} from "../contracts/world.ts"
import { distance, pointInMultiPolygon, round } from "./geometry.ts"
import type { CompiledEnvironmentalBuildingV3 } from "./building-kit.ts"
import type {
  BridgeManifestV3,
  WaterBodyManifestV3,
} from "../contracts/world.ts"
import type { SampledRoad } from "./roads.ts"
import { ROAD_VERGE_WIDTH_V3 } from "./bridges.ts"
import { cellIdAtV3, type TerrainFieldV3 } from "./terrain.ts"
import { createCompilerRandom } from "./noise.ts"
import { createSeededRandom, hashString } from "./random.ts"
import { polygonFromPoints } from "./geometry-v3.ts"

interface VegetationEntry {
  kind: InstanceBatchV3["kind"]
  speciesId: InstanceBatchV3["speciesId"]
  lod: VegetationLodV3
  geometryId: string
  materialId: string
  cellId: string
  transform: InstanceTransform
  densityRank: number
  color: string
}

type RockTier = "small" | "medium" | "large"

const ROCK_TIER_PROFILE = {
  small: {
    major: [0.55, 0.95],
    heightRatio: [0.46, 0.64],
    embed: 0.02,
  },
  medium: {
    major: [1.35, 1.85],
    heightRatio: [0.5, 0.7],
    embed: 0.08,
  },
  large: {
    major: [2.45, 3.15],
    heightRatio: [0.58, 0.8],
    embed: 0.18,
  },
} as const satisfies Record<
  RockTier,
  {
    major: readonly [number, number]
    heightRatio: readonly [number, number]
    embed: number
  }
>

export const ROCK_CLEARANCE_V3 = {
  road: 4,
  water: 3.4,
  building: 3.6,
  bridge: 4.2,
  checkpoint: 3.8,
} as const

export const VEGETATION_TRAVEL_CLEARANCE_V3 = {
  tree: 2.1,
  // The near tuft reaches about 0.36 m from its origin at maximum authored
  // scale. Keep the whole blade cluster beyond the generated road verge.
  grass: ROAD_VERGE_WIDTH_V3 + 0.4,
} as const

function taperedPrism(
  id: string,
  sides: number,
  topScale: number
): GeometryDefinitionV3 {
  const positions: number[] = []
  const indices: number[] = []
  for (let layer = 0; layer < 2; layer += 1) {
    const radius = layer === 0 ? 0.5 : 0.5 * topScale
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2
      positions.push(
        round(Math.cos(angle) * radius, 5),
        layer,
        round(Math.sin(angle) * radius, 5)
      )
    }
  }
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    indices.push(index, sides + next, next, index, sides + index, sides + next)
  }
  return {
    id,
    kind: "primitive",
    materialId: "environment.trunk",
    y: 0,
    positions,
    indices,
  }
}

function appendOctahedron(
  positions: number[],
  indices: number[],
  center: readonly [number, number, number],
  scale: readonly [number, number, number]
) {
  const offset = positions.length / 3
  const vertices = [
    [0, 1, 0],
    [0, -1, 0],
    [-1, 0, 0],
    [1, 0, 0],
    [0, 0, -1],
    [0, 0, 1],
  ]
  for (const vertex of vertices) {
    positions.push(
      center[0] + vertex[0] * scale[0],
      center[1] + vertex[1] * scale[1],
      center[2] + vertex[2] * scale[2]
    )
  }
  for (const triangle of [
    [0, 2, 4],
    [0, 4, 3],
    [0, 3, 5],
    [0, 5, 2],
    [1, 4, 2],
    [1, 3, 4],
    [1, 5, 3],
    [1, 2, 5],
  ]) {
    indices.push(...triangle.map((index) => offset + index))
  }
}

function broadleafCanopy(
  id: string,
  detail: "clustered" | "single"
): GeometryDefinitionV3 {
  const positions: number[] = []
  const indices: number[] = []
  if (detail === "clustered") {
    appendOctahedron(positions, indices, [-0.35, 0, 0], [0.78, 0.72, 0.75])
    appendOctahedron(positions, indices, [0.38, 0.06, 0.04], [0.76, 0.68, 0.74])
    appendOctahedron(positions, indices, [0, 0.38, -0.12], [0.72, 0.68, 0.68])
  } else {
    appendOctahedron(positions, indices, [0, 0, 0], [1, 0.82, 1])
  }
  return {
    id,
    kind: "primitive",
    materialId: "environment.foliage",
    y: 0,
    positions: positions.map((value) => round(value, 5)),
    indices,
  }
}

function palmCanopy(id: string, blades: number): GeometryDefinitionV3 {
  const positions: number[] = []
  const indices: number[] = []
  for (let index = 0; index < blades; index += 1) {
    const angle = (index / blades) * Math.PI * 2
    const side = 0.16
    const direction: Vec2 = [Math.cos(angle), Math.sin(angle)]
    const normal: Vec2 = [-direction[1], direction[0]]
    const offset = positions.length / 3
    positions.push(
      -normal[0] * side,
      0.1,
      -normal[1] * side,
      direction[0] * 1.6,
      -0.22,
      direction[1] * 1.6,
      normal[0] * side,
      0.1,
      normal[1] * side
    )
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset)
  }
  return {
    id,
    kind: "primitive",
    materialId: "environment.foliage",
    y: 0,
    positions: positions.map((value) => round(value, 5)),
    indices,
  }
}

function grassTuft(id: string, blades: number): GeometryDefinitionV3 {
  const positions: number[] = []
  const indices: number[] = []
  for (let index = 0; index < blades; index += 1) {
    const angle = (index / blades) * Math.PI
    const clusterAngle = (index / blades) * Math.PI * 2
    const clusterRadius = 0.1 + (index % 3) * 0.055
    const centerX = Math.cos(clusterAngle) * clusterRadius
    const centerZ = Math.sin(clusterAngle) * clusterRadius
    const width = 0.13
    const height = 0.72 + (index % 3) * 0.08
    const offset = positions.length / 3
    const normal: Vec2 = [Math.cos(angle) * width, Math.sin(angle) * width]
    positions.push(
      centerX - normal[0],
      0,
      centerZ - normal[1],
      centerX + normal[0],
      0,
      centerZ + normal[1],
      centerX,
      height,
      centerZ
    )
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset)
  }
  return {
    id,
    kind: "primitive",
    materialId: "environment.grass",
    y: 0,
    positions: positions.map((value) => round(value, 5)),
    indices,
  }
}

function facetedRock(id: string, sides: number): GeometryDefinitionV3 {
  const positions: number[] = [0, 0, 0]
  const indices: number[] = []
  const lowerStart = positions.length / 3
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2
    const radius = 0.76 + ((index * 7) % 4) * 0.055
    positions.push(
      round(Math.cos(angle) * radius, 5),
      0,
      round(Math.sin(angle) * radius, 5)
    )
  }
  const shoulderStart = positions.length / 3
  for (let index = 0; index < sides; index += 1) {
    const angle = ((index + 0.08) / sides) * Math.PI * 2
    const radius = 0.58 + ((index * 5 + 1) % 3) * 0.07
    positions.push(
      round(Math.cos(angle) * radius, 5),
      round(0.42 + (index % 2) * 0.055, 5),
      round(Math.sin(angle) * radius, 5)
    )
  }
  const apex = positions.length / 3
  positions.push(0.08, 0.88, -0.06)
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    const lower = lowerStart + index
    const lowerNext = lowerStart + next
    const shoulder = shoulderStart + index
    const shoulderNext = shoulderStart + next
    indices.push(
      0,
      lower,
      lowerNext,
      lower,
      shoulderNext,
      lowerNext,
      lower,
      shoulder,
      shoulderNext,
      shoulder,
      apex,
      shoulderNext
    )
  }
  const facePositions: number[] = []
  const faceIndices: number[] = []
  for (const index of indices) {
    faceIndices.push(faceIndices.length)
    facePositions.push(
      positions[index * 3],
      positions[index * 3 + 1],
      positions[index * 3 + 2]
    )
  }
  return {
    id,
    kind: "primitive",
    materialId: "environment.rock",
    y: 0,
    positions: facePositions,
    indices: faceIndices,
  }
}

export function vegetationGeometriesV3(): GeometryDefinitionV3[] {
  return [
    taperedPrism("primitive.tree-trunk.near", 7, 0.7),
    taperedPrism("primitive.tree-trunk.mid", 5, 0.72),
    taperedPrism("primitive.tree-trunk.far", 4, 0.72),
    broadleafCanopy("primitive.broadleaf.near", "clustered"),
    broadleafCanopy("primitive.broadleaf.mid", "single"),
    broadleafCanopy("primitive.broadleaf.far", "single"),
    palmCanopy("primitive.palm.near", 8),
    palmCanopy("primitive.palm.mid", 6),
    palmCanopy("primitive.palm.far", 4),
    broadleafCanopy("primitive.shrub.near", "clustered"),
    broadleafCanopy("primitive.shrub.mid", "single"),
    grassTuft("primitive.grass.near", 8),
    grassTuft("primitive.grass.mid", 4),
    facetedRock("primitive.rock.near", 7),
    facetedRock("primitive.rock.mid", 5),
  ]
}

function inBounds(point: Vec2, world: AuthoredWorldV3) {
  return (
    point[0] >= world.bounds[0] &&
    point[0] <= world.bounds[2] &&
    point[1] >= world.bounds[1] &&
    point[1] <= world.bounds[3]
  )
}

function waterPolygons(waters: readonly WaterBodyManifestV3[]) {
  return waters.map<MultiPolygon>((water) => {
    if (water.polygon.length === 0) return []
    if (typeof water.polygon[0][0] === "number") {
      return [polygonFromPoints(water.polygon as Vec2[])]
    }
    return [
      (water.polygon as Vec2[][]).map((ring) => polygonFromPoints(ring)[0]),
    ]
  })
}

function isProtected(options: {
  point: Vec2
  roads: readonly SampledRoad[]
  waters: readonly MultiPolygon[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  bridges: readonly BridgeManifestV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  exclusions: readonly Polygon[]
  clearance: number
}) {
  for (const road of options.roads) {
    if (
      distanceToSampledRoad(options.point, road) <
      road.source.width / 2 + options.clearance
    )
      return true
    if (
      road.source.endTurnaroundRadius !== undefined &&
      distance(road.points[road.points.length - 1], options.point) <
        road.source.endTurnaroundRadius + options.clearance
    ) {
      return true
    }
  }
  if (
    options.waters.some((multiPolygon) =>
      pointInMultiPolygon(options.point, multiPolygon)
    )
  )
    return true
  if (
    options.buildings.some(
      (building) =>
        pointInMultiPolygon(options.point, [building.footprint]) ||
        distanceToPolygon(options.point, building.accessPolygon) <
          options.clearance
    )
  )
    return true
  if (
    options.bridges.some(
      (bridge) =>
        distanceToPolygon(
          options.point,
          polygonFromPoints(bridge.deckPolygon)
        ) < options.clearance
    )
  )
    return true
  if (
    options.exclusions.some(
      (polygon) => distanceToPolygon(options.point, polygon) < options.clearance
    )
  ) {
    return true
  }
  return options.checkpoints.some(
    (checkpoint) =>
      distance(options.point, [
        checkpoint.position[0],
        checkpoint.position[2],
      ]) <
      checkpoint.interactionRadius + options.clearance
  )
}

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-8) return distance(point, start)
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared
    )
  )
  return distance(point, [start[0] + dx * amount, start[1] + dz * amount])
}

function distanceToPolygon(point: Vec2, polygon: Polygon) {
  if (pointInMultiPolygon(point, [polygon])) return 0
  let nearest = Number.POSITIVE_INFINITY
  for (const ring of polygon) {
    for (let index = 0; index < ring.length; index += 1) {
      nearest = Math.min(
        nearest,
        pointSegmentDistance(
          point,
          [ring[index][0], ring[index][1]],
          [
            ring[(index + 1) % ring.length][0],
            ring[(index + 1) % ring.length][1],
          ]
        )
      )
    }
  }
  return nearest
}

function distanceToMultiPolygon(point: Vec2, multiPolygon: MultiPolygon) {
  if (pointInMultiPolygon(point, multiPolygon)) return 0
  let nearest = Number.POSITIVE_INFINITY
  for (const polygon of multiPolygon) {
    nearest = Math.min(nearest, distanceToPolygon(point, polygon))
  }
  return nearest
}

function distanceToSampledRoad(point: Vec2, road: SampledRoad) {
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < road.points.length - 1; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(point, road.points[index], road.points[index + 1])
    )
  }
  return nearest
}

function isRockProtected(options: {
  point: Vec2
  roads: readonly SampledRoad[]
  waters: readonly MultiPolygon[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  bridges: readonly BridgeManifestV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  exclusions: readonly Polygon[]
}) {
  if (
    options.roads.some(
      (road) =>
        distanceToSampledRoad(options.point, road) <
          road.source.width / 2 + ROCK_CLEARANCE_V3.road ||
        (road.source.endTurnaroundRadius !== undefined &&
          distance(road.points[road.points.length - 1], options.point) <
            road.source.endTurnaroundRadius + ROCK_CLEARANCE_V3.road)
    )
  ) {
    return true
  }
  if (
    options.waters.some(
      (water) =>
        distanceToMultiPolygon(options.point, water) < ROCK_CLEARANCE_V3.water
    )
  ) {
    return true
  }
  if (
    options.buildings.some(
      (building) =>
        distanceToPolygon(options.point, building.footprint) <
          ROCK_CLEARANCE_V3.building ||
        distanceToPolygon(options.point, building.accessPolygon) <
          ROCK_CLEARANCE_V3.building
    )
  ) {
    return true
  }
  if (
    options.bridges.some(
      (bridge) =>
        distanceToPolygon(
          options.point,
          polygonFromPoints(bridge.deckPolygon)
        ) < ROCK_CLEARANCE_V3.bridge
    )
  ) {
    return true
  }
  if (
    options.exclusions.some(
      (polygon) =>
        distanceToPolygon(options.point, polygon) < ROCK_CLEARANCE_V3.building
    )
  ) {
    return true
  }
  return options.checkpoints.some(
    (checkpoint) =>
      distance(options.point, [
        checkpoint.position[0],
        checkpoint.position[2],
      ]) <
      checkpoint.interactionRadius + ROCK_CLEARANCE_V3.checkpoint
  )
}

function poissonPoints(
  world: AuthoredWorldV3,
  channel: string,
  density: number | ((point: Vec2) => number),
  maximum: number
) {
  const random = createCompilerRandom(world.seed ^ hashString(channel))
  return samplePoisson({
    index: new KdTreeSet(2),
    points: (rnd) => [
      world.bounds[0] + rnd.float(world.bounds[2] - world.bounds[0]),
      world.bounds[1] + rnd.float(world.bounds[3] - world.bounds[1]),
    ],
    density:
      typeof density === "number"
        ? density
        : (point) => density([point[0], point[1]]),
    max: maximum,
    quality: 1_200,
    iter: 1,
    jitter: (typeof density === "number" ? density : 1.5) * 0.35,
    rnd: random,
  })
    .map(([x, z]) => [round(x), round(z)] as Vec2)
    .filter((point) => inBounds(point, world))
}

function biomeAt(point: Vec2, world: AuthoredWorldV3) {
  for (let index = world.biomes.length - 1; index >= 0; index -= 1) {
    const biome = world.biomes[index]
    if (pointInMultiPolygon(point, [polygonFromPoints(biome.polygon)])) {
      return biome
    }
  }
  return undefined
}

function groupEntries(entries: VegetationEntry[]) {
  const groups = new Map<string, VegetationEntry[]>()
  for (const entry of entries) {
    const key = [
      entry.cellId,
      entry.kind,
      entry.speciesId,
      entry.lod,
      entry.geometryId,
    ].join(":")
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map<InstanceBatchV3>(([key, group]) => {
      const sorted = group.sort(
        (a, b) =>
          a.densityRank - b.densityRank ||
          a.transform[2] - b.transform[2] ||
          a.transform[0] - b.transform[0]
      )
      const first = sorted[0]
      return {
        id: `batch.${key}`,
        kind: first.kind,
        speciesId: first.speciesId,
        lod: first.lod,
        geometryId: first.geometryId,
        materialId: first.materialId,
        cellId: first.cellId,
        transforms: sorted.map((entry) => entry.transform),
        densityRanks: sorted.map((entry) => entry.densityRank),
        colors: sorted.map((entry) => entry.color),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function treeColor(random: () => number) {
  return ["#2c8365", "#26735d", "#3d906c", "#1f6b58"][Math.floor(random() * 4)]
}

function rockTierAssignments(points: readonly Vec2[], seed: number) {
  const random = createSeededRandom(seed ^ hashString("v3-rock-size-classes"))
  const ranked = points
    .map((point) => ({
      key: `${point[0]}:${point[1]}`,
      rank: random(),
    }))
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))
  const smallEnd = Math.ceil(ranked.length * 0.45)
  const mediumEnd = Math.ceil(ranked.length * 0.8)
  return new Map(
    ranked.map(({ key }, index) => [
      key,
      index < smallEnd
        ? ("small" as const)
        : index < mediumEnd
          ? ("medium" as const)
          : ("large" as const),
    ])
  )
}

function groundedRockHeight(
  field: TerrainFieldV3,
  point: Vec2,
  major: number,
  embed: number
) {
  const probe = major * 0.55
  return (
    Math.min(
      field.heightAt(point),
      field.heightAt([point[0] + probe, point[1]]),
      field.heightAt([point[0] - probe, point[1]]),
      field.heightAt([point[0], point[1] + probe]),
      field.heightAt([point[0], point[1] - probe])
    ) - embed
  )
}

function rockColliderPolygon(
  point: Vec2,
  rotation: number,
  scaleX: number,
  scaleZ: number
) {
  const polygon: Vec2[] = []
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    const localX = Math.cos(angle) * scaleX * 0.7
    const localZ = Math.sin(angle) * scaleZ * 0.7
    polygon.push([
      round(point[0] + localX * cosine - localZ * sine),
      round(point[1] + localX * sine + localZ * cosine),
    ])
  }
  return polygon
}

export function compileVegetation(options: {
  world: AuthoredWorldV3
  cells: CellManifestV3[]
  roads: readonly SampledRoad[]
  waters: readonly WaterBodyManifestV3[]
  bridges: readonly BridgeManifestV3[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  field: TerrainFieldV3
  exclusionPolygons?: readonly Vec2[][]
}) {
  const entries: VegetationEntry[] = []
  const colliders: ColliderManifest[] = []
  const waterShapes = waterPolygons(options.waters)
  const exclusionPolygons = (options.exclusionPolygons ?? []).map((polygon) =>
    polygonFromPoints(polygon)
  )
  const worldArea =
    (options.world.bounds[2] - options.world.bounds[0]) *
    (options.world.bounds[3] - options.world.bounds[1])
  const densityScale = Math.max(1, worldArea / 6_400)
  const treeRandom = createSeededRandom(
    options.world.seed ^ hashString("v3-tree-attributes")
  )
  const treePoints = poissonPoints(
    options.world,
    "v3-trees",
    (point) => 8 - (biomeAt(point, options.world)?.treeDensity ?? 0.4) * 3,
    Math.ceil(92 * densityScale)
  ).filter(
    (point) =>
      !isProtected({
        point,
        roads: options.roads,
        waters: waterShapes,
        buildings: options.buildings,
        bridges: options.bridges,
        checkpoints: options.checkpoints,
        exclusions: exclusionPolygons,
        clearance: VEGETATION_TRAVEL_CLEARANCE_V3.tree,
      })
  )

  for (const point of treePoints) {
    const coastal = biomeAt(point, options.world)?.kind === "coast"
    const species: VegetationSpeciesV3 =
      coastal && treeRandom() < 0.62 ? "palm" : "broadleaf"
    const height =
      species === "palm" ? 5.4 + treeRandom() * 2.2 : 3.8 + treeRandom() * 2
    const radius = species === "palm" ? 1.2 : 1.5 + treeRandom() * 0.65
    const rotation = treeRandom() * Math.PI * 2
    const densityRank = round(treeRandom(), 5)
    const y = options.field.heightAt(point)
    const cellId = cellIdAtV3(point, options.world)
    for (const lod of ["near", "mid", "far"] as const) {
      const factor = lod === "near" ? 1 : lod === "mid" ? 0.92 : 0.78
      entries.push({
        kind: "tree-trunk",
        speciesId: species,
        lod,
        geometryId: `primitive.tree-trunk.${lod}`,
        materialId: "environment.trunk",
        cellId,
        transform: [
          point[0],
          y,
          point[1],
          round(rotation),
          round(radius * 0.3 * factor),
          round(height * factor),
          round(radius * 0.3 * factor),
        ],
        densityRank,
        color: ["#76543b", "#684834", "#805d43"][Math.floor(treeRandom() * 3)],
      })
      entries.push({
        kind: "tree-canopy",
        speciesId: species,
        lod,
        geometryId: `primitive.${species}.${lod}`,
        materialId: "environment.foliage",
        cellId,
        transform: [
          point[0],
          round(y + height * factor),
          point[1],
          round(rotation),
          round(radius * factor),
          round(radius * (species === "palm" ? 0.72 : 1) * factor),
          round(radius * factor),
        ],
        densityRank,
        color: treeColor(treeRandom),
      })
    }
  }

  const grassRandom = createSeededRandom(
    options.world.seed ^ hashString("v3-grass-attributes")
  )
  const grassPoints = poissonPoints(
    options.world,
    "v3-grass",
    (point) =>
      1.7 - (biomeAt(point, options.world)?.grassDensity ?? 0.5) * 0.55,
    Math.ceil(760 * densityScale)
  ).filter(
    (point) =>
      !isProtected({
        point,
        roads: options.roads,
        waters: waterShapes,
        buildings: options.buildings,
        bridges: options.bridges,
        checkpoints: options.checkpoints,
        exclusions: exclusionPolygons,
        clearance: VEGETATION_TRAVEL_CLEARANCE_V3.grass,
      })
  )
  for (const point of grassPoints) {
    const y = options.field.heightAt(point)
    const cellId = cellIdAtV3(point, options.world)
    const rotation = grassRandom() * Math.PI * 2
    const scale = 0.55 + grassRandom() * 0.65
    const densityRank = round(grassRandom(), 5)
    const species: VegetationSpeciesV3 =
      biomeAt(point, options.world)?.kind === "riparian"
        ? "river-grass"
        : "meadow-grass"
    for (const lod of ["near", "mid"] as const) {
      const factor = lod === "near" ? 1 : 0.78
      entries.push({
        kind: "grass",
        speciesId: species,
        lod,
        geometryId: `primitive.grass.${lod}`,
        materialId: "environment.grass",
        cellId,
        transform: [
          point[0],
          y,
          point[1],
          round(rotation),
          round(scale * factor),
          round(scale * factor),
          round(scale * factor),
        ],
        densityRank,
        color: ["#76ab88", "#639873", "#82b893"][Math.floor(grassRandom() * 3)],
      })
    }
  }

  const rockRandom = createSeededRandom(
    options.world.seed ^ hashString("v3-rock-attributes")
  )
  const rockPoints = poissonPoints(
    options.world,
    "v3-rocks",
    11.5,
    Math.ceil(6 * densityScale)
  ).filter(
    (point) =>
      !isRockProtected({
        point,
        roads: options.roads,
        waters: waterShapes,
        buildings: options.buildings,
        bridges: options.bridges,
        checkpoints: options.checkpoints,
        exclusions: exclusionPolygons,
      })
  )
  const rockTiers = rockTierAssignments(rockPoints, options.world.seed)
  const rockExclusions: { point: Vec2; radius: number }[] = []
  for (let rockIndex = 0; rockIndex < rockPoints.length; rockIndex += 1) {
    const point = rockPoints[rockIndex]
    const tier = rockTiers.get(`${point[0]}:${point[1]}`) ?? ("small" as const)
    const profile = ROCK_TIER_PROFILE[tier]
    const cellId = cellIdAtV3(point, options.world)
    const rotation = rockRandom() * Math.PI * 2
    const major =
      profile.major[0] + rockRandom() * (profile.major[1] - profile.major[0])
    const minor = major * (0.7 + rockRandom() * 0.25)
    const swapAxes = rockRandom() < 0.5
    const scaleX = swapAxes ? minor : major
    const scaleZ = swapAxes ? major : minor
    const scaleY =
      major *
      (profile.heightRatio[0] +
        rockRandom() * (profile.heightRatio[1] - profile.heightRatio[0]))
    const y = groundedRockHeight(options.field, point, major, profile.embed)
    rockExclusions.push({
      point,
      radius: major * 0.92,
    })
    const densityRank = round(
      tier === "large"
        ? rockRandom() * 0.24
        : tier === "medium"
          ? 0.18 + rockRandom() * 0.42
          : 0.5 + rockRandom() * 0.5,
      5
    )
    const palette =
      tier === "large"
        ? ["#746f63", "#817967", "#69675f"]
        : tier === "medium"
          ? ["#857e6d", "#948a76", "#7c7669"]
          : ["#948a76", "#a39882", "#898273"]
    const color = palette[Math.floor(rockRandom() * palette.length)]
    for (const lod of ["near", "mid"] as const) {
      entries.push({
        kind: "rock",
        speciesId: "rock",
        lod,
        geometryId: `primitive.rock.${lod}`,
        materialId: "environment.rock",
        cellId,
        transform: [
          point[0],
          y,
          point[1],
          round(rotation),
          round(scaleX),
          round(scaleY),
          round(scaleZ),
        ],
        densityRank,
        color,
      })
    }
    if (tier !== "small") {
      const collider: ColliderManifest = {
        id: `collider.rock.${tier}.${rockIndex}`,
        kind: "polygon",
        cellId,
        polygon: rockColliderPolygon(point, rotation, scaleX, scaleZ),
        minY: round(y),
        maxY: round(y + scaleY * 0.88),
      }
      colliders.push(collider)
      options.cells
        .find((cell) => cell.id === cellId)
        ?.colliderIds.push(collider.id)
    }
  }

  const unclippedEntries = entries.filter((entry) => {
    if (
      entry.kind !== "tree-trunk" &&
      entry.kind !== "tree-canopy" &&
      entry.kind !== "grass" &&
      entry.kind !== "shrub"
    ) {
      return true
    }
    const point: Vec2 = [entry.transform[0], entry.transform[2]]
    const vegetationMargin =
      entry.kind === "grass" ? 0.22 : entry.kind === "shrub" ? 0.65 : 0.8
    return rockExclusions.every(
      (rock) => distance(point, rock.point) >= rock.radius + vegetationMargin
    )
  })
  const batches = groupEntries(unclippedEntries)
  for (const batch of batches) {
    options.cells
      .find((cell) => cell.id === batch.cellId)
      ?.batchIds.push(batch.id)
  }
  return {
    batches,
    colliders,
    counts: {
      trees: unclippedEntries.filter(
        (entry) => entry.kind === "tree-trunk" && entry.lod === "near"
      ).length,
      grass: unclippedEntries.filter(
        (entry) => entry.kind === "grass" && entry.lod === "near"
      ).length,
      rocks: rockPoints.length,
    },
  }
}

export function instancePoint(transform: InstanceTransform): Vec2 {
  return [transform[0], transform[2]]
}
