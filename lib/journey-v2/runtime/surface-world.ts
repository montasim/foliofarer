import type { Vec2 } from "@/lib/journey-v2/contracts/world"
import type {
  JourneyWorldGeometryDefinition,
  JourneyWorldManifest,
  Vec3,
} from "@/lib/journey-v2/runtime/types"

const SURFACE_EPSILON = 1e-4
const DEFAULT_MAX_SLOPE_RADIANS = (28 * Math.PI) / 180
const DEFAULT_MAX_STEP_HEIGHT = 0.48

type SurfaceKind =
  | "terrain"
  | "road"
  | "sidewalk"
  | "access"
  | "bridge"
  | "water"
  | "fallback"

interface TerrainTileLike {
  id: string
  cellId: string
  bounds: readonly [number, number, number, number]
  resolution: readonly [number, number]
  heights: number[]
  minHeight: number
  maxHeight: number
}

interface WaterBodyLike {
  id: string
  polygon: Vec2[] | Vec2[][]
  waterLevel: number
  walkable?: boolean
}

interface BridgeLike {
  id: string
  deckPolygon: Vec2[]
  deckHeight: number
  deckCenterline?: Vec3[]
  walkable?: boolean
}

interface SurfaceTriangle {
  cellId: string
  geometryId: string
  kind: SurfaceKind
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  cx: number
  cy: number
  cz: number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  normalY: number
}

export interface JourneySurfaceSample {
  height: number
  slopeRadians: number
  normalY: number
  kind: SurfaceKind
  walkable: boolean
  sourceId: string
}

export interface JourneySurfaceMove {
  x: number
  y: number
  z: number
  accepted: boolean
  sample: JourneySurfaceSample
}

function isFiniteBounds(
  value: unknown
): value is readonly [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  )
}

function isVec2(value: unknown): value is Vec2 {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  )
}

function pointInRing(x: number, z: number, polygon: readonly Vec2[]) {
  let inside = false
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const [x1, z1] = polygon[index]
    const [x2, z2] = polygon[previous]
    if (
      z1 > z !== z2 > z &&
      x < ((x2 - x1) * (z - z1)) / (z2 - z1 || Number.EPSILON) + x1
    ) {
      inside = !inside
    }
  }
  return inside
}

function pointInPolygon(x: number, z: number, polygon: Vec2[] | Vec2[][]) {
  if (polygon.length === 0) return false
  if (isVec2(polygon[0])) return pointInRing(x, z, polygon as Vec2[])
  const rings = polygon as Vec2[][]
  if (!pointInRing(x, z, rings[0] ?? [])) return false
  return !rings.slice(1).some((ring) => pointInRing(x, z, ring))
}

function surfaceKind(
  geometry: JourneyWorldGeometryDefinition
): SurfaceKind | null {
  if ("walkable" in geometry && geometry.walkable === false) return null
  const value =
    `${geometry.kind} ${geometry.id} ${geometry.materialId}`.toLowerCase()
  if (value.includes("bridge")) return "bridge"
  if (value.includes("water")) return "water"
  if (value.includes("sidewalk")) return "sidewalk"
  if (value.includes("access")) return "access"
  if (value.includes("road")) return "road"
  if (
    geometry.kind === "surface" ||
    value.includes("terrain") ||
    value.includes("ground")
  ) {
    return "terrain"
  }
  return null
}

function triangleSample(triangle: SurfaceTriangle, x: number, z: number) {
  if (
    x < triangle.minX - SURFACE_EPSILON ||
    x > triangle.maxX + SURFACE_EPSILON ||
    z < triangle.minZ - SURFACE_EPSILON ||
    z > triangle.maxZ + SURFACE_EPSILON
  ) {
    return null
  }
  const denominator =
    (triangle.bz - triangle.cz) * (triangle.ax - triangle.cx) +
    (triangle.cx - triangle.bx) * (triangle.az - triangle.cz)
  if (Math.abs(denominator) <= 1e-9) return null
  const a =
    ((triangle.bz - triangle.cz) * (x - triangle.cx) +
      (triangle.cx - triangle.bx) * (z - triangle.cz)) /
    denominator
  const b =
    ((triangle.cz - triangle.az) * (x - triangle.cx) +
      (triangle.ax - triangle.cx) * (z - triangle.cz)) /
    denominator
  const c = 1 - a - b
  if (a < -SURFACE_EPSILON || b < -SURFACE_EPSILON || c < -SURFACE_EPSILON) {
    return null
  }
  return triangle.ay * a + triangle.by * b + triangle.cy * c
}

function readRuntimeCollections(manifest: JourneyWorldManifest) {
  const record = manifest as unknown as Record<string, unknown>
  const terrain = record.terrain as { tiles?: unknown } | undefined
  return {
    terrainTiles: Array.isArray(terrain?.tiles)
      ? (terrain.tiles as TerrainTileLike[])
      : [],
    waterBodies: Array.isArray(record.waterBodies)
      ? (record.waterBodies as WaterBodyLike[])
      : [],
    bridges: Array.isArray(record.bridges)
      ? (record.bridges as BridgeLike[])
      : [],
  }
}

/**
 * CPU-only walkable-surface index shared by manual movement, assisted travel,
 * player grounding and camera clearance. V3 uses compiled height tiles,
 * explicit water polygons and bridge decks. V2 remains supported by indexing
 * its serialized surface triangles and falling back to the authored spawn Y.
 */
export class JourneySurfaceWorld {
  private readonly tiles = new Map<string, TerrainTileLike>()
  private readonly waterBodies = new Map<string, WaterBodyLike>()
  private readonly bridges = new Map<string, BridgeLike>()
  private readonly trianglesByCell = new Map<string, SurfaceTriangle[]>()
  private readonly registeredGeometryIds = new Set<string>()
  private readonly fallbackHeight: number
  private readonly worldBounds: readonly [number, number, number, number]
  private readonly requiresCompiledSurface: boolean

  constructor(private readonly manifest: JourneyWorldManifest) {
    this.fallbackHeight = manifest.world.spawn[1]
    this.worldBounds = manifest.world.bounds
    this.requiresCompiledSurface = manifest.schemaVersion === 3
    const collections = readRuntimeCollections(manifest)
    for (const tile of collections.terrainTiles) this.registerTile(tile)
    for (const water of collections.waterBodies) {
      this.waterBodies.set(water.id, water)
    }
    for (const bridge of collections.bridges) {
      this.bridges.set(bridge.id, bridge)
    }
    const geometries = new Map(
      manifest.geometries.map((geometry) => [geometry.id, geometry])
    )
    for (const cell of manifest.cells) {
      this.registerGeometries(
        cell.id,
        cell.geometryIds.flatMap((id) => {
          const geometry = geometries.get(id)
          return geometry ? [geometry] : []
        })
      )
    }
    this.registerGeometries("bootstrap", manifest.geometries)
  }

  private registerTile(tile: TerrainTileLike) {
    const [columns, rows] = tile.resolution ?? []
    if (
      !tile.id ||
      !isFiniteBounds(tile.bounds) ||
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      columns < 2 ||
      rows < 2 ||
      !Array.isArray(tile.heights) ||
      tile.heights.length !== columns * rows ||
      !tile.heights.every(Number.isFinite)
    ) {
      return
    }
    this.tiles.set(tile.id, tile)
  }

  registerCell(asset: unknown) {
    if (!asset || typeof asset !== "object") return
    const value = asset as {
      cell?: { id?: unknown }
      geometries?: unknown
      terrainTiles?: unknown
    }
    const cellId =
      typeof value.cell?.id === "string" ? value.cell.id : "streamed"
    if (Array.isArray(value.geometries)) {
      this.registerGeometries(
        cellId,
        value.geometries as JourneyWorldGeometryDefinition[]
      )
    }
    if (Array.isArray(value.terrainTiles)) {
      for (const tile of value.terrainTiles as TerrainTileLike[]) {
        this.registerTile(tile)
      }
    }
  }

  unregisterCell(cellId: string) {
    for (const [tileId, tile] of this.tiles) {
      if (tile.cellId === cellId) this.tiles.delete(tileId)
    }
    const triangles = this.trianglesByCell.get(cellId) ?? []
    for (const triangle of triangles) {
      this.registeredGeometryIds.delete(triangle.geometryId)
    }
    this.trianglesByCell.delete(cellId)
  }

  /**
   * V3 traversal is available only while a decoded terrain/surface package
   * covers the coordinate. Global bridge metadata alone is not enough because
   * walking across an invisible, not-yet-streamed deck would be misleading.
   */
  hasCompiledSurfaceAt(x: number, z: number) {
    if (!this.requiresCompiledSurface) return true
    for (const tile of this.tiles.values()) {
      if (this.sampleTile(tile, x, z)) return true
    }
    for (const triangles of this.trianglesByCell.values()) {
      if (
        triangles.some((triangle) => triangleSample(triangle, x, z) !== null)
      ) {
        return true
      }
    }
    return false
  }

  private registerGeometries(
    cellId: string,
    geometries: JourneyWorldGeometryDefinition[]
  ) {
    const triangles = this.trianglesByCell.get(cellId) ?? []
    for (const geometry of geometries) {
      if (this.registeredGeometryIds.has(geometry.id)) continue
      const kind = surfaceKind(geometry)
      if (!kind || geometry.positions.length < 9) continue
      this.registeredGeometryIds.add(geometry.id)
      const indices =
        geometry.indices.length > 0
          ? geometry.indices
          : Array.from(
              { length: Math.floor(geometry.positions.length / 3) },
              (_, index) => index
            )
      for (let index = 0; index + 2 < indices.length; index += 3) {
        const ai = indices[index] * 3
        const bi = indices[index + 1] * 3
        const ci = indices[index + 2] * 3
        const ax = geometry.positions[ai]
        const ay = geometry.positions[ai + 1]
        const az = geometry.positions[ai + 2]
        const bx = geometry.positions[bi]
        const by = geometry.positions[bi + 1]
        const bz = geometry.positions[bi + 2]
        const cx = geometry.positions[ci]
        const cy = geometry.positions[ci + 1]
        const cz = geometry.positions[ci + 2]
        if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) {
          continue
        }
        const edgeABX = bx - ax
        const edgeABY = by - ay
        const edgeABZ = bz - az
        const edgeACX = cx - ax
        const edgeACY = cy - ay
        const edgeACZ = cz - az
        const normalX = edgeABY * edgeACZ - edgeABZ * edgeACY
        const normalY = edgeABZ * edgeACX - edgeABX * edgeACZ
        const normalZ = edgeABX * edgeACY - edgeABY * edgeACX
        const normalLength =
          Math.hypot(normalX, normalY, normalZ) || Number.EPSILON
        triangles.push({
          cellId,
          geometryId: geometry.id,
          kind,
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          cx,
          cy,
          cz,
          minX: Math.min(ax, bx, cx),
          minZ: Math.min(az, bz, cz),
          maxX: Math.max(ax, bx, cx),
          maxZ: Math.max(az, bz, cz),
          normalY: Math.abs(normalY / normalLength),
        })
      }
    }
    if (triangles.length > 0) this.trianglesByCell.set(cellId, triangles)
  }

  private sampleTile(tile: TerrainTileLike, x: number, z: number) {
    const [minX, minZ, maxX, maxZ] = tile.bounds
    if (
      x < minX - SURFACE_EPSILON ||
      x > maxX + SURFACE_EPSILON ||
      z < minZ - SURFACE_EPSILON ||
      z > maxZ + SURFACE_EPSILON
    ) {
      return null
    }
    const [columns, rows] = tile.resolution
    const unitX =
      ((x - minX) / Math.max(maxX - minX, Number.EPSILON)) * (columns - 1)
    const unitZ =
      ((z - minZ) / Math.max(maxZ - minZ, Number.EPSILON)) * (rows - 1)
    const column = Math.min(columns - 2, Math.max(0, Math.floor(unitX)))
    const row = Math.min(rows - 2, Math.max(0, Math.floor(unitZ)))
    const fractionX = Math.min(1, Math.max(0, unitX - column))
    const fractionZ = Math.min(1, Math.max(0, unitZ - row))
    const at = (nextColumn: number, nextRow: number) =>
      tile.heights[nextRow * columns + nextColumn]
    const h00 = at(column, row)
    const h10 = at(column + 1, row)
    const h01 = at(column, row + 1)
    const h11 = at(column + 1, row + 1)
    const north = h00 + (h10 - h00) * fractionX
    const south = h01 + (h11 - h01) * fractionX
    const height = north + (south - north) * fractionZ
    const spacingX = (maxX - minX) / Math.max(columns - 1, 1)
    const spacingZ = (maxZ - minZ) / Math.max(rows - 1, 1)
    const gradientX =
      ((h10 - h00) * (1 - fractionZ) + (h11 - h01) * fractionZ) /
      Math.max(spacingX, Number.EPSILON)
    const gradientZ =
      ((h01 - h00) * (1 - fractionX) + (h11 - h10) * fractionX) /
      Math.max(spacingZ, Number.EPSILON)
    const normalY = 1 / Math.hypot(gradientX, 1, gradientZ)
    return {
      height,
      slopeRadians: Math.acos(Math.min(1, Math.max(0, normalY))),
      normalY,
    }
  }

  sample(x: number, z: number): JourneySurfaceSample {
    // Schema V3.0 bridges exposed only a flat metadata height. Keep that
    // compatibility path, while profiled bridges use their streamed triangles
    // so movement follows exactly what WebGL displays.
    for (const bridge of this.bridges.values()) {
      if (
        bridge.walkable !== false &&
        (!bridge.deckCenterline || bridge.deckCenterline.length < 2) &&
        pointInRing(x, z, bridge.deckPolygon ?? [])
      ) {
        return {
          height: bridge.deckHeight,
          slopeRadians: 0,
          normalY: 1,
          kind: "bridge",
          walkable: true,
          sourceId: bridge.id,
        }
      }
    }

    // Authored traversal triangles own exact movement height, including above
    // water. Decorative bridge supports and rails are excluded at registration
    // by their explicit `walkable: false` metadata.
    let bestTraversal: JourneySurfaceSample | null = null
    for (const triangles of this.trianglesByCell.values()) {
      for (const triangle of triangles) {
        if (triangle.kind === "terrain" || triangle.kind === "water") continue
        const height = triangleSample(triangle, x, z)
        if (
          height === null ||
          (bestTraversal && height <= bestTraversal.height + SURFACE_EPSILON)
        ) {
          continue
        }
        const slopeRadians = Math.acos(
          Math.min(1, Math.max(0, triangle.normalY))
        )
        bestTraversal = {
          height,
          slopeRadians,
          normalY: triangle.normalY,
          kind: triangle.kind,
          walkable: slopeRadians <= DEFAULT_MAX_SLOPE_RADIANS,
          sourceId: triangle.geometryId,
        }
      }
    }
    if (bestTraversal) return bestTraversal

    for (const water of this.waterBodies.values()) {
      if (pointInPolygon(x, z, water.polygon ?? [])) {
        return {
          height: water.waterLevel,
          slopeRadians: 0,
          normalY: 1,
          kind: "water",
          walkable: water.walkable === true,
          sourceId: water.id,
        }
      }
    }

    let bestTile: JourneySurfaceSample | null = null
    for (const tile of this.tiles.values()) {
      const sample = this.sampleTile(tile, x, z)
      if (!sample || (bestTile && sample.height <= bestTile.height)) continue
      bestTile = {
        ...sample,
        kind: "terrain",
        walkable: sample.slopeRadians <= DEFAULT_MAX_SLOPE_RADIANS,
        sourceId: tile.id,
      }
    }
    if (bestTile) return bestTile

    let bestTriangle: JourneySurfaceSample | null = null
    for (const triangles of this.trianglesByCell.values()) {
      for (const triangle of triangles) {
        const height = triangleSample(triangle, x, z)
        if (
          height === null ||
          (bestTriangle && height <= bestTriangle.height + SURFACE_EPSILON)
        ) {
          continue
        }
        const slopeRadians = Math.acos(
          Math.min(1, Math.max(0, triangle.normalY))
        )
        bestTriangle = {
          height,
          slopeRadians,
          normalY: triangle.normalY,
          kind: triangle.kind,
          walkable:
            triangle.kind !== "water" &&
            slopeRadians <= DEFAULT_MAX_SLOPE_RADIANS,
          sourceId: triangle.geometryId,
        }
      }
    }
    if (bestTriangle) return bestTriangle

    const insideWorld =
      x >= this.worldBounds[0] &&
      x <= this.worldBounds[2] &&
      z >= this.worldBounds[1] &&
      z <= this.worldBounds[3]
    return {
      height: this.fallbackHeight,
      slopeRadians: 0,
      normalY: 1,
      kind: "fallback",
      walkable: insideWorld && !this.requiresCompiledSurface,
      sourceId: "world.fallback",
    }
  }

  resolveMovement(
    from: Vec3,
    toX: number,
    toZ: number,
    options: {
      maxSlopeRadians?: number
      maxStepHeight?: number
    } = {}
  ): JourneySurfaceMove {
    const sample = this.sample(toX, toZ)
    const maxSlope = options.maxSlopeRadians ?? DEFAULT_MAX_SLOPE_RADIANS
    const maxStep = options.maxStepHeight ?? DEFAULT_MAX_STEP_HEIGHT
    const accepted =
      sample.walkable &&
      sample.slopeRadians <= maxSlope &&
      sample.height - from[1] <= maxStep
    return {
      x: accepted ? toX : from[0],
      y: accepted ? sample.height : from[1],
      z: accepted ? toZ : from[2],
      accepted,
      sample,
    }
  }
}
