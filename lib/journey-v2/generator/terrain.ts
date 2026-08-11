import polygonClipping, { type MultiPolygon } from "polygon-clipping"

import type {
  AuthoredWorldV3,
  Bounds2,
  CellManifestV3,
  GeometryDefinitionV3,
  TerrainTileManifestV3,
  Vec2,
} from "../contracts/world.ts"
import { distance, round } from "./geometry.ts"
import { triangulateMultiPolygonV3 } from "./geometry-v3.ts"
import type { CompiledWaterShapeV3 } from "./hydrology.ts"
import { pointTouchesWater } from "./hydrology.ts"
import { createWorldNoise } from "./noise.ts"
import type { SampledRoad } from "./roads.ts"
import { checksumJson } from "./checksum.ts"

interface RoadHeightSegment {
  start: Vec2
  end: Vec2
  startHeight: number
  endHeight: number
  flatRadius: number
  influence: number
}

interface BuildingPadSample {
  center: Vec2
  tangent: Vec2
  outward: Vec2
  halfWidth: number
  halfDepth: number
  height: number
}

const INLAND_WATERBED_DEPTH = 0.68
const ROAD_RELIEF_BUFFER = 5.4
const ROAD_SURFACE_FLAT_MARGIN_SAMPLES = 1.15
const BUILDING_PAD_TRANSITION = 3.2
const { difference } = polygonClipping

export const TRAVEL_SURFACE_CLEARANCE_V3 = 0.055
export const TRAVEL_CENTERLINE_CLEARANCE_V3 =
  TRAVEL_SURFACE_CLEARANCE_V3 + 0.005
export const ACCESS_SURFACE_CLEARANCE_V3 = TRAVEL_SURFACE_CLEARANCE_V3 + 0.007
export const ROAD_MARKING_CLEARANCE_V3 = TRAVEL_SURFACE_CLEARANCE_V3 + 0.03

export interface TerrainFieldV3 {
  heightAt(point: Vec2): number
  landHeightAt?(point: Vec2): number
  colorAt(point: Vec2): readonly [number, number, number]
}

/**
 * Samples the same diagonal split emitted by createTerrainGeometry. This is
 * the authoritative rendered ground height for roads, access paths, props and
 * navigation; bilinear sampling would describe a different surface.
 */
export function renderedTerrainHeightAt(
  point: Vec2,
  tiles: readonly TerrainTileManifestV3[]
) {
  const tile = tiles.find(
    (candidate) =>
      point[0] >= candidate.bounds[0] - 1e-6 &&
      point[0] <= candidate.bounds[2] + 1e-6 &&
      point[1] >= candidate.bounds[1] - 1e-6 &&
      point[1] <= candidate.bounds[3] + 1e-6
  )
  if (!tile) {
    throw new Error(`No rendered terrain tile contains ${point.join(",")}`)
  }
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
  const x0 = Math.min(tile.resolution[0] - 2, Math.floor(localX))
  const z0 = Math.min(tile.resolution[1] - 2, Math.floor(localZ))
  const tx = localX - x0
  const tz = localZ - z0
  const columns = tile.resolution[0]
  const a = tile.heights[z0 * columns + x0]
  const b = tile.heights[z0 * columns + x0 + 1]
  const c = tile.heights[(z0 + 1) * columns + x0]
  const d = tile.heights[(z0 + 1) * columns + x0 + 1]
  if (tx + tz <= 1) {
    return a + (b - a) * tx + (c - a) * tz
  }
  return b * (1 - tz) + c * (1 - tx) + d * Math.max(0, tx + tz - 1)
}

export function createRenderedTerrainField(
  source: TerrainFieldV3,
  tiles: readonly TerrainTileManifestV3[]
): TerrainFieldV3 {
  const bounds: Bounds2 = [
    Math.min(...tiles.map((tile) => tile.bounds[0])),
    Math.min(...tiles.map((tile) => tile.bounds[1])),
    Math.max(...tiles.map((tile) => tile.bounds[2])),
    Math.max(...tiles.map((tile) => tile.bounds[3])),
  ]
  return {
    heightAt: (point) =>
      renderedTerrainHeightAt(
        [
          Math.max(bounds[0], Math.min(bounds[2], point[0])),
          Math.max(bounds[1], Math.min(bounds[3], point[1])),
        ],
        tiles
      ),
    landHeightAt: source.landHeightAt,
    colorAt: source.colorAt,
  }
}

/**
 * Infrastructure follows the higher of the smooth land grade and the rendered
 * terrain plane. The land envelope keeps roads and bridge approaches from
 * dipping into an incised waterbed, while the rendered envelope prevents the
 * coarse terrain mesh from piercing paths between grid samples.
 */
export function createTravelSurfaceField(
  analytic: TerrainFieldV3,
  rendered: TerrainFieldV3
): TerrainFieldV3 {
  const landHeightAt = (point: Vec2) =>
    Math.max(
      rendered.heightAt(point),
      analytic.landHeightAt?.(point) ?? analytic.heightAt(point)
    )
  return {
    heightAt: landHeightAt,
    landHeightAt,
    colorAt: analytic.colorAt,
  }
}

function sampleRoadHeight(segment: RoadHeightSegment, point: Vec2) {
  const dx = segment.end[0] - segment.start[0]
  const dz = segment.end[1] - segment.start[1]
  const lengthSquared = dx * dx + dz * dz
  const progress =
    lengthSquared <= 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - segment.start[0]) * dx +
              (point[1] - segment.start[1]) * dz) /
              lengthSquared
          )
        )
  const projected: Vec2 = [
    segment.start[0] + dx * progress,
    segment.start[1] + dz * progress,
  ]
  return {
    distance: distance(point, projected),
    height:
      segment.startHeight +
      (segment.endHeight - segment.startHeight) * progress,
  }
}

function rawLandHeight(
  point: Vec2,
  macroNoise: ReturnType<typeof createWorldNoise>,
  detailNoise: ReturnType<typeof createWorldNoise>,
  floodplainNoise: ReturnType<typeof createWorldNoise>
) {
  const floodplainEnvelope = floodplainNoise(
    point[0] * 0.021 + 31.7,
    point[1] * 0.021 - 18.4
  )
  const floodplainTexture = floodplainNoise(
    point[0] * 0.057 - 12.6,
    point[1] * 0.057 + 23.1
  )
  // A floodplain is not a field of hills. Keep the broad land profile low,
  // then introduce occasional soft hummocks and shallow swales only where the
  // low-frequency envelope is strong enough to make a coherent patch.
  const localizedAmount = Math.max(
    0,
    Math.min(1, (Math.abs(floodplainEnvelope) - 0.24) / 0.58)
  )
  const localizedRelief =
    Math.sign(floodplainEnvelope) * localizedAmount ** 2 * 0.16 +
    floodplainTexture * localizedAmount * 0.055
  return (
    1.24 +
    macroNoise(point[0] * 0.011, point[1] * 0.011) * 0.56 +
    macroNoise(point[0] * 0.0055 + 17.3, point[1] * 0.0055 - 9.1) * 0.26 +
    detailNoise(point[0] * 0.042, point[1] * 0.042) * 0.075 +
    localizedRelief +
    point[1] * 0.00035
  )
}

function limitRoadGrade(
  values: number[],
  points: readonly Vec2[],
  maximumGrade = 0.045
) {
  const result = [...values]
  for (let pass = 0; pass < 3; pass += 1) {
    for (let index = 1; index < result.length; index += 1) {
      const maximumChange =
        distance(points[index - 1], points[index]) * maximumGrade
      result[index] = Math.max(
        result[index - 1] - maximumChange,
        Math.min(result[index - 1] + maximumChange, result[index])
      )
    }
    for (let index = result.length - 2; index >= 0; index -= 1) {
      const maximumChange =
        distance(points[index], points[index + 1]) * maximumGrade
      result[index] = Math.max(
        result[index + 1] - maximumChange,
        Math.min(result[index + 1] + maximumChange, result[index])
      )
    }
  }
  return result
}

function hexToRgb(value: string) {
  const normalized = value.replace("#", "")
  const toLinear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return [
    toLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    toLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    toLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
  ] as const
}

function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  amount: number
) {
  return [
    round(a[0] + (b[0] - a[0]) * amount, 5),
    round(a[1] + (b[1] - a[1]) * amount, 5),
    round(a[2] + (b[2] - a[2]) * amount, 5),
  ] as const
}

export function createTerrainField(
  world: AuthoredWorldV3,
  roads: readonly SampledRoad[],
  waters: readonly CompiledWaterShapeV3[]
): TerrainFieldV3 {
  const macroNoise = createWorldNoise(world.seed, "terrain-macro")
  const detailNoise = createWorldNoise(world.seed, "terrain-detail")
  const floodplainNoise = createWorldNoise(world.seed, "terrain-floodplain")
  const colorNoise = createWorldNoise(world.seed, "terrain-color")
  const roadSegments: RoadHeightSegment[] = []
  const buildingPads: BuildingPadSample[] = []

  for (const road of roads) {
    const heights = limitRoadGrade(
      road.points.map((point) =>
        rawLandHeight(point, macroNoise, detailNoise, floodplainNoise)
      ),
      road.points
    )
    for (let index = 0; index < road.points.length - 1; index += 1) {
      // Terrain tiles are sampled on a coarser grid than the road mesh. Keep
      // the full pavement footprint plus the surrounding terrain samples on
      // the grade-limited road profile; otherwise a sloped terrain triangle
      // can interpolate back through the thin road surface between samples.
      const flatRadius =
        road.source.width / 2 +
        world.terrainSampleSpacing * ROAD_SURFACE_FLAT_MARGIN_SAMPLES
      roadSegments.push({
        start: road.points[index],
        end: road.points[index + 1],
        startHeight: heights[index],
        endHeight: heights[index + 1],
        flatRadius,
        influence: flatRadius + ROAD_RELIEF_BUFFER,
      })
    }
    const turnaroundRadius = road.source.endTurnaroundRadius
    if (turnaroundRadius !== undefined) {
      const endpoint = road.points[road.points.length - 1]
      const endpointHeight = heights[heights.length - 1]
      const flatRadius =
        turnaroundRadius +
        world.terrainSampleSpacing * ROAD_SURFACE_FLAT_MARGIN_SAMPLES
      roadSegments.push({
        start: endpoint,
        end: endpoint,
        startHeight: endpointHeight,
        endHeight: endpointHeight,
        flatRadius,
        influence: flatRadius + ROAD_RELIEF_BUFFER,
      })
    }
  }
  const roadMap = new Map(roads.map((road) => [road.source.id, road]))
  for (const building of world.environmentalBuildings) {
    const road = roadMap.get(building.roadId)
    if (!road) continue
    const index = Math.max(
      0,
      Math.min(
        road.points.length - 2,
        Math.round(building.roadProgress * (road.points.length - 2))
      )
    )
    const start = road.points[index]
    const end = road.points[index + 1]
    const length = distance(start, end) || 1
    const tangent: Vec2 = [
      (end[0] - start[0]) / length,
      (end[1] - start[1]) / length,
    ]
    const normal: Vec2 = [-tangent[1], tangent[0]]
    const outward: Vec2 = [
      normal[0] * building.roadSide,
      normal[1] * building.roadSide,
    ]
    const edgeCenter: Vec2 = [
      (start[0] + end[0]) / 2 + outward[0] * (road.source.width / 2),
      (start[1] + end[1]) / 2 + outward[1] * (road.source.width / 2),
    ]
    const center: Vec2 = [
      edgeCenter[0] +
        outward[0] * (building.setback + building.footprint[1] / 2),
      edgeCenter[1] +
        outward[1] * (building.setback + building.footprint[1] / 2),
    ]
    buildingPads.push({
      center,
      tangent,
      outward,
      halfWidth: building.footprint[0] / 2,
      halfDepth: building.footprint[1] / 2,
      height: rawLandHeight(center, macroNoise, detailNoise, floodplainNoise),
    })
  }

  const landHeightAt = (point: Vec2) => {
    let height = rawLandHeight(point, macroNoise, detailNoise, floodplainNoise)
    let nearest: RoadHeightSegment | undefined
    let nearestHeight = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const segment of roadSegments) {
      const sample = sampleRoadHeight(segment, point)
      if (sample.distance < nearestDistance) {
        nearest = segment
        nearestHeight = sample.height
        nearestDistance = sample.distance
      }
    }
    if (nearest && nearestDistance < nearest.influence) {
      const transitionWidth = nearest.influence - nearest.flatRadius
      const blend =
        nearestDistance <= nearest.flatRadius
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                1 -
                  (nearestDistance - nearest.flatRadius) /
                    Math.max(transitionWidth, 1e-6)
              )
            )
      const smoothBlend = blend * blend * (3 - 2 * blend)
      height += (nearestHeight - height) * smoothBlend
    }
    let selectedPad:
      | {
          pad: BuildingPadSample
          blend: number
          footprintDistance: number
          centerDistance: number
        }
      | undefined
    for (const pad of buildingPads) {
      const dx = point[0] - pad.center[0]
      const dz = point[1] - pad.center[1]
      const along = Math.abs(dx * pad.tangent[0] + dz * pad.tangent[1])
      const across = Math.abs(dx * pad.outward[0] + dz * pad.outward[1])
      // The compiled height sampler interpolates between grid vertices, so the
      // flat pad must extend past one diagonal sample around a rotated corner.
      const flatMargin = world.terrainSampleSpacing * 1.65
      const transition = BUILDING_PAD_TRANSITION
      if (
        along > pad.halfWidth + flatMargin + transition ||
        across > pad.halfDepth + flatMargin + transition
      )
        continue
      const outsideFlatPad = Math.max(
        0,
        along - pad.halfWidth - flatMargin,
        across - pad.halfDepth - flatMargin
      )
      const blend =
        outsideFlatPad === 0 ? 1 : Math.max(0, 1 - outsideFlatPad / transition)
      const smoothBlend = blend * blend * (3 - 2 * blend)
      const footprintDistance = Math.hypot(
        Math.max(0, along - pad.halfWidth),
        Math.max(0, across - pad.halfDepth)
      )
      const centerDistance = Math.hypot(dx, dz)
      if (
        !selectedPad ||
        footprintDistance < selectedPad.footprintDistance - 1e-6 ||
        (Math.abs(footprintDistance - selectedPad.footprintDistance) <= 1e-6 &&
          centerDistance < selectedPad.centerDistance)
      ) {
        selectedPad = {
          pad,
          blend: smoothBlend,
          footprintDistance,
          centerDistance,
        }
      }
    }
    if (selectedPad) {
      height += (selectedPad.pad.height - height) * selectedPad.blend
    }
    return round(height)
  }
  const heightAt = (point: Vec2) => {
    const water = pointTouchesWater(point, waters)
    return water
      ? round(water.waterLevel - INLAND_WATERBED_DEPTH)
      : landHeightAt(point)
  }

  const grass = hexToRgb("#76ab88")
  const grassShadow = hexToRgb("#639873")
  const wetBank = hexToRgb("#609984")
  const wetEarth = hexToRgb("#8a7257")
  const sand = hexToRgb("#e3cea2")
  const colorAt = (point: Vec2) => {
    const noise = (colorNoise(point[0] * 0.06, point[1] * 0.06) + 1) / 2
    const elevation = rawLandHeight(
      point,
      macroNoise,
      detailNoise,
      floodplainNoise
    )
    const floodplainEnvelope = floodplainNoise(
      point[0] * 0.021 + 31.7,
      point[1] * 0.021 - 18.4
    )
    const lowGroundTint = Math.max(
      0,
      Math.min(0.24, (-floodplainEnvelope - 0.28) * 0.34)
    )
    const elevationBlend = Math.max(0, Math.min(1, (elevation - 0.42) / 1.55))
    const elevationColor = mixRgb(wetBank, grass, elevationBlend)
    const coastBlend = Math.max(0, Math.min(1, (-24 - point[0]) / 12))
    const bankProbe = world.terrainSampleSpacing * 1.15
    const nearWater = [
      point,
      [point[0] + bankProbe, point[1]] as Vec2,
      [point[0] - bankProbe, point[1]] as Vec2,
      [point[0], point[1] + bankProbe] as Vec2,
      [point[0], point[1] - bankProbe] as Vec2,
    ].some((candidate) => pointTouchesWater(candidate, waters))
    const landColor = mixRgb(
      mixRgb(grassShadow, wetEarth, lowGroundTint),
      elevationColor,
      0.38 + noise * 0.62
    )
    return mixRgb(
      nearWater ? mixRgb(landColor, wetBank, 0.52) : landColor,
      sand,
      coastBlend * 0.72
    )
  }

  return { heightAt, landHeightAt, colorAt }
}

export function cellIdAtV3(point: Vec2, world: AuthoredWorldV3) {
  const x = Math.max(
    0,
    Math.min(
      Math.ceil((world.bounds[2] - world.bounds[0]) / world.cellSize) - 1,
      Math.floor((point[0] - world.bounds[0]) / world.cellSize)
    )
  )
  const z = Math.max(
    0,
    Math.min(
      Math.ceil((world.bounds[3] - world.bounds[1]) / world.cellSize) - 1,
      Math.floor((point[1] - world.bounds[1]) / world.cellSize)
    )
  )
  return `cell.v3.${x}.${z}`
}

export function createCellSkeletonsV3(world: AuthoredWorldV3) {
  const cells: CellManifestV3[] = []
  const columns = Math.ceil(
    (world.bounds[2] - world.bounds[0]) / world.cellSize
  )
  const rows = Math.ceil((world.bounds[3] - world.bounds[1]) / world.cellSize)
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < columns; x += 1) {
      const bounds: Bounds2 = [
        world.bounds[0] + x * world.cellSize,
        world.bounds[1] + z * world.cellSize,
        Math.min(world.bounds[2], world.bounds[0] + (x + 1) * world.cellSize),
        Math.min(world.bounds[3], world.bounds[1] + (z + 1) * world.cellSize),
      ]
      cells.push({
        id: `cell.v3.${x}.${z}`,
        districtId: z === rows - 1 ? "town" : "education",
        bounds,
        terrainTileId: `terrain.cell.v3.${x}.${z}`,
        geometryIds: [],
        batchIds: [],
        colliderIds: [],
        waterBodyIds: [],
        bridgeIds: [],
        environmentalBuildingIds: [],
        checksum: "",
      })
    }
  }
  return cells
}

function createTerrainGeometry(
  tile: Omit<TerrainTileManifestV3, "checksum">,
  field: TerrainFieldV3,
  waters: readonly CompiledWaterShapeV3[]
): GeometryDefinitionV3 {
  const [columns, rows] = tile.resolution
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const waterMasks = waters
    .map((water) => {
      const points = water.multiPolygon.flat(2)
      return {
        multiPolygon: water.multiPolygon,
        bounds: [
          Math.min(...points.map((point) => point[0])),
          Math.min(...points.map((point) => point[1])),
          Math.max(...points.map((point) => point[0])),
          Math.max(...points.map((point) => point[1])),
        ] as const,
      }
    })
    .filter(
      ({ bounds }) =>
        bounds[0] < tile.bounds[2] &&
        bounds[2] > tile.bounds[0] &&
        bounds[1] < tile.bounds[3] &&
        bounds[3] > tile.bounds[1]
    )
  for (let row = 0; row < rows; row += 1) {
    const z = tile.bounds[1] + row * tile.sampleSpacing
    for (let column = 0; column < columns; column += 1) {
      const x = tile.bounds[0] + column * tile.sampleSpacing
      const height = tile.heights[row * columns + column]
      positions.push(round(x), height, round(z))
      colors.push(...field.colorAt([x, z]))
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const minimumX = tile.bounds[0] + column * tile.sampleSpacing
      const minimumZ = tile.bounds[1] + row * tile.sampleSpacing
      const maximumX = minimumX + tile.sampleSpacing
      const maximumZ = minimumZ + tile.sampleSpacing
      const intersectingWater = waterMasks.filter(
        ({ bounds }) =>
          bounds[0] < maximumX &&
          bounds[2] > minimumX &&
          bounds[1] < maximumZ &&
          bounds[3] > minimumZ
      )
      if (intersectingWater.length > 0) {
        // A height-only waterbed still leaves dry-to-bed grid triangles
        // spanning the shoreline. At a streamed-world edge those triangles
        // can sit over the lower far-water proxy as a visible green wedge.
        // Clip the rendered top surface itself while retaining the sampled
        // tile heights as the authoritative traversal/collision field.
        const cell: MultiPolygon = [
          [
            [
              [minimumX, minimumZ],
              [maximumX, minimumZ],
              [maximumX, maximumZ],
              [minimumX, maximumZ],
              [minimumX, minimumZ],
            ],
          ],
        ]
        const dryTerrain = difference(
          cell,
          ...intersectingWater.map((water) => water.multiPolygon)
        )
        if (dryTerrain.length > 0) {
          const clipped = triangulateMultiPolygonV3({
            id: `${tile.geometryId}.shore.${column}.${row}`,
            kind: "terrain",
            materialId: "terrain.monsoon",
            y: 0,
            multiPolygon: dryTerrain,
          })
          const vertexOffset = positions.length / 3
          for (let index = 0; index < clipped.positions.length; index += 3) {
            const point: Vec2 = [
              clipped.positions[index],
              clipped.positions[index + 2],
            ]
            positions.push(
              round(point[0]),
              round(field.landHeightAt?.(point) ?? field.heightAt(point)),
              round(point[1])
            )
            colors.push(...field.colorAt(point))
          }
          for (const index of clipped.indices) {
            indices.push(vertexOffset + index)
          }
        }
        continue
      }
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return {
    id: tile.geometryId,
    kind: "terrain",
    materialId: "terrain.monsoon",
    y: 0,
    positions,
    indices,
    colors,
  }
}

export function compileTerrainTiles(
  world: AuthoredWorldV3,
  cells: readonly CellManifestV3[],
  field: TerrainFieldV3,
  waters: readonly CompiledWaterShapeV3[] = []
) {
  const tiles: TerrainTileManifestV3[] = []
  const geometries: GeometryDefinitionV3[] = []
  for (const cell of cells) {
    const columns =
      Math.round(
        (cell.bounds[2] - cell.bounds[0]) / world.terrainSampleSpacing
      ) + 1
    const rows =
      Math.round(
        (cell.bounds[3] - cell.bounds[1]) / world.terrainSampleSpacing
      ) + 1
    const heights: number[] = []
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        heights.push(
          field.heightAt([
            cell.bounds[0] + column * world.terrainSampleSpacing,
            cell.bounds[1] + row * world.terrainSampleSpacing,
          ])
        )
      }
    }
    const partial: Omit<TerrainTileManifestV3, "checksum"> = {
      id: cell.terrainTileId,
      cellId: cell.id,
      bounds: cell.bounds,
      resolution: [columns, rows],
      sampleSpacing: world.terrainSampleSpacing,
      heights,
      minHeight: Math.min(...heights),
      maxHeight: Math.max(...heights),
      geometryId: `geometry.${cell.terrainTileId}`,
    }
    const tile: TerrainTileManifestV3 = {
      ...partial,
      checksum: checksumJson(partial),
    }
    tiles.push(tile)
    geometries.push(createTerrainGeometry(partial, field, waters))
    cell.geometryIds.push(tile.geometryId)
  }
  return { tiles, geometries }
}
