import * as THREE from "three"
import type { JourneyV2Quality } from "@/lib/journey-v2/design"
import { JOURNEY_V2_PALETTE, JOURNEY_V2_QUALITY } from "@/lib/journey-v2/design"
import type {
  CellWorldAsset,
  CellWorldAssetV3,
} from "@/lib/journey-v2/contracts/world"
import {
  applyJourneyVertexColors,
  createJourneyCodeMaterial,
  type JourneyAnimatedMaterial,
} from "@/lib/journey-v2/runtime/code-materials"
import {
  cameraOccluderVisibilityFraction,
  minimumSafeCameraFraction,
  type CameraOccluderVolume,
} from "@/lib/journey-v2/runtime/camera-occlusion"
import type {
  JourneyWorldCellDefinition,
  JourneyWorldGeometryDefinition,
  JourneyWorldInstanceBatch,
  JourneyWorldManifest,
  JourneyWorldMaterialDefinition,
  Vec3,
} from "@/lib/journey-v2/runtime/types"
import {
  JOURNEY_CELL_LIMITS,
  type JourneyCellLimits,
} from "@/lib/journey-v2/runtime/streaming-policy"
import {
  createJourneyBuildingWayfindingAtlas,
  createJourneyBuildingWayfindingMesh,
  type JourneyBuildingWayfindingAtlas,
  type JourneyBuildingWayfindingMesh,
} from "@/lib/journey-v2/runtime/building-wayfinding"

function isJourneyLine(kind: string, id: string) {
  const value = `${kind} ${id}`.toLowerCase()
  return value.includes("journey") || value.includes("route-line")
}

function isGrass(kind: string) {
  return kind.toLowerCase().includes("grass")
}

type CellAssetLike = (CellWorldAsset | CellWorldAssetV3) & {
  generatorVersion?: string
  checksum?: string
  environmentalBuildings?: BuildingLike[]
  buildings?: BuildingLike[]
}

interface BuildingLike {
  id: string
  cellId: string
  style?: string
  family?: string
  archetype?: string
  footprint: readonly (readonly [number, number])[]
  baseHeight?: number
  height: number
  entrance: readonly [number, number, number]
}

type RuntimeInstanceBatch = JourneyWorldInstanceBatch & {
  lod?: "near" | "mid" | "far"
  densityRanks?: number[]
  colors?: string[]
  speciesId?: string
}

type DetailBand = "near" | "mid" | "far"

export interface JourneyCellResidencyMetrics {
  active: number
  gpuResident: number
  streamed: number
  loading: number
  prefetched: number
  limits: JourneyCellLimits
}

function manifestBuildings(manifest: JourneyWorldManifest) {
  return (
    "environmentalBuildings" in manifest
      ? manifest.environmentalBuildings
      : manifest.buildings
  ) as BuildingLike[]
}

export class JourneyWorldAssetRegistry {
  private readonly geometryDefinitions = new Map<
    string,
    JourneyWorldGeometryDefinition
  >()
  private readonly materialDefinitions = new Map<
    string,
    JourneyWorldMaterialDefinition
  >()
  private readonly geometries = new Map<string, THREE.BufferGeometry>()
  private readonly materials = new Map<string, THREE.Material>()
  private readonly animatedMaterials = new Map<
    string,
    JourneyAnimatedMaterial
  >()

  constructor(manifest: JourneyWorldManifest) {
    for (const definition of manifest.geometries) {
      this.geometryDefinitions.set(definition.id, definition)
    }
    for (const definition of manifest.materials) {
      this.materialDefinitions.set(definition.id, definition)
    }
  }

  geometry(id: string) {
    const cached = this.geometries.get(id)
    if (cached) return cached
    const definition = this.geometryDefinitions.get(id)
    if (!definition) throw new Error(`Journey geometry "${id}" is missing`)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(definition.positions, 3)
    )
    if (definition.indices.length > 0) {
      geometry.setIndex(definition.indices)
    }
    applyJourneyVertexColors(geometry, definition)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    geometry.userData.journeyKind = definition.kind
    geometry.userData.journeyYOffset = definition.y
    this.geometries.set(id, geometry)
    return geometry
  }

  material(id: string) {
    const cached = this.materials.get(id)
    if (cached) return cached
    const definition = this.materialDefinitions.get(id)
    if (!definition) throw new Error(`Journey material "${id}" is missing`)

    const animated = createJourneyCodeMaterial(definition)
    animated.material.name = definition.id
    this.materials.set(id, animated.material)
    this.animatedMaterials.set(id, animated)
    return animated.material
  }

  geometryDefinition(id: string) {
    return this.geometryDefinitions.get(id)
  }

  registerGeometries(definitions: JourneyWorldGeometryDefinition[]) {
    for (const definition of definitions) {
      this.geometryDefinitions.set(definition.id, definition)
    }
  }

  releaseCellGeometries(ids: readonly string[]) {
    for (const id of ids) {
      const geometry = this.geometries.get(id)
      if (!geometry) continue
      geometry.dispose()
      this.geometries.delete(id)
    }
  }

  unregisterCellGeometries(ids: readonly string[]) {
    this.releaseCellGeometries(ids)
    for (const id of ids) this.geometryDefinitions.delete(id)
  }

  update(elapsed: number, reducedMotion: boolean) {
    // Reduced-motion freezes the current procedural phase instead of snapping
    // rivers and ponds back to their initial state.
    if (reducedMotion) return
    for (const animated of this.animatedMaterials.values()) {
      animated.update(elapsed)
    }
  }

  dispose() {
    for (const geometry of this.geometries.values()) geometry.dispose()
    for (const material of this.materials.values()) material.dispose()
    this.geometries.clear()
    this.materials.clear()
    this.animatedMaterials.clear()
  }
}

interface DensityMesh {
  mesh: THREE.InstancedMesh
  maximumCount: number
  kind: string
  lod: DetailBand | null
  cameraOccluders: CameraOccluderVolume[]
}

interface CanopyGeometryProfile {
  center: THREE.Vector3
  radiusXZ: number
  radiusY: number
}

interface CellState {
  definition: JourneyWorldCellDefinition
  group: THREE.Group | null
  active: boolean
  loaded: boolean
  loadingRequested: boolean
  buildings: BuildingLike[]
  wayfindingLabel: JourneyBuildingWayfindingMesh | null
  densityMeshes: DensityMesh[]
  detailBand: DetailBand
  lastResidentUse: number
  lastStreamUse: number
  prefetched: boolean
}

interface DetailTransform {
  position: THREE.Vector3
  rotationY: number
  scale: THREE.Vector3
}

function distanceToBounds(
  x: number,
  z: number,
  bounds: readonly [number, number, number, number]
) {
  const distanceX = Math.max(bounds[0] - x, 0, x - bounds[2])
  const distanceZ = Math.max(bounds[1] - z, 0, z - bounds[3])
  return Math.hypot(distanceX, distanceZ)
}

/**
 * Lazily materializes district-local render batches with independent active,
 * GPU-resident and decoded-stream limits. Invisible prefetched cells submit no
 * draw calls, while deterministic nearest-first selection prevents a large map
 * from expanding the render budget.
 */
export class JourneyCellManager {
  private readonly root = new THREE.Group()
  private readonly cells = new Map<string, CellState>()
  private readonly batches = new Map<string, JourneyWorldInstanceBatch>()
  private readonly activeCellIds = new Set<string>()
  private readonly instanceMatrix = new THREE.Matrix4()
  private readonly instancePosition = new THREE.Vector3()
  private readonly instanceQuaternion = new THREE.Quaternion()
  private readonly instanceScale = new THREE.Vector3()
  private readonly instanceOccluderCenter = new THREE.Vector3()
  private readonly yAxis = new THREE.Vector3(0, 1, 0)
  private readonly canopyGeometryProfiles = new Map<
    string,
    CanopyGeometryProfile | null
  >()
  private readonly wayfindingAtlas: JourneyBuildingWayfindingAtlas | null
  private readonly detailBox = new THREE.BoxGeometry(1, 1, 1)
  private readonly detailHipRoof = new THREE.BufferGeometry()
  private readonly detailAnimatedMaterials = {
    roof: createJourneyCodeMaterial({
      id: "detail.roof",
      kind: "standard",
      color: JOURNEY_V2_PALETTE.roof,
      roughness: 0.88,
    }),
    roofFlat: createJourneyCodeMaterial({
      id: "detail.roof-flat",
      kind: "standard",
      color: JOURNEY_V2_PALETTE.roofSlate,
      roughness: 0.86,
    }),
    window: createJourneyCodeMaterial({
      id: "detail.window",
      kind: "standard",
      color: JOURNEY_V2_PALETTE.water,
      roughness: 0.42,
    }),
    door: createJourneyCodeMaterial({
      id: "detail.door",
      kind: "standard",
      color: JOURNEY_V2_PALETTE.ink,
      roughness: 0.84,
    }),
  }
  private readonly detailMaterials = {
    roof: this.detailAnimatedMaterials.roof.material,
    roofFlat: this.detailAnimatedMaterials.roofFlat.material,
    window: this.detailAnimatedMaterials.window.material,
    door: this.detailAnimatedMaterials.door.material,
  }
  private lastVisibilityX = Number.POSITIVE_INFINITY
  private lastVisibilityZ = Number.POSITIVE_INFINITY
  private residentSequence = 0
  private streamSequence = 0
  private routePinnedCellId: string | null = null
  private playerPinnedCellIds = new Set<string>()
  private adaptiveDensityScale = 1
  private quality: JourneyV2Quality

  constructor(
    private readonly manifest: JourneyWorldManifest,
    private readonly registry: JourneyWorldAssetRegistry,
    quality: JourneyV2Quality,
    loadedCellIds = new Set(manifest.cells.map((cell) => cell.id)),
    private readonly onCellRequired?: (cellId: string) => void,
    private readonly onCellReleased?: (cellId: string) => void,
    private readonly wayfindingLabels: ReadonlyMap<string, string> = new Map()
  ) {
    this.quality = quality
    this.wayfindingAtlas =
      createJourneyBuildingWayfindingAtlas(wayfindingLabels)
    this.root.name = "journey-v2-cells"
    this.detailHipRoof.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0],
        3
      )
    )
    this.detailHipRoof.setIndex([
      0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 2, 1, 0, 3, 2,
    ])
    this.detailHipRoof.computeVertexNormals()
    for (const cell of manifest.cells) {
      this.cells.set(cell.id, {
        definition: cell,
        group: null,
        active: false,
        loaded: loadedCellIds.has(cell.id),
        loadingRequested: false,
        buildings: manifestBuildings(manifest).filter(
          (building) => building.cellId === cell.id
        ),
        wayfindingLabel: null,
        densityMeshes: [],
        detailBand: "far",
        lastResidentUse: 0,
        lastStreamUse: loadedCellIds.has(cell.id) ? ++this.streamSequence : 0,
        prefetched: false,
      })
    }
    for (const batch of manifest.instanceBatches) {
      this.batches.set(batch.id, batch)
    }
    if ("features" in manifest) {
      for (const batch of manifest.features.laneMarkers) {
        if (!this.batches.has(batch.id)) this.batches.set(batch.id, batch)
      }
    }
  }

  get object() {
    return this.root
  }

  setQuality(quality: JourneyV2Quality) {
    if (quality === this.quality) return
    this.quality = quality
    for (const cell of this.cells.values()) {
      this.applyDetailBand(cell, cell.detailBand)
    }
    this.lastVisibilityX = Number.POSITIVE_INFINITY
  }

  setAdaptiveDensityScale(scale: number) {
    const next = THREE.MathUtils.clamp(scale, 0.28, 1)
    if (Math.abs(next - this.adaptiveDensityScale) < 0.025) return false
    this.adaptiveDensityScale = next
    for (const cell of this.cells.values()) {
      if (cell.group) this.applyDetailBand(cell, cell.detailBand)
    }
    return true
  }

  private cellsAt(x: number, z: number, margin = 0) {
    return [...this.cells.values()]
      .filter(({ definition }) => {
        const [minX, minZ, maxX, maxZ] = definition.bounds
        return (
          x >= minX - margin &&
          x <= maxX + margin &&
          z >= minZ - margin &&
          z <= maxZ + margin
        )
      })
      .sort((first, second) =>
        first.definition.id.localeCompare(second.definition.id)
      )
  }

  private nearestCell(x: number, z: number) {
    let nearest: CellState | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const cell of this.cells.values()) {
      const distance = distanceToBounds(x, z, cell.definition.bounds)
      if (
        distance < nearestDistance ||
        (distance === nearestDistance &&
          cell.definition.id.localeCompare(nearest?.definition.id ?? "") < 0)
      ) {
        nearest = cell
        nearestDistance = distance
      }
    }
    return nearest
  }

  private requestCellLoad(cell: CellState, prefetched: boolean) {
    cell.lastStreamUse = ++this.streamSequence
    if (prefetched) cell.prefetched = true
    if (cell.loaded || cell.loadingRequested) return false
    cell.loadingRequested = true
    this.onCellRequired?.(cell.definition.id)
    return true
  }

  markCellLoadFailed(cellId: string) {
    const cell = this.cells.get(cellId)
    if (!cell) return
    cell.loadingRequested = false
  }

  markCellLoadPending(cellId: string) {
    const cell = this.cells.get(cellId)
    if (!cell || cell.loaded) return
    cell.loadingRequested = true
  }

  /**
   * Requests a decoded route corridor without activating any scene group.
   * Sampling at under half a cell width catches curved routes and cell seams.
   */
  prefetchRoute(
    points: readonly Vec3[],
    cursor = 0,
    lookAhead: number = JOURNEY_CELL_LIMITS[this.quality].prefetchLookAhead
  ) {
    this.routePinnedCellId = null
    if (points.length === 0 || cursor >= points.length) return [] as string[]

    const start = Math.max(0, Math.min(cursor, points.length - 1))
    const playerCells = this.cellsAt(points[start][0], points[start][2], 0.02)
    const playerIds = new Set(playerCells.map((cell) => cell.definition.id))
    const fallbackPinnedId =
      playerCells[0]?.definition.id ??
      this.nearestCell(points[start][0], points[start][2])?.definition.id ??
      null

    const requested = new Set<string>()
    let remaining = Math.max(this.manifest.world.cellSize, lookAhead)
    let from = points[start]
    const sampleSpacing = Math.max(4, this.manifest.world.cellSize * 0.42)
    const visitPoint = (x: number, z: number) => {
      const matching = this.cellsAt(x, z, 0.35)
      const cells = matching.length > 0 ? matching : [this.nearestCell(x, z)]
      for (const cell of cells) {
        if (!cell) continue
        if (!this.routePinnedCellId && !playerIds.has(cell.definition.id)) {
          this.routePinnedCellId = cell.definition.id
        }
        this.requestCellLoad(cell, true)
        requested.add(cell.definition.id)
      }
    }
    visitPoint(from[0], from[2])

    for (
      let pointIndex = start + 1;
      pointIndex < points.length && remaining > 0;
      pointIndex += 1
    ) {
      const to = points[pointIndex]
      const segmentLength = Math.hypot(to[0] - from[0], to[2] - from[2])
      const traversed = Math.min(segmentLength, remaining)
      const steps = Math.max(1, Math.ceil(traversed / sampleSpacing))
      for (let step = 1; step <= steps; step += 1) {
        const distance = Math.min(traversed, step * sampleSpacing)
        const fraction = segmentLength > 0 ? distance / segmentLength : 1
        visitPoint(
          THREE.MathUtils.lerp(from[0], to[0], fraction),
          THREE.MathUtils.lerp(from[2], to[2], fraction)
        )
      }
      remaining -= traversed
      from = to
    }
    this.routePinnedCellId ??= fallbackPinnedId
    this.enforceResidencyLimits()
    return [...requested].sort()
  }

  prefetchDirection(
    x: number,
    z: number,
    directionX: number,
    directionZ: number,
    distance = this.manifest.world.cellSize * 1.35
  ) {
    const length = Math.hypot(directionX, directionZ)
    if (length <= 1e-6) return [] as string[]
    const route: Vec3[] = [
      [x, 0, z],
      [
        x + (directionX / length) * distance,
        0,
        z + (directionZ / length) * distance,
      ],
    ]
    return this.prefetchRoute(route, 0, distance)
  }

  clearRoutePrefetch() {
    this.routePinnedCellId = null
  }

  hasStreamedSurfaceAt(x: number, z: number) {
    const matching = this.cellsAt(x, z, 0.02)
    return matching.length > 0 && matching.some((cell) => cell.loaded)
  }

  private createStaticMesh(geometryId: string) {
    const definition = this.registry.geometryDefinition(geometryId)
    if (!definition) return null
    const mesh = new THREE.Mesh(
      this.registry.geometry(geometryId),
      this.registry.material(definition.materialId)
    )
    mesh.name = geometryId
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    mesh.receiveShadow = true
    mesh.castShadow = false
    if (isJourneyLine(definition.kind, definition.id)) mesh.renderOrder = 4
    return mesh
  }

  private canopyGeometryProfile(geometryId: string) {
    if (this.canopyGeometryProfiles.has(geometryId)) {
      return this.canopyGeometryProfiles.get(geometryId) ?? null
    }
    const geometry = this.registry.geometry(geometryId)
    const positions = geometry.getAttribute("position")
    if (!positions || positions.count === 0) {
      this.canopyGeometryProfiles.set(geometryId, null)
      return null
    }
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox
    if (!bounds) {
      this.canopyGeometryProfiles.set(geometryId, null)
      return null
    }
    const center = bounds.getCenter(new THREE.Vector3())
    let radiusXZ = 0
    let radiusY = 0
    for (let index = 0; index < positions.count; index += 1) {
      radiusXZ = Math.max(
        radiusXZ,
        Math.hypot(
          positions.getX(index) - center.x,
          positions.getZ(index) - center.z
        )
      )
      radiusY = Math.max(radiusY, Math.abs(positions.getY(index) - center.y))
    }
    const profile = {
      center,
      radiusXZ,
      radiusY,
    }
    this.canopyGeometryProfiles.set(geometryId, profile)
    return profile
  }

  private createInstancedMesh(batch: RuntimeInstanceBatch) {
    const maximumCount = batch.transforms.length
    if (maximumCount === 0) return null
    const mesh = new THREE.InstancedMesh(
      this.registry.geometry(batch.geometryId),
      this.registry.material(batch.materialId),
      maximumCount
    )
    mesh.name = batch.id
    mesh.castShadow = false
    mesh.receiveShadow = true
    const canopyProfile =
      batch.kind === "tree-canopy"
        ? this.canopyGeometryProfile(batch.geometryId)
        : null
    const cameraOccluders: CameraOccluderVolume[] = []

    const order = batch.transforms.map((_, index) => index)
    if (batch.densityRanks?.length === maximumCount) {
      order.sort(
        (first, second) =>
          (batch.densityRanks?.[first] ?? first / maximumCount) -
          (batch.densityRanks?.[second] ?? second / maximumCount)
      )
    }
    order.forEach((sourceIndex, index) => {
      const transform = batch.transforms[sourceIndex]
      this.instancePosition.set(transform[0], transform[1], transform[2])
      this.instanceQuaternion.setFromAxisAngle(this.yAxis, transform[3])
      this.instanceScale.set(transform[4], transform[5], transform[6])
      this.instanceMatrix.compose(
        this.instancePosition,
        this.instanceQuaternion,
        this.instanceScale
      )
      mesh.setMatrixAt(index, this.instanceMatrix)
      if (canopyProfile) {
        this.instanceOccluderCenter
          .copy(canopyProfile.center)
          .applyMatrix4(this.instanceMatrix)
        cameraOccluders.push({
          centerX: this.instanceOccluderCenter.x,
          centerY: this.instanceOccluderCenter.y,
          centerZ: this.instanceOccluderCenter.z,
          radiusXZ: Math.max(
            0.45,
            canopyProfile.radiusXZ *
              Math.max(Math.abs(transform[4]), Math.abs(transform[6])) +
              0.18
          ),
          radiusY: Math.max(
            0.35,
            canopyProfile.radiusY * Math.abs(transform[5]) + 0.12
          ),
        })
      }
      const color = batch.colors?.[sourceIndex]
      if (color) mesh.setColorAt(index, new THREE.Color(color))
    })
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.StaticDrawUsage)
      mesh.instanceColor.needsUpdate = true
    }
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    return {
      mesh,
      maximumCount,
      kind: batch.kind,
      lod: batch.lod ?? null,
      cameraOccluders,
    }
  }

  private applyDetailBand(cell: CellState, band: DetailBand) {
    cell.detailBand = band
    if (cell.wayfindingLabel) {
      cell.wayfindingLabel.mesh.visible =
        this.quality === "low" ? band === "near" : band !== "far"
    }
    const qualityDensity =
      JOURNEY_V2_QUALITY[this.quality].grassDensity * this.adaptiveDensityScale
    const bandDensity = band === "near" ? 1 : band === "mid" ? 0.58 : 0.24
    for (const entry of cell.densityMeshes) {
      const matchesLod = entry.lod === null || entry.lod === band
      const isVegetation =
        isGrass(entry.kind) ||
        entry.kind.toLowerCase().includes("shrub") ||
        entry.kind.toLowerCase().includes("tree")
      const adaptiveVisible =
        !isVegetation || band !== "far" || this.adaptiveDensityScale >= 0.46
      entry.mesh.visible = matchesLod && adaptiveVisible
      if (!matchesLod || !adaptiveVisible) continue
      if (!isVegetation) {
        entry.mesh.count = entry.maximumCount
        continue
      }
      const environmentDensity =
        isGrass(entry.kind) || entry.kind.includes("shrub")
          ? qualityDensity * bandDensity
          : Math.max(0.42, qualityDensity) *
            (band === "far" ? 0.62 : band === "mid" ? 0.82 : 1)
      entry.mesh.count = Math.max(
        entry.maximumCount > 0 ? 1 : 0,
        Math.ceil(entry.maximumCount * environmentDensity)
      )
    }
  }

  private detailBandAt(cell: CellState, x: number, z: number): DetailBand {
    const distance = distanceToBounds(x, z, cell.definition.bounds)
    return distance <= this.manifest.world.cellSize * 0.38
      ? "near"
      : distance <= this.manifest.world.cellSize * 1.15
        ? "mid"
        : "far"
  }

  private detailMesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    transforms: DetailTransform[]
  ) {
    if (transforms.length === 0) return null
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = true
    transforms.forEach((transform, index) => {
      this.instanceQuaternion.setFromAxisAngle(this.yAxis, transform.rotationY)
      this.instanceMatrix.compose(
        transform.position,
        this.instanceQuaternion,
        transform.scale
      )
      mesh.setMatrixAt(index, this.instanceMatrix)
    })
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    return mesh
  }

  /**
   * Legacy V2 compatibility details. V3 archetypes compile their own facade
   * language so semantic buildings keep distinct silhouettes and thresholds.
   */
  private createBuildingDetails(cellId: string, buildings: BuildingLike[]) {
    const hipRoofs: DetailTransform[] = []
    const flatRoofs: DetailTransform[] = []
    const windows: DetailTransform[] = []
    const doors: DetailTransform[] = []
    const hippedStyles = new Set([
      "residential",
      "school",
      "college",
      "pavilion",
      "civic",
    ])

    for (const building of buildings) {
      if (building.cellId !== cellId || building.footprint.length < 4) continue
      // V3 buildings compile their semantic silhouette, glazing rhythm, and
      // threshold details into the world package. Applying the legacy facade
      // stamp here would make a school, clinic, workshop, and pavilion read as
      // the same generic house again.
      if (building.archetype) continue
      const buildingStyle = building.style ?? building.family ?? ""
      const baseHeight = building.baseHeight ?? 0
      const hasHippedRoof =
        hippedStyles.has(buildingStyle) || buildingStyle.includes("hipped")
      const footprint = building.footprint
      const center = footprint.reduce((sum, point) => {
        sum.x += point[0] / footprint.length
        sum.y += point[1] / footprint.length
        return sum
      }, new THREE.Vector2())
      const first = footprint[0]
      const second = footprint[1]
      const fourth = footprint[footprint.length - 1]
      const width = Math.hypot(second[0] - first[0], second[1] - first[1])
      const depth = Math.hypot(fourth[0] - first[0], fourth[1] - first[1])
      const tangentX = (second[0] - first[0]) / (width || 1)
      const tangentZ = (second[1] - first[1]) / (width || 1)
      const rotationY = Math.atan2(-tangentZ, tangentX)

      const roofTransform: DetailTransform = {
        position: new THREE.Vector3(
          center.x,
          building.height + (hasHippedRoof ? 0.02 : 0.12),
          center.y
        ),
        rotationY,
        scale: new THREE.Vector3(
          width + 0.55,
          hasHippedRoof ? Math.min(2.2, depth * 0.24) : 0.24,
          depth + 0.55
        ),
      }
      // V3 building-kit packages already contain their code-authored roof.
      // V2 massing receives the small runtime roof compatibility detail.
      if (!building.family) {
        if (hasHippedRoof) hipRoofs.push(roofTransform)
        else flatRoofs.push(roofTransform)
      }

      let entranceEdgeIndex = 0
      let entranceEdgeDistance = Number.POSITIVE_INFINITY
      for (let edgeIndex = 0; edgeIndex < footprint.length; edgeIndex += 1) {
        const edgeStart = footprint[edgeIndex]
        const edgeEnd = footprint[(edgeIndex + 1) % footprint.length]
        const edgeX = edgeEnd[0] - edgeStart[0]
        const edgeZ = edgeEnd[1] - edgeStart[1]
        const edgeLengthSquared = edgeX * edgeX + edgeZ * edgeZ
        const fraction =
          edgeLengthSquared === 0
            ? 0
            : THREE.MathUtils.clamp(
                ((building.entrance[0] - edgeStart[0]) * edgeX +
                  (building.entrance[2] - edgeStart[1]) * edgeZ) /
                  edgeLengthSquared,
                0,
                1
              )
        const pointX = edgeStart[0] + edgeX * fraction
        const pointZ = edgeStart[1] + edgeZ * fraction
        const distance = Math.hypot(
          pointX - building.entrance[0],
          pointZ - building.entrance[2]
        )
        if (distance < entranceEdgeDistance) {
          entranceEdgeDistance = distance
          entranceEdgeIndex = edgeIndex
        }
      }

      for (let edgeIndex = 0; edgeIndex < footprint.length; edgeIndex += 1) {
        const edgeStart = footprint[edgeIndex]
        const edgeEnd = footprint[(edgeIndex + 1) % footprint.length]
        const edgeX = edgeEnd[0] - edgeStart[0]
        const edgeZ = edgeEnd[1] - edgeStart[1]
        const edgeLength = Math.hypot(edgeX, edgeZ)
        if (edgeLength < 2) continue
        const edgeTangentX = edgeX / edgeLength
        const edgeTangentZ = edgeZ / edgeLength
        const edgeCenterX = (edgeStart[0] + edgeEnd[0]) * 0.5
        const edgeCenterZ = (edgeStart[1] + edgeEnd[1]) * 0.5
        const outwardX = edgeCenterX - center.x
        const outwardZ = edgeCenterZ - center.y
        const outwardLength = Math.hypot(outwardX, outwardZ) || 1
        const edgeRotation = Math.atan2(-edgeTangentZ, edgeTangentX)
        const columns = Math.min(5, Math.max(1, Math.floor(edgeLength / 2.7)))
        const floors = building.height >= 6.8 ? 2 : 1

        for (let floor = 0; floor < floors; floor += 1) {
          const windowY =
            baseHeight + Math.min(building.height - 0.75, 2 + floor * 2.65)
          for (let column = 0; column < columns; column += 1) {
            const fraction = (column + 1) / (columns + 1)
            if (
              edgeIndex === entranceEdgeIndex &&
              floor === 0 &&
              Math.abs(fraction - 0.5) < 0.22
            ) {
              continue
            }
            windows.push({
              position: new THREE.Vector3(
                edgeStart[0] +
                  edgeX * fraction +
                  (outwardX / outwardLength) * 0.07,
                windowY,
                edgeStart[1] +
                  edgeZ * fraction +
                  (outwardZ / outwardLength) * 0.07
              ),
              rotationY: edgeRotation,
              scale: new THREE.Vector3(
                Math.min(1.25, edgeLength / (columns + 1) - 0.24),
                1.15,
                0.12
              ),
            })
          }
        }
      }

      const frontStart = footprint[entranceEdgeIndex]
      const frontEnd = footprint[(entranceEdgeIndex + 1) % footprint.length]
      const frontRotation = Math.atan2(
        -(frontEnd[1] - frontStart[1]),
        frontEnd[0] - frontStart[0]
      )
      doors.push({
        position: new THREE.Vector3(
          building.entrance[0],
          baseHeight + 1.18,
          building.entrance[2]
        ),
        rotationY: frontRotation,
        scale: new THREE.Vector3(1.12, 2.35, 0.16),
      })
    }

    return [
      this.detailMesh(
        `detail.hip-roofs.${cellId}`,
        this.detailHipRoof,
        this.detailMaterials.roof,
        hipRoofs
      ),
      this.detailMesh(
        `detail.flat-roofs.${cellId}`,
        this.detailBox,
        this.detailMaterials.roofFlat,
        flatRoofs
      ),
      this.detailMesh(
        `detail.windows.${cellId}`,
        this.detailBox,
        this.detailMaterials.window,
        windows
      ),
      this.detailMesh(
        `detail.doors.${cellId}`,
        this.detailBox,
        this.detailMaterials.door,
        doors
      ),
    ].filter((mesh) => mesh !== null)
  }

  private createBuildingWayfindingLabels(
    cellId: string,
    buildings: BuildingLike[]
  ) {
    if (!this.wayfindingAtlas) return null
    return createJourneyBuildingWayfindingMesh(
      buildings.filter((building) => building.cellId === cellId),
      this.wayfindingLabels,
      this.wayfindingAtlas
    )
  }

  private buildCell(cell: CellState) {
    if (cell.group) return cell.group
    if (!cell.loaded) {
      this.requestCellLoad(cell, false)
      return null
    }
    const group = new THREE.Group()
    group.name = cell.definition.id

    for (const geometryId of cell.definition.geometryIds) {
      const mesh = this.createStaticMesh(geometryId)
      if (mesh) group.add(mesh)
    }
    for (const batchId of cell.definition.batchIds) {
      const batch = this.batches.get(batchId)
      if (!batch) continue
      const instance = this.createInstancedMesh(batch)
      if (!instance) continue
      group.add(instance.mesh)
      cell.densityMeshes.push(instance)
    }
    for (const detail of this.createBuildingDetails(
      cell.definition.id,
      cell.buildings
    )) {
      group.add(detail)
    }
    cell.wayfindingLabel = this.createBuildingWayfindingLabels(
      cell.definition.id,
      cell.buildings
    )
    if (cell.wayfindingLabel) group.add(cell.wayfindingLabel.mesh)

    this.applyDetailBand(cell, cell.detailBand)
    group.visible = false
    group.matrixAutoUpdate = false
    group.updateMatrix()
    this.root.add(group)
    cell.group = group
    cell.lastResidentUse = ++this.residentSequence
    return group
  }

  registerCellAsset(asset: CellAssetLike) {
    const cell = this.cells.get(asset.cell.id)
    if (!cell || cell.loaded) return false
    this.registry.registerGeometries(asset.geometries)
    for (const batch of asset.instanceBatches) this.batches.set(batch.id, batch)
    cell.definition = asset.cell
    cell.buildings =
      asset.environmentalBuildings ?? asset.buildings ?? cell.buildings
    cell.loaded = true
    cell.loadingRequested = false
    cell.lastStreamUse = ++this.streamSequence
    if (cell.active) {
      cell.detailBand = this.detailBandAt(
        cell,
        this.lastVisibilityX,
        this.lastVisibilityZ
      )
      const group = this.buildCell(cell)
      if (group) group.visible = true
    }
    this.enforceResidencyLimits()
    return true
  }

  private disposeCellGroup(cell: CellState) {
    const group = cell.group
    if (!group) return
    cell.wayfindingLabel?.dispose()
    cell.wayfindingLabel = null
    group.removeFromParent()
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose()
    })
    this.registry.releaseCellGeometries(cell.definition.geometryIds)
    cell.group = null
    cell.densityMeshes = []
  }

  private protectedCellIds() {
    const protectedIds = new Set(this.activeCellIds)
    for (const id of this.playerPinnedCellIds) protectedIds.add(id)
    if (this.routePinnedCellId) protectedIds.add(this.routePinnedCellId)
    return protectedIds
  }

  private releaseCellData(cell: CellState) {
    if (!cell.loaded || cell.active || !this.onCellRequired) return
    this.disposeCellGroup(cell)
    for (const batchId of cell.definition.batchIds) this.batches.delete(batchId)
    this.registry.unregisterCellGeometries(cell.definition.geometryIds)
    cell.buildings = []
    cell.loaded = false
    cell.loadingRequested = false
    cell.prefetched = false
    this.onCellReleased?.(cell.definition.id)
  }

  private enforceResidencyLimits() {
    const limits = JOURNEY_CELL_LIMITS[this.quality]
    const protectedIds = this.protectedCellIds()
    const residents = [...this.cells.values()].filter((cell) => cell.group)
    if (residents.length > limits.gpuResident) {
      const candidates = residents
        .filter((cell) => !protectedIds.has(cell.definition.id))
        .sort(
          (first, second) =>
            first.lastResidentUse - second.lastResidentUse ||
            first.definition.id.localeCompare(second.definition.id)
        )
      let residentCount = residents.length
      for (const cell of candidates) {
        if (residentCount <= limits.gpuResident) break
        this.disposeCellGroup(cell)
        residentCount -= 1
      }
    }

    if (!this.onCellRequired) return
    const streamed = [...this.cells.values()].filter((cell) => cell.loaded)
    if (streamed.length <= limits.streamed) return
    const releaseCandidates = streamed
      .filter(
        (cell) =>
          !protectedIds.has(cell.definition.id) &&
          !cell.active &&
          !cell.loadingRequested
      )
      .sort(
        (first, second) =>
          first.lastStreamUse - second.lastStreamUse ||
          first.definition.id.localeCompare(second.definition.id)
      )
    let streamedCount = streamed.length
    for (const cell of releaseCandidates) {
      if (streamedCount <= limits.streamed) break
      this.releaseCellData(cell)
      streamedCount -= 1
    }
  }

  updateVisibility(x: number, z: number, force = false) {
    const movementSinceUpdate = Math.hypot(
      x - this.lastVisibilityX,
      z - this.lastVisibilityZ
    )
    if (!force && movementSinceUpdate < 2.5) return null

    this.lastVisibilityX = x
    this.lastVisibilityZ = z
    const radius = JOURNEY_V2_QUALITY[this.quality].activeCellRadius
    const enterDistance = (radius + 0.15) * this.manifest.world.cellSize
    const exitDistance = (radius + 0.72) * this.manifest.world.cellSize
    const limits = JOURNEY_CELL_LIMITS[this.quality]
    let changed = false

    this.playerPinnedCellIds = new Set(
      this.cellsAt(x, z, 0.025).map((cell) => cell.definition.id)
    )
    if (this.playerPinnedCellIds.size === 0) {
      const nearest = this.nearestCell(x, z)
      if (nearest) this.playerPinnedCellIds.add(nearest.definition.id)
    }

    const candidates = [...this.cells.values()]
      .map((cell) => ({
        cell,
        distance: distanceToBounds(x, z, cell.definition.bounds),
        containsPlayer: this.playerPinnedCellIds.has(cell.definition.id),
      }))
      .filter(
        ({ cell, distance, containsPlayer }) =>
          containsPlayer ||
          distance <= (cell.active ? exitDistance : enterDistance)
      )
      .sort(
        (first, second) =>
          Number(second.containsPlayer) - Number(first.containsPlayer) ||
          first.distance - second.distance ||
          first.cell.definition.id.localeCompare(second.cell.definition.id)
      )
    const desiredIds = new Set(
      candidates.slice(0, limits.active).map(({ cell }) => cell.definition.id)
    )

    for (const cell of this.cells.values()) {
      const shouldBeActive = desiredIds.has(cell.definition.id)
      if (shouldBeActive === cell.active) {
        if (shouldBeActive) {
          cell.lastStreamUse = ++this.streamSequence
          cell.prefetched = false
        }
        continue
      }
      cell.active = shouldBeActive
      const group = shouldBeActive ? this.buildCell(cell) : cell.group
      if (group) group.visible = shouldBeActive
      if (shouldBeActive) {
        cell.lastResidentUse = ++this.residentSequence
        cell.lastStreamUse = ++this.streamSequence
        cell.prefetched = false
        this.activeCellIds.add(cell.definition.id)
      } else {
        this.activeCellIds.delete(cell.definition.id)
      }
      changed = true
    }

    for (const cell of this.cells.values()) {
      if (!cell.active || !cell.group) continue
      const nextBand = this.detailBandAt(cell, x, z)
      if (nextBand !== cell.detailBand) this.applyDetailBand(cell, nextBand)
    }
    this.enforceResidencyLimits()

    return changed ? [...this.activeCellIds].sort() : null
  }

  getActiveCellIds() {
    return [...this.activeCellIds].sort()
  }

  cameraVegetationVisibilityFraction(from: THREE.Vector3, to: THREE.Vector3) {
    let visibleFraction = 1
    const minimumFraction = minimumSafeCameraFraction(from, to)
    for (const cell of this.cells.values()) {
      if (!cell.active || !cell.group?.visible) continue
      for (const entry of cell.densityMeshes) {
        if (
          !entry.mesh.visible ||
          entry.cameraOccluders.length === 0 ||
          entry.mesh.count === 0
        ) {
          continue
        }
        const visibleCount = Math.min(
          entry.mesh.count,
          entry.cameraOccluders.length
        )
        for (let index = 0; index < visibleCount; index += 1) {
          visibleFraction = Math.min(
            visibleFraction,
            cameraOccluderVisibilityFraction(
              from,
              to,
              entry.cameraOccluders[index]
            )
          )
          if (visibleFraction <= minimumFraction + 1e-4) {
            return visibleFraction
          }
        }
      }
    }
    return visibleFraction
  }

  getResidencyMetrics(): JourneyCellResidencyMetrics {
    const states = [...this.cells.values()]
    return {
      active: this.activeCellIds.size,
      gpuResident: states.filter((cell) => cell.group !== null).length,
      streamed: states.filter((cell) => cell.loaded).length,
      loading: states.filter((cell) => cell.loadingRequested && !cell.loaded)
        .length,
      prefetched: states.filter((cell) => cell.prefetched && !cell.active)
        .length,
      limits: JOURNEY_CELL_LIMITS[this.quality],
    }
  }

  updateMaterials(elapsed: number, reducedMotion: boolean) {
    this.registry.update(elapsed, reducedMotion)
    if (reducedMotion) return
    for (const animated of Object.values(this.detailAnimatedMaterials)) {
      animated.update(elapsed)
    }
  }

  dispose() {
    this.root.removeFromParent()
    for (const cell of this.cells.values()) this.disposeCellGroup(cell)
    this.cells.clear()
    this.batches.clear()
    this.activeCellIds.clear()
    this.canopyGeometryProfiles.clear()
    this.detailBox.dispose()
    this.detailHipRoof.dispose()
    for (const animated of Object.values(this.detailAnimatedMaterials)) {
      animated.material.dispose()
    }
    this.wayfindingAtlas?.dispose()
  }
}
