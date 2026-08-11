export type Vec2 = readonly [x: number, z: number]
export type Vec3 = readonly [x: number, y: number, z: number]
export type Bounds2 = readonly [
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
]

export type DistrictKind =
  | "about"
  | "education"
  | "career"
  | "learning"
  | "projects"
  | "community"
  | "contact"

export type LandmarkKind = "chronology" | "evidence" | "contact"
export type BuildingStyle =
  | "civic"
  | "school"
  | "college"
  | "campus"
  | "office"
  | "library"
  | "workshop"
  | "community"
  | "pavilion"
  | "residential"

export type InstanceTransform = readonly [
  x: number,
  y: number,
  z: number,
  rotationY: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
]

export interface MaterialDefinition {
  id: string
  kind: "standard" | "unlit"
  color: string
  roughness: number
}

export interface GeometryDefinition {
  id: string
  kind: "surface" | "building" | "primitive"
  materialId: string
  y: number
  positions: number[]
  indices: number[]
}

export interface DistrictManifest {
  id: string
  kind: DistrictKind
  order: number
  bounds: Bounds2
  cellIds: string[]
  landmarkIds: string[]
}

export interface CellManifest {
  id: string
  districtId: string
  bounds: Bounds2
  geometryIds: string[]
  batchIds: string[]
  colliderIds: string[]
}

export interface RoadManifest {
  id: string
  from: string
  to: string
  width: number
  centerline: Vec2[]
  surfaceGeometryIds: string[]
}

export interface InstanceBatch {
  id: string
  kind:
    | "tree-trunk"
    | "tree-canopy"
    | "grass"
    | "lamp"
    | "lane-marker"
    | "crosswalk-stripe"
  geometryId: string
  materialId: string
  cellId: string
  transforms: InstanceTransform[]
}

export interface CrosswalkManifest {
  id: string
  roadId: string
  polygon: Vec2[]
  center: Vec2
  rotationY: number
  width: number
  nodeIds: [string, string]
}

export interface LandmarkManifest {
  id: string
  title: string
  shortTitle: string
  districtId: string
  kind: LandmarkKind
  routeOrder: number
  position: Vec3
  entrance: Vec3
  buildingId: string | null
  navNodeId: string
}

export interface BuildingManifest {
  id: string
  landmarkId: string | null
  districtId: string
  cellId: string
  style: BuildingStyle
  footprint: Vec2[]
  height: number
  entrance: Vec3
  geometryId: string
  materialId: string
}

export interface ColliderManifest {
  id: string
  kind: "polygon"
  cellId: string
  polygon: Vec2[]
  minY: number
  maxY: number
}

export interface NavigationNode {
  id: string
  position: Vec3
  cellId: string
  kind: "sidewalk" | "entrance" | "crossing"
}

export interface NavigationEdge {
  a: string
  b: string
  cost: number
  kind: "sidewalk" | "entrance" | "crossing"
  portal?: readonly [Vec2, Vec2]
  crosswalkId?: string
}

export interface WorldManifest {
  schemaVersion: 2
  generatorVersion: string
  seed: number
  units: "metres"
  world: {
    bounds: Bounds2
    cellSize: number
    spawn: Vec3
  }
  materials: MaterialDefinition[]
  geometries: GeometryDefinition[]
  districts: DistrictManifest[]
  cells: CellManifest[]
  roads: RoadManifest[]
  features: {
    curbGeometryIds: string[]
    sidewalkGeometryIds: string[]
    accessGeometryIds: string[]
    journeyLine: {
      geometryIds: string[]
      points: Vec2[]
    }
    laneMarkers: InstanceBatch[]
    crosswalks: CrosswalkManifest[]
  }
  landmarks: LandmarkManifest[]
  buildings: BuildingManifest[]
  instanceBatches: InstanceBatch[]
  colliders: ColliderManifest[]
  navigation: {
    nodes: NavigationNode[]
    edges: NavigationEdge[]
    landmarkNodeIds: Record<string, string>
  }
  validation: {
    valid: boolean
    counts: Record<string, number>
    warnings: string[]
  }
}

export interface CellAssetReference {
  id: string
  districtId: string
  bounds: Bounds2
  assetPath: string
}

export interface WorldIndexManifest {
  schemaVersion: 2
  generatorVersion: string
  seed: number
  units: "metres"
  world: WorldManifest["world"]
  fullManifestAsset: string
  sharedAsset: string
  navigationAsset: string
  districts: DistrictManifest[]
  cells: CellAssetReference[]
  roads: RoadManifest[]
  landmarks: LandmarkManifest[]
  crosswalks: CrosswalkManifest[]
  journeyLinePoints: Vec2[]
}

export interface SharedWorldAsset {
  schemaVersion: 2
  materials: MaterialDefinition[]
  geometries: GeometryDefinition[]
}

export interface CellWorldAsset {
  schemaVersion: 2
  cell: CellManifest
  geometries: GeometryDefinition[]
  instanceBatches: InstanceBatch[]
  colliders: ColliderManifest[]
  buildings: BuildingManifest[]
}

export interface NavigationAsset {
  schemaVersion: 2
  navigation: WorldManifest["navigation"]
}

export interface AuthoredRoadNode {
  id: string
  position: Vec2
}

export interface AuthoredRoad {
  id: string
  from: string
  to: string
  width: number
  /**
   * Optional environmental turning bulb at the final road node. It makes a
   * finite road terminate intentionally instead of exposing a raw mesh edge.
   */
  endTurnaroundRadius?: number
  controlPoints: Vec2[]
  districtId: string
  journeyLine: boolean
}

export interface AuthoredCrosswalk {
  id: string
  roadId: string
  progress: number
  width: number
}

export interface AuthoredLandmark {
  id: string
  title: string
  shortTitle: string
  districtId: string
  kind: LandmarkKind
  routeOrder: number
  roadId: string
  roadProgress: number
  roadSide: -1 | 1
  setback: number
  footprint: readonly [width: number, depth: number]
  height: number
  style: BuildingStyle
}

export interface AuthoredDistrict {
  id: string
  kind: DistrictKind
  order: number
}

export interface AuthoredWorld {
  seed: number
  cellSize: number
  roadSampleSpacing: number
  sidewalkWidth: number
  curbWidth: number
  districts: readonly AuthoredDistrict[]
  nodes: readonly AuthoredRoadNode[]
  roads: readonly AuthoredRoad[]
  crosswalks: readonly AuthoredCrosswalk[]
  landmarks: readonly AuthoredLandmark[]
}

/**
 * Schema V3 is intentionally additive while the V2 runtime remains available
 * as a rollback path. V3 separates portfolio content from environmental
 * scenery and serializes every code-authored surface needed by the browser.
 */
export type WorldScopeV3 = "vertical-slice" | "complete"
export type TerrainBiomeV3 =
  | "settlement"
  | "meadow"
  | "riparian"
  | "wetland"
  | "coast"
export type WaterKindV3 = "ocean" | "river" | "pond"
export type VegetationLodV3 = "near" | "mid" | "far"
export type VegetationSpeciesV3 =
  | "broadleaf"
  | "palm"
  | "shrub"
  | "meadow-grass"
  | "river-grass"
  | "rock"
export type EnvironmentalBuildingFamilyV3 =
  | "homestead-gable"
  | "homestead-hipped"
  | "tin-roof-cottage"
export type EnvironmentalBuildingArchetypeV3 =
  | "town-pavilion"
  | "schoolhouse"
  | "academic-hall"
  | "engineering-campus"
  | "tech-office"
  | "service-centre"
  | "software-studio"
  | "health-clinic"
  | "reading-room"
  | "maker-workshop"
  | "community-hall"
  | "garden-pavilion"

export interface MaterialDefinitionV3 {
  id: string
  kind: "standard" | "unlit" | "toon" | "water"
  color: string
  roughness: number
  vertexColors: boolean
  /** Code-only water flow parameters; ignored by non-water materials. */
  flowDirection?: Vec2
  flowSpeed?: number
  flowStrength?: number
}

export interface GeometryDefinitionV3 {
  id: string
  kind: "surface" | "building" | "primitive" | "terrain" | "water" | "bridge"
  materialId: string
  y: number
  positions: number[]
  indices: number[]
  /**
   * Explicit traversal ownership for compound environmental geometry. When
   * omitted, the runtime retains its legacy kind/id inference.
   */
  walkable?: boolean
  /** RGB floats, one triplet for each serialized position. */
  colors?: number[]
}

/**
 * Stable shared-asset identifiers for the visual-only, non-streamed landscape
 * proxy. Keeping these in the contract lets the compiler, serializer and
 * browser runtime agree without importing build-only generator modules.
 */
export const FAR_LANDSCAPE_GEOMETRY_ID_V3 =
  "environment.far-landscape.v3" as const
export const FAR_LANDSCAPE_MATERIAL_ID_V3 = "environment.far-landscape" as const

export interface PortfolioRecordManifestV3 {
  recordId: string
  districtId: string
  routeOrder: number
}

export interface PortfolioCheckpointManifestV3 {
  id: string
  recordId: string
  arrivalBuildingId: string
  districtId: string
  roadId: string
  position: Vec3
  interactionRadius: number
  navNodeId: string
  approachGeometryIds: string[]
  sharedRoadBoundary: readonly [Vec3, Vec3]
}

export interface TerrainTileManifestV3 {
  id: string
  cellId: string
  bounds: Bounds2
  resolution: readonly [columns: number, rows: number]
  sampleSpacing: number
  heights: number[]
  minHeight: number
  maxHeight: number
  geometryId: string
  checksum: string
}

export interface WaterBodyManifestV3 {
  id: string
  kind: WaterKindV3
  /** A single outer ring or an outer ring followed by non-water island holes. */
  polygon: Vec2[] | Vec2[][]
  waterLevel: number
  flowDirection: Vec2
  flowSpeed: number
  flowStrength: number
  geometryIds: string[]
  walkable: false
}

export interface BridgeManifestV3 {
  id: string
  roadId: string
  waterBodyId: string
  center: Vec3
  tangent: Vec2
  width: number
  length: number
  /** Highest point on the deck, retained for legacy flat-deck consumers. */
  deckHeight: number
  /** Sampled longitudinal travel profile used by roads and navigation. */
  deckCenterline?: Vec3[]
  /** Height above the smooth bank-to-bank baseline at the crown. */
  crownRise?: number
  deckThickness?: number
  deckPolygon: Vec2[]
  geometryIds: string[]
  railColliderIds: readonly [string, string]
  navNodeIds: readonly [string, string]
  walkable: true
}

export interface BiomeZoneManifestV3 {
  id: string
  kind: TerrainBiomeV3
  polygon: Vec2[]
  treeDensity: number
  grassDensity: number
}

export interface EnvironmentalBuildingManifestV3 {
  id: string
  family: EnvironmentalBuildingFamilyV3
  archetype: EnvironmentalBuildingArchetypeV3
  districtId: string
  cellId: string
  footprint: Vec2[]
  baseHeight: number
  height: number
  entrance: Vec3
  rotationY: number
  geometryIds: string[]
  materialIds: string[]
}

export interface InstanceBatchV3 {
  id: string
  kind: "tree-trunk" | "tree-canopy" | "grass" | "shrub" | "rock" | "lamp"
  speciesId: VegetationSpeciesV3 | "infrastructure"
  lod: VegetationLodV3
  geometryId: string
  materialId: string
  cellId: string
  transforms: InstanceTransform[]
  /** Stable [0,1] ranks allow deterministic quality-tier thinning. */
  densityRanks: number[]
  /** Per-instance CSS hex colors in transform order. */
  colors: string[]
}

export interface RoadManifestV3 {
  id: string
  from: string
  to: string
  width: number
  endTurnaroundRadius?: number
  centerline: Vec3[]
  surfaceGeometryIds: string[]
  sharedJunctionIds: string[]
}

export interface AccessJunctionManifestV3 {
  id: string
  buildingId: string
  roadId: string
  /** The exact road-edge endpoints reused by the access surface. */
  sharedBoundary: readonly [Vec3, Vec3]
  surfaceGeometryIds: string[]
  navigationEdgeIds: string[]
}

export interface NavigationNodeV3 {
  id: string
  position: Vec3
  cellId: string
  kind: "road" | "access" | "checkpoint" | "bridge"
  walkableSurfaceId: string
}

export interface NavigationEdgeV3 {
  id: string
  a: string
  b: string
  cost: number
  kind: "road" | "access" | "checkpoint" | "bridge"
  waterOverrideBridgeId?: string
}

export interface CellManifestV3 {
  id: string
  districtId: string
  bounds: Bounds2
  terrainTileId: string
  geometryIds: string[]
  batchIds: string[]
  colliderIds: string[]
  waterBodyIds: string[]
  bridgeIds: string[]
  environmentalBuildingIds: string[]
  checksum: string
}

export interface WorldManifestV3 {
  schemaVersion: 3
  generatorVersion: string
  checksum: string
  seed: number
  units: "metres"
  scope: WorldScopeV3
  world: {
    bounds: Bounds2
    cellSize: number
    spawn: Vec3
    heightRange: readonly [minimum: number, maximum: number]
    waterLevel: number
  }
  materials: MaterialDefinitionV3[]
  geometries: GeometryDefinitionV3[]
  cells: CellManifestV3[]
  roads: RoadManifestV3[]
  accessJunctions: AccessJunctionManifestV3[]
  portfolioRecords: PortfolioRecordManifestV3[]
  checkpoints: PortfolioCheckpointManifestV3[]
  terrain: {
    sampleSpacing: number
    tiles: TerrainTileManifestV3[]
  }
  waterBodies: WaterBodyManifestV3[]
  bridges: BridgeManifestV3[]
  biomes: BiomeZoneManifestV3[]
  environmentalBuildings: EnvironmentalBuildingManifestV3[]
  instanceBatches: InstanceBatchV3[]
  colliders: ColliderManifest[]
  navigation: {
    nodes: NavigationNodeV3[]
    edges: NavigationEdgeV3[]
    checkpointNodeIds: Record<string, string>
  }
  validation: {
    valid: boolean
    counts: Record<string, number>
    warnings: string[]
  }
}

export interface CellAssetReferenceV3 {
  id: string
  districtId: string
  bounds: Bounds2
  checksum: string
  assetPath: string
}

export interface WorldIndexManifestV3 {
  schemaVersion: 3
  generatorVersion: string
  checksum: string
  seed: number
  units: "metres"
  scope: WorldScopeV3
  world: WorldManifestV3["world"]
  fullManifestAsset: string
  sharedAsset: string
  sharedAssetChecksum: string
  navigationAsset: string
  navigationAssetChecksum: string
  cells: CellAssetReferenceV3[]
  roads: RoadManifestV3[]
  portfolioRecords: PortfolioRecordManifestV3[]
  checkpoints: PortfolioCheckpointManifestV3[]
  waterBodies: WaterBodyManifestV3[]
  bridges: BridgeManifestV3[]
}

export interface SharedWorldAssetV3 {
  schemaVersion: 3
  generatorVersion: string
  checksum: string
  materials: MaterialDefinitionV3[]
  geometries: GeometryDefinitionV3[]
}

export interface CellWorldAssetV3 {
  schemaVersion: 3
  generatorVersion: string
  checksum: string
  cell: CellManifestV3
  geometries: GeometryDefinitionV3[]
  terrainTiles: TerrainTileManifestV3[]
  instanceBatches: InstanceBatchV3[]
  colliders: ColliderManifest[]
  environmentalBuildings: EnvironmentalBuildingManifestV3[]
  waterBodies: WaterBodyManifestV3[]
  bridges: BridgeManifestV3[]
}

export interface NavigationAssetV3 {
  schemaVersion: 3
  generatorVersion: string
  checksum: string
  navigation: WorldManifestV3["navigation"]
}

export interface AuthoredWaterBodyV3 {
  id: string
  kind: WaterKindV3
  centerline?: readonly Vec2[]
  width?: number
  polygon?: readonly Vec2[]
  islands?: readonly (readonly Vec2[])[]
  waterLevel: number
  flowDirection: Vec2
  flowSpeed: number
  flowStrength: number
  /**
   * Optional bridge-only translation in metres. Positive values move every
   * derived crossing to the left of its entry-to-exit travel tangent while
   * leaving the authored water and road fixed.
   */
  bridgeLateralOffset?: number
  /**
   * Dry bridge-deck overhang on each bank, expressed as a multiple of the
   * connected road width. Use a compact value when the bank road has already
   * converged on the crossing tangent.
   */
  bridgeDryLandingFactor?: number
}

export interface AuthoredBiomeZoneV3 {
  id: string
  kind: TerrainBiomeV3
  polygon: readonly Vec2[]
  treeDensity: number
  grassDensity: number
}

export interface AuthoredCheckpointV3 {
  id: string
  recordId: string
  districtId: string
  roadId: string
  /**
   * Spatial-only visual anchor. The runtime keeps this relationship so it can
   * join canonical DOM wayfinding copy without serializing Portfolio Records
   * into environmental buildings.
   */
  arrivalBuildingId: string
  roadProgress: number
  roadSide: -1 | 1
  offset: number
  interactionRadius: number
}

export interface AuthoredEnvironmentalBuildingV3 {
  id: string
  family: EnvironmentalBuildingFamilyV3
  archetype: EnvironmentalBuildingArchetypeV3
  districtId: string
  roadId: string
  roadProgress: number
  roadSide: -1 | 1
  setback: number
  footprint: readonly [width: number, depth: number]
  storeys: 1 | 2
}

export interface AuthoredWorldV3 {
  schemaVersion: 3
  scope: WorldScopeV3
  seed: number
  bounds: Bounds2
  cellSize: number
  terrainSampleSpacing: number
  roadSampleSpacing: number
  waterLevel: number
  spawn: Vec2
  districts: readonly AuthoredDistrict[]
  nodes: readonly AuthoredRoadNode[]
  roads: readonly AuthoredRoad[]
  portfolioRecords: readonly PortfolioRecordManifestV3[]
  checkpoints: readonly AuthoredCheckpointV3[]
  waterBodies: readonly AuthoredWaterBodyV3[]
  biomes: readonly AuthoredBiomeZoneV3[]
  environmentalBuildings: readonly AuthoredEnvironmentalBuildingV3[]
}
