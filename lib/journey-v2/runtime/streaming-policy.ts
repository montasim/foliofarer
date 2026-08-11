import {
  JOURNEY_V2_PERFORMANCE_BUDGETS,
  type JourneyV2Quality,
} from "@/lib/journey-v2/design"
import type { JourneyWorldPerformance } from "@/lib/journey-v2/runtime/types"

export interface JourneyCellLimits {
  active: number
  gpuResident: number
  streamed: number
  prefetchLookAhead: number
}

/**
 * Rendering, GPU warmth and decoded CPU packages are deliberately separate
 * budgets. A route prefetch may grow the latter tiers, never the active tier.
 */
export const JOURNEY_CELL_LIMITS = {
  high: {
    active: 8,
    gpuResident: 12,
    streamed: 24,
    prefetchLookAhead: 120,
  },
  balanced: {
    active: 7,
    gpuResident: 10,
    streamed: 18,
    prefetchLookAhead: 88,
  },
  low: {
    active: 3,
    gpuResident: 8,
    streamed: 14,
    prefetchLookAhead: 64,
  },
} as const satisfies Record<JourneyV2Quality, JourneyCellLimits>

const MINIMUM_ENVIRONMENT_DENSITY: Record<JourneyV2Quality, number> = {
  high: 0.5,
  balanced: 0.4,
  low: 0.28,
}

export function nextAdaptiveEnvironmentDensity(
  metrics: JourneyWorldPerformance,
  previous: number
) {
  const quality = metrics.quality
  const frameBudget =
    quality === "low"
      ? JOURNEY_V2_PERFORMANCE_BUDGETS.mobileP95FrameMs
      : JOURNEY_V2_PERFORMANCE_BUDGETS.desktopP95FrameMs
  const drawBudget =
    quality === "low"
      ? JOURNEY_V2_PERFORMANCE_BUDGETS.mobileDrawCalls
      : JOURNEY_V2_PERFORMANCE_BUDGETS.desktopDrawCalls
  const slow =
    metrics.p95FrameMs > frameBudget * 1.08 || metrics.drawCalls > drawBudget
  const comfortablyFast =
    metrics.p95FrameMs < frameBudget * 0.72 &&
    metrics.drawCalls < drawBudget * 0.72
  const next = slow
    ? previous - 0.12
    : comfortablyFast
      ? previous + 0.04
      : previous
  return Math.min(1, Math.max(MINIMUM_ENVIRONMENT_DENSITY[quality], next))
}
