export const JOURNEY_V2_PALETTE = {
  sky: "#5ea9e1",
  skyHaze: "#a3c8e3",
  cloud: "#f1e4c6",
  paper: "#f9f2e4",
  paperWarm: "#f2e5ca",
  sand: "#e3cea2",
  field: "#76ab88",
  fieldShadow: "#639873",
  ink: "#143d42",
  inkSoft: "#4f6865",
  route: "#c76343",
  routeShadow: "#9e5039",
  scrollTrack: "#e8dcc4",
  road: "#a8b0b0",
  roadEdge: "#5f6466",
  sidewalk: "#eadfc8",
  curb: "#f5ecd8",
  plaster: "#cbbfa6",
  plasterWarm: "#e0cda2",
  roof: "#94646b",
  roofSlate: "#5e728a",
  foliage: "#2c8365",
  foliageLight: "#639873",
  foliageDeep: "#113b42",
  trunk: "#71513a",
  water: "#5f9fc4",
  waterDeep: "#326f8f",
} as const

export type JourneyV2Quality = "high" | "balanced" | "low"

export interface JourneyV2QualitySignals {
  coarsePointer: boolean
  viewportWidth: number
  reducedMotion: boolean
  reducedData?: boolean
  saveData?: boolean
  effectiveConnectionType?: string
  deviceMemory?: number
  hardwareConcurrency?: number
}

/**
 * The optional world starts conservatively on mobile/coarse or resource-limited
 * devices. Desktop-class devices use the balanced tier; high remains an
 * explicit future opt-in rather than an optimistic automatic default.
 */
export function resolveJourneyV2Quality(
  signals: JourneyV2QualitySignals
): JourneyV2Quality {
  const constrainedConnection =
    signals.saveData === true ||
    signals.reducedData === true ||
    ["slow-2g", "2g", "3g"].includes(
      signals.effectiveConnectionType?.toLowerCase() ?? ""
    )
  const constrainedHardware =
    (signals.deviceMemory !== undefined && signals.deviceMemory <= 4) ||
    (signals.hardwareConcurrency !== undefined &&
      signals.hardwareConcurrency <= 4)
  const mobileOrCoarse =
    signals.coarsePointer || signals.viewportWidth < 768

  return signals.reducedMotion ||
    constrainedConnection ||
    constrainedHardware ||
    mobileOrCoarse
    ? "low"
    : "balanced"
}

export const JOURNEY_V2_QUALITY = {
  high: {
    maximumDpr: 1.5,
    minimumDpr: 1,
    activeCellRadius: 2,
    grassDensity: 1,
    rainDensity: 1,
    shadows: false,
  },
  balanced: {
    maximumDpr: 1.25,
    minimumDpr: 0.85,
    activeCellRadius: 1,
    grassDensity: 0.66,
    rainDensity: 0.6,
    shadows: false,
  },
  low: {
    maximumDpr: 1,
    minimumDpr: 0.75,
    activeCellRadius: 1,
    grassDensity: 0.33,
    rainDensity: 0,
    shadows: false,
  },
} as const satisfies Record<
  JourneyV2Quality,
  {
    maximumDpr: number
    minimumDpr: number
    activeCellRadius: number
    grassDensity: number
    rainDensity: number
    shadows: boolean
  }
>

export const JOURNEY_V2_PERFORMANCE_BUDGETS = {
  desktopDrawCalls: 100,
  mobileDrawCalls: 70,
  desktopP95FrameMs: 20,
  mobileP95FrameMs: 33.3,
  maximumLongTaskMs: 50,
  warmupMs: 4_000,
} as const
