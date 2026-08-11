import {
  JOURNEY_V2_QUALITY,
  type JourneyV2Quality,
} from "@/lib/journey-v2/design"
import type {
  CellWorldAsset,
  CellWorldAssetV3,
  NavigationAsset,
  NavigationAssetV3,
  SharedWorldAsset,
  SharedWorldAssetV3,
  WorldIndexManifest,
  WorldIndexManifestV3,
} from "@/lib/journey-v2/contracts/world"
import { checksumJson } from "@/lib/journey-v2/generator/checksum"
import { JOURNEY_CELL_LIMITS } from "@/lib/journey-v2/runtime/streaming-policy"
import type { JourneyWorldManifest } from "@/lib/journey-v2/runtime/types"

const NEXT_WORLD_URL = "/journey-v2/generated-next/index.json"
const LEGACY_WORLD_URL = "/journey-v2/generated/index.json"
const DEFAULT_WORLD_URL = NEXT_WORLD_URL
type JourneyCellAsset = CellWorldAsset | CellWorldAssetV3
type JourneyIndexAsset = WorldIndexManifest | WorldIndexManifestV3
type JourneySharedAsset = SharedWorldAsset | SharedWorldAssetV3
type JourneyNavigationAsset = NavigationAsset | NavigationAssetV3
type JourneyChecksummedAsset =
  | WorldIndexManifestV3
  | SharedWorldAssetV3
  | NavigationAssetV3
  | CellWorldAssetV3

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  )
}

async function fetchJson(
  url: string,
  signal?: AbortSignal,
  cache: RequestCache = "force-cache"
) {
  const response = await fetch(url, {
    cache,
    signal,
  })
  if (!response.ok) {
    throw new Error(
      `Journey asset could not be loaded (${response.status} ${response.statusText})`
    )
  }
  return (await response.json()) as unknown
}

export function assertJourneyWorldManifest(
  value: unknown
): asserts value is JourneyWorldManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Journey world manifest is not an object")
  }

  const manifest = value as Partial<JourneyWorldManifest>
  if (manifest.schemaVersion !== 2 && manifest.schemaVersion !== 3) {
    throw new Error(
      `Journey world schema ${String(manifest.schemaVersion)} is unsupported`
    )
  }
  if (manifest.units !== "metres") {
    throw new Error("Journey world coordinates must use metres")
  }
  if (
    !manifest.world ||
    !isFiniteTuple(manifest.world.bounds, 4) ||
    !isFiniteTuple(manifest.world.spawn, 3) ||
    !Number.isFinite(manifest.world.cellSize) ||
    manifest.world.cellSize <= 0
  ) {
    throw new Error("Journey world bounds, spawn, or cell size are invalid")
  }

  const commonArrays: Array<[string, unknown]> = [
    ["materials", manifest.materials],
    ["geometries", manifest.geometries],
    ["cells", manifest.cells],
    ["roads", manifest.roads],
    ["instanceBatches", manifest.instanceBatches],
    ["colliders", manifest.colliders],
  ]
  for (const [label, array] of commonArrays) {
    if (!Array.isArray(array)) {
      throw new Error(`Journey world ${label} must be an array`)
    }
  }

  if (manifest.schemaVersion === 3) {
    const v3 = manifest as Partial<
      Extract<JourneyWorldManifest, { schemaVersion: 3 }>
    >
    if (
      typeof v3.checksum !== "string" ||
      v3.checksum.length < 4 ||
      !Array.isArray(v3.checkpoints) ||
      !Array.isArray(v3.portfolioRecords) ||
      !Array.isArray(v3.environmentalBuildings) ||
      !Array.isArray(v3.waterBodies) ||
      !Array.isArray(v3.bridges) ||
      !v3.terrain ||
      !Array.isArray(v3.terrain.tiles) ||
      !v3.navigation ||
      !Array.isArray(v3.navigation.nodes) ||
      !Array.isArray(v3.navigation.edges)
    ) {
      throw new Error("Journey V3 world surfaces or navigation are incomplete")
    }
    if (
      v3.checkpoints.some(
        (checkpoint) =>
          !checkpoint ||
          typeof checkpoint !== "object" ||
          typeof (checkpoint as { arrivalBuildingId?: unknown })
            .arrivalBuildingId !== "string" ||
          (
            checkpoint as {
              arrivalBuildingId: string
            }
          ).arrivalBuildingId.trim().length === 0
      )
    ) {
      throw new Error("Journey V3 checkpoint arrival references are incomplete")
    }
    if (v3.validation?.valid === false) {
      throw new Error("Journey world failed build-time validation")
    }
    return
  }

  const v2 = manifest as Partial<
    Extract<JourneyWorldManifest, { schemaVersion: 2 }>
  >
  if (
    !Array.isArray(v2.districts) ||
    !Array.isArray(v2.landmarks) ||
    !Array.isArray(v2.buildings) ||
    !v2.features ||
    !Array.isArray(v2.features.curbGeometryIds) ||
    !Array.isArray(v2.features.sidewalkGeometryIds) ||
    !Array.isArray(v2.features.accessGeometryIds) ||
    !v2.features.journeyLine ||
    !Array.isArray(v2.features.journeyLine.geometryIds) ||
    !Array.isArray(v2.features.laneMarkers) ||
    !v2.navigation ||
    !Array.isArray(v2.navigation.nodes) ||
    !Array.isArray(v2.navigation.edges)
  ) {
    throw new Error("Journey world features or navigation are incomplete")
  }
  if (manifest.validation?.valid === false) {
    throw new Error("Journey world failed build-time validation")
  }
}

export function assertWorldIndex(
  value: unknown
): asserts value is JourneyIndexAsset {
  if (!value || typeof value !== "object") {
    throw new Error("Journey world index is not an object")
  }
  const index = value as Partial<JourneyIndexAsset>
  if (
    (index.schemaVersion !== 2 && index.schemaVersion !== 3) ||
    index.units !== "metres" ||
    !index.world ||
    !isFiniteTuple(index.world.bounds, 4) ||
    !isFiniteTuple(index.world.spawn, 3) ||
    !Array.isArray(index.cells) ||
    typeof index.sharedAsset !== "string" ||
    typeof index.navigationAsset !== "string"
  ) {
    throw new Error("Journey world index is incomplete")
  }
  if (
    index.schemaVersion === 2 &&
    (!Array.isArray(index.landmarks) ||
      !Array.isArray(index.districts) ||
      !Array.isArray(index.crosswalks))
  ) {
    throw new Error("Journey V2 world index is incomplete")
  }
  if (
    index.schemaVersion === 3 &&
    (typeof index.checksum !== "string" ||
      typeof index.sharedAssetChecksum !== "string" ||
      index.sharedAssetChecksum.length < 4 ||
      typeof index.navigationAssetChecksum !== "string" ||
      index.navigationAssetChecksum.length < 4 ||
      !Array.isArray(index.checkpoints) ||
      !Array.isArray(index.waterBodies) ||
      !Array.isArray(index.bridges))
  ) {
    throw new Error("Journey V3 world index is incomplete")
  }
  if (
    index.schemaVersion === 3 &&
    Array.isArray(index.checkpoints) &&
    index.checkpoints.some(
      (checkpoint) =>
        !checkpoint ||
        typeof checkpoint !== "object" ||
        typeof (checkpoint as { arrivalBuildingId?: unknown })
          .arrivalBuildingId !== "string" ||
        (
          checkpoint as {
            arrivalBuildingId: string
          }
        ).arrivalBuildingId.trim().length === 0
    )
  ) {
    throw new Error("Journey V3 checkpoint arrival references are incomplete")
  }
}

function assertSharedAsset(
  value: unknown
): asserts value is JourneySharedAsset {
  if (
    !value ||
    typeof value !== "object" ||
    ((value as JourneySharedAsset).schemaVersion !== 2 &&
      (value as JourneySharedAsset).schemaVersion !== 3) ||
    !Array.isArray((value as JourneySharedAsset).materials) ||
    !Array.isArray((value as JourneySharedAsset).geometries)
  ) {
    throw new Error("Journey shared asset is invalid")
  }
}

function assertNavigationAsset(
  value: unknown
): asserts value is JourneyNavigationAsset {
  if (
    !value ||
    typeof value !== "object" ||
    ((value as JourneyNavigationAsset).schemaVersion !== 2 &&
      (value as JourneyNavigationAsset).schemaVersion !== 3) ||
    !Array.isArray((value as JourneyNavigationAsset).navigation?.nodes) ||
    !Array.isArray((value as JourneyNavigationAsset).navigation?.edges)
  ) {
    throw new Error("Journey navigation asset is invalid")
  }
}

function assertCellAsset(value: unknown): asserts value is JourneyCellAsset {
  if (
    !value ||
    typeof value !== "object" ||
    ((value as JourneyCellAsset).schemaVersion !== 2 &&
      (value as JourneyCellAsset).schemaVersion !== 3) ||
    !(value as JourneyCellAsset).cell ||
    !Array.isArray((value as JourneyCellAsset).geometries) ||
    !Array.isArray((value as JourneyCellAsset).instanceBatches) ||
    !Array.isArray((value as JourneyCellAsset).colliders)
  ) {
    throw new Error("Journey cell asset is invalid")
  }
  if (
    (value as JourneyCellAsset).schemaVersion === 2 &&
    !Array.isArray((value as CellWorldAsset).buildings)
  ) {
    throw new Error("Journey V2 cell buildings are invalid")
  }
  if (
    (value as JourneyCellAsset).schemaVersion === 3 &&
    (!Array.isArray((value as CellWorldAssetV3).terrainTiles) ||
      !Array.isArray((value as CellWorldAssetV3).environmentalBuildings))
  ) {
    throw new Error("Journey V3 cell surfaces are invalid")
  }
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

export function selectInitialJourneyCellIds(
  cells: readonly {
    id: string
    bounds: readonly [number, number, number, number]
  }[],
  spawn: readonly [number, number, number],
  cellSize: number,
  quality: JourneyV2Quality
) {
  const distance =
    (JOURNEY_V2_QUALITY[quality].activeCellRadius + 0.18) * cellSize
  return cells
    .map((cell) => ({
      id: cell.id,
      distance: distanceToBounds(spawn[0], spawn[2], cell.bounds),
    }))
    .filter((cell) => cell.distance <= distance)
    .sort(
      (first, second) =>
        first.distance - second.distance || first.id.localeCompare(second.id)
    )
    .slice(0, JOURNEY_CELL_LIMITS[quality].active)
    .map((cell) => cell.id)
}

export interface JourneyWorldBootstrap {
  manifest: JourneyWorldManifest
  loadedCellIds: Set<string>
  loadCell: (cellId: string) => Promise<JourneyCellAsset>
}

function isGenerationConsistencyError(error: unknown) {
  if (!(error instanceof Error)) return false
  return [
    "checksum",
    "generator does not match",
    "schema does not match",
    "mixed generation",
  ].some((fragment) => error.message.toLowerCase().includes(fragment))
}

function versionedAssetUrl(path: string, version: string) {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}journey-generation=${encodeURIComponent(version)}`
}

function assertEmbeddedChecksum(asset: JourneyChecksummedAsset) {
  const expected = asset.checksum
  const actual = checksumJson({ ...asset, checksum: "" })
  if (actual !== expected) {
    throw new Error("Journey asset payload checksum is invalid")
  }
}

export function assertGenerationAgreement(
  index: JourneyIndexAsset,
  asset: JourneySharedAsset | JourneyNavigationAsset | JourneyCellAsset,
  expectedChecksum?: string,
  assetLabel = "cell"
) {
  if (asset.schemaVersion !== index.schemaVersion) {
    throw new Error("Journey asset schema does not match its world index")
  }
  if (
    index.schemaVersion === 3 &&
    asset.schemaVersion === 3 &&
    asset.generatorVersion !== index.generatorVersion
  ) {
    throw new Error("Journey asset generator does not match its world index")
  }
  if (asset.schemaVersion === 3) {
    assertEmbeddedChecksum(asset)
  }
  if (
    expectedChecksum &&
    asset.schemaVersion === 3 &&
    asset.checksum !== expectedChecksum
  ) {
    throw new Error(
      `Journey ${assetLabel} checksum does not match its world index`
    )
  }
}

/**
 * Loads only the world index, shared primitives, navigation, and the spawn
 * neighbourhood. The complete debug manifest is never fetched on the normal
 * path; remaining cells are requested by the runtime as the player approaches.
 */
async function loadJourneyWorldBootstrapAttempt(
  url = DEFAULT_WORLD_URL,
  quality: JourneyV2Quality,
  signal: AbortSignal | undefined,
  bootstrapAssetCache: RequestCache
): Promise<JourneyWorldBootstrap> {
  // The index is the mutable pointer to a generated deployment. It must never
  // come from a previous browser cache entry: all following assets are pinned
  // to its checksum and may have been replaced by a newer generation.
  const entry = await fetchJson(url, signal, "no-store")

  // A direct world.json remains useful for tests and local debugging.
  if (
    entry &&
    typeof entry === "object" &&
    Array.isArray((entry as Partial<JourneyWorldManifest>).materials)
  ) {
    assertJourneyWorldManifest(entry)
    const cellAssets = new Map<string, JourneyCellAsset>()
    if (entry.schemaVersion === 2) {
      for (const cell of entry.cells) {
        cellAssets.set(cell.id, {
          schemaVersion: 2,
          cell,
          geometries: entry.geometries.filter((geometry) =>
            cell.geometryIds.includes(geometry.id)
          ),
          instanceBatches: entry.instanceBatches.filter(
            (batch) => batch.cellId === cell.id
          ),
          colliders: entry.colliders.filter(
            (collider) => collider.cellId === cell.id
          ),
          buildings: entry.buildings.filter(
            (building) => building.cellId === cell.id
          ),
        })
      }
    } else {
      for (const cell of entry.cells) {
        cellAssets.set(cell.id, {
          schemaVersion: 3,
          generatorVersion: entry.generatorVersion,
          checksum: cell.checksum,
          cell,
          geometries: entry.geometries.filter((geometry) =>
            cell.geometryIds.includes(geometry.id)
          ),
          terrainTiles: entry.terrain.tiles.filter(
            (tile) => tile.cellId === cell.id
          ),
          instanceBatches: entry.instanceBatches.filter(
            (batch) => batch.cellId === cell.id
          ),
          colliders: entry.colliders.filter(
            (collider) => collider.cellId === cell.id
          ),
          environmentalBuildings: entry.environmentalBuildings.filter(
            (building) => building.cellId === cell.id
          ),
          waterBodies: entry.waterBodies.filter((water) =>
            cell.waterBodyIds.includes(water.id)
          ),
          bridges: entry.bridges.filter((bridge) =>
            cell.bridgeIds.includes(bridge.id)
          ),
        })
      }
    }
    return {
      manifest: entry,
      loadedCellIds: new Set(entry.cells.map((cell) => cell.id)),
      loadCell: async (cellId) => {
        const cell = cellAssets.get(cellId)
        if (!cell) throw new Error(`Journey cell "${cellId}" is missing`)
        return cell
      },
    }
  }

  assertWorldIndex(entry)
  const index = entry
  if (index.schemaVersion === 3) {
    assertEmbeddedChecksum(index)
  }
  const generationKey =
    index.schemaVersion === 3 ? index.checksum : index.generatorVersion
  const [sharedValue, navigationValue] = await Promise.all([
    fetchJson(
      versionedAssetUrl(index.sharedAsset, generationKey),
      signal,
      bootstrapAssetCache
    ),
    fetchJson(
      versionedAssetUrl(index.navigationAsset, generationKey),
      signal,
      bootstrapAssetCache
    ),
  ])
  assertSharedAsset(sharedValue)
  assertNavigationAsset(navigationValue)
  assertGenerationAgreement(
    index,
    sharedValue,
    index.schemaVersion === 3 ? index.sharedAssetChecksum : undefined,
    "shared asset"
  )
  assertGenerationAgreement(
    index,
    navigationValue,
    index.schemaVersion === 3 ? index.navigationAssetChecksum : undefined,
    "navigation asset"
  )

  const references = new Map(index.cells.map((cell) => [cell.id, cell]))
  interface CellPromiseEntry {
    promise: Promise<JourneyCellAsset>
    lastUse: number
    settled: boolean
  }
  const promises = new Map<string, CellPromiseEntry>()
  const promiseCacheLimit = JOURNEY_CELL_LIMITS[quality].gpuResident + 2
  let promiseSequence = 0
  let bootstrapLoading = true
  const prunePromises = () => {
    if (promises.size <= promiseCacheLimit) return
    const candidates = [...promises.entries()]
      .filter(([, entry]) => entry.settled)
      .sort(
        (first, second) =>
          first[1].lastUse - second[1].lastUse ||
          first[0].localeCompare(second[0])
      )
    for (const [cellId] of candidates) {
      if (promises.size <= promiseCacheLimit) break
      promises.delete(cellId)
    }
  }
  const loadCell = (cellId: string) => {
    const cached = promises.get(cellId)
    if (cached) {
      cached.lastUse = ++promiseSequence
      return cached.promise
    }
    const reference = references.get(cellId)
    if (!reference) {
      return Promise.reject(
        new Error(`Journey cell "${cellId}" is not in the world index`)
      )
    }
    const entry: CellPromiseEntry = {
      promise: Promise.resolve(null as never),
      lastUse: ++promiseSequence,
      settled: false,
    }
    const promise = fetchJson(
      versionedAssetUrl(reference.assetPath, generationKey),
      signal,
      bootstrapLoading ? bootstrapAssetCache : "force-cache"
    )
      .then((value) => {
        assertCellAsset(value)
        assertGenerationAgreement(
          index,
          value,
          "checksum" in reference ? reference.checksum : undefined
        )
        if (value.cell.id !== cellId) {
          throw new Error(`Journey cell package "${cellId}" has the wrong id`)
        }
        return value
      })
      .catch((error: unknown) => {
        promises.delete(cellId)
        throw error
      })
      .finally(() => {
        entry.settled = true
        prunePromises()
      })
    entry.promise = promise
    promises.set(cellId, entry)
    return promise
  }

  const initialIds = selectInitialJourneyCellIds(
    index.cells,
    index.world.spawn,
    index.world.cellSize,
    quality
  )
  const initialAssets = await Promise.all(initialIds.map(loadCell))
  bootstrapLoading = false
  let manifest: JourneyWorldManifest
  if (index.schemaVersion === 2) {
    if (
      sharedValue.schemaVersion !== 2 ||
      navigationValue.schemaVersion !== 2 ||
      initialAssets.some((asset) => asset.schemaVersion !== 2)
    ) {
      throw new Error("Journey V2 bootstrap contains a mixed generation")
    }
    const cells = initialAssets as CellWorldAsset[]
    const geometries = [
      ...sharedValue.geometries,
      ...cells.flatMap((asset) => asset.geometries),
    ]
    const instanceBatches = cells.flatMap((asset) => asset.instanceBatches)
    manifest = {
      schemaVersion: 2,
      generatorVersion: index.generatorVersion,
      seed: index.seed,
      units: "metres",
      world: index.world,
      materials: sharedValue.materials,
      geometries,
      districts: index.districts,
      cells: index.cells.map((reference) => {
        const loaded = cells.find((asset) => asset.cell.id === reference.id)
        return (
          loaded?.cell ?? {
            id: reference.id,
            districtId: reference.districtId,
            bounds: reference.bounds,
            geometryIds: [],
            batchIds: [],
            colliderIds: [],
          }
        )
      }),
      roads: index.roads,
      features: {
        curbGeometryIds: geometries
          .filter((geometry) => geometry.id.startsWith("surface.curb."))
          .map((geometry) => geometry.id),
        sidewalkGeometryIds: geometries
          .filter((geometry) => geometry.id.startsWith("surface.sidewalk."))
          .map((geometry) => geometry.id),
        accessGeometryIds: geometries
          .filter((geometry) => geometry.id.startsWith("surface.access."))
          .map((geometry) => geometry.id),
        journeyLine: {
          geometryIds: geometries
            .filter((geometry) =>
              geometry.id.startsWith("surface.journey-line.")
            )
            .map((geometry) => geometry.id),
          points: index.journeyLinePoints,
        },
        laneMarkers: instanceBatches.filter(
          (batch) => batch.kind === "lane-marker"
        ),
        crosswalks: index.crosswalks,
      },
      landmarks: index.landmarks,
      buildings: cells.flatMap((asset) => asset.buildings),
      instanceBatches,
      colliders: cells.flatMap((asset) => asset.colliders),
      navigation: navigationValue.navigation,
      validation: {
        valid: true,
        counts: {},
        warnings: [],
      },
    }
  } else {
    if (
      sharedValue.schemaVersion !== 3 ||
      navigationValue.schemaVersion !== 3 ||
      initialAssets.some((asset) => asset.schemaVersion !== 3)
    ) {
      throw new Error("Journey V3 bootstrap contains a mixed generation")
    }
    const cells = initialAssets as CellWorldAssetV3[]
    const geometries = [
      ...sharedValue.geometries,
      ...cells.flatMap((asset) => asset.geometries),
    ]
    const terrainTiles = cells.flatMap((asset) => asset.terrainTiles)
    manifest = {
      schemaVersion: 3,
      generatorVersion: index.generatorVersion,
      checksum: index.checksum,
      seed: index.seed,
      units: "metres",
      scope: index.scope,
      world: index.world,
      materials: sharedValue.materials,
      geometries,
      cells: index.cells.map((reference) => {
        const loaded = cells.find((asset) => asset.cell.id === reference.id)
        return (
          loaded?.cell ?? {
            id: reference.id,
            districtId: reference.districtId,
            bounds: reference.bounds,
            terrainTileId: "",
            geometryIds: [],
            batchIds: [],
            colliderIds: [],
            waterBodyIds: [],
            bridgeIds: [],
            environmentalBuildingIds: [],
            checksum: reference.checksum,
          }
        )
      }),
      roads: index.roads,
      accessJunctions: [],
      portfolioRecords: index.portfolioRecords,
      checkpoints: index.checkpoints,
      terrain: {
        sampleSpacing: terrainTiles[0]?.sampleSpacing ?? 1,
        tiles: terrainTiles,
      },
      waterBodies: index.waterBodies,
      bridges: index.bridges,
      biomes: [],
      environmentalBuildings: cells.flatMap(
        (asset) => asset.environmentalBuildings
      ),
      instanceBatches: cells.flatMap((asset) => asset.instanceBatches),
      colliders: cells.flatMap((asset) => asset.colliders),
      navigation: navigationValue.navigation,
      validation: {
        valid: true,
        counts: {},
        warnings: [],
      },
    }
  }
  assertJourneyWorldManifest(manifest)

  return {
    manifest,
    loadedCellIds: new Set(initialIds),
    loadCell,
  }
}

/**
 * Load one internally consistent generated world. A browser may briefly see
 * mixed files while a deployment propagates. Generation/checksum failures get
 * one bounded cache-bypassing retry; unrelated network and runtime failures do
 * not loop.
 */
export async function loadJourneyWorldBootstrap(
  url = DEFAULT_WORLD_URL,
  quality: JourneyV2Quality,
  signal?: AbortSignal
): Promise<JourneyWorldBootstrap> {
  try {
    return await loadJourneyWorldBootstrapAttempt(
      url,
      quality,
      signal,
      "force-cache"
    )
  } catch (error: unknown) {
    if (signal?.aborted || !isGenerationConsistencyError(error)) throw error
    return loadJourneyWorldBootstrapAttempt(url, quality, signal, "reload")
  }
}

export async function loadJourneyWorld(
  url = "/journey-v2/generated/world.json",
  signal?: AbortSignal
): Promise<JourneyWorldManifest> {
  const value = await fetchJson(url, signal, "no-store")
  assertJourneyWorldManifest(value)
  return value
}

export { DEFAULT_WORLD_URL, LEGACY_WORLD_URL, NEXT_WORLD_URL }
