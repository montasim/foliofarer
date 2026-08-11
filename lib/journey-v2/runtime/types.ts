import type { JourneyV2Quality } from "@/lib/journey-v2/design"
import type {
  CellManifest,
  CellManifestV3,
  ColliderManifest,
  GeometryDefinition,
  GeometryDefinitionV3,
  InstanceBatch,
  InstanceBatchV3,
  MaterialDefinition,
  MaterialDefinitionV3,
  NavigationEdge,
  NavigationEdgeV3,
  NavigationNode,
  NavigationNodeV3,
  WorldManifest,
  WorldManifestV3,
} from "@/lib/journey-v2/contracts/world"

export type { Bounds2, Vec2, Vec3 } from "@/lib/journey-v2/contracts/world"

export type JourneyWorldManifest = WorldManifest | WorldManifestV3
export type JourneyWorldMaterialDefinition =
  | MaterialDefinition
  | MaterialDefinitionV3
export type JourneyWorldGeometryDefinition =
  | GeometryDefinition
  | GeometryDefinitionV3
export type JourneyWorldInstanceBatch = InstanceBatch | InstanceBatchV3
export type JourneyWorldCellDefinition = CellManifest | CellManifestV3
export type JourneyWorldColliderDefinition = ColliderManifest
export type JourneyWorldNavigationNode = NavigationNode | NavigationNodeV3
export type JourneyWorldNavigationEdge = NavigationEdge | NavigationEdgeV3

export interface JourneyWorldMovementInput {
  x: number
  z: number
  run?: boolean
}

export interface NearbyLandmarkEvent {
  type: "nearby-landmark"
  id: string
  checkpointId?: string
  recordId?: string
  title?: string
  shortTitle?: string
  distance: number
}

export interface JourneyWorldPerformance {
  fps: number
  averageFrameMs: number
  p95FrameMs: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  dpr: number
  quality: JourneyV2Quality
}

export type JourneyWorldRuntimeEvent =
  | {
      type: "ready"
      schemaVersion: number
      generatorVersion: string
      landmarkCount: number
      checkpointCount?: number
    }
  | NearbyLandmarkEvent
  | {
      type: "landmark-left"
      id: string
    }
  | {
      type: "landmark-arrival"
      id: string
      distance: number
    }
  | {
      type: "assisted-complete"
      destinationId: string
    }
  | {
      type: "assisted-cancelled"
      destinationId: string | null
      reason: "manual-input" | "destination-changed" | "disabled"
    }
  | {
      type: "assisted-unavailable"
      destinationId: string
    }
  | {
      type: "cell-visibility"
      activeCellIds: string[]
    }
  | {
      type: "cell-load-failed"
      cellId: string
      message: string
      retryInMs: number
    }
  | {
      type: "performance"
      metrics: JourneyWorldPerformance
    }
  | {
      type: "context-lost" | "context-restored"
    }
  | {
      type: "error"
      message: string
    }

export interface JourneyWorldSnapshot {
  x: number
  y: number
  z: number
  heading: number
  moving: boolean
  nearestLandmarkId: string | null
  nearestDistance: number | null
  destinationId: string | null
  activeCellIds: string[]
  performance: JourneyWorldPerformance | null
}

export type JourneyWorldUnavailableReason =
  | "webgl-unavailable"
  | "initialization-failed"
  | "context-lost"

export interface JourneyWorldRuntimeOptions {
  paused: boolean
  reducedMotion: boolean
  quality: JourneyV2Quality
  destinationId: string | null
  assistedTravel: boolean
}

export interface JourneyWorldRuntimeCallbacks {
  onReady?: () => void
  onEvent?: (event: JourneyWorldRuntimeEvent) => void
  onSnapshot?: (snapshot: JourneyWorldSnapshot) => void
}
