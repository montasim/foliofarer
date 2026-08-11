import type { JourneyRenderTier } from "@/lib/journey/types"

const MAX_FRAME_TIME_MS = 100

export const JOURNEY_START_MARK_KEY = "montasim-journey-started-at-v1"

export const JOURNEY_RENDER_TIER_ORDER: readonly JourneyRenderTier[] = [
  "high",
  "balanced",
  "low",
]

export const JOURNEY_RENDER_CONFIG = {
  high: {
    dpr: [1, 1.5] as [number, number],
    shadows: true,
    shadowMapSize: 1024,
    sceneryStride: 1,
  },
  balanced: {
    dpr: [1, 1.25] as [number, number],
    shadows: true,
    shadowMapSize: 512,
    sceneryStride: 2,
  },
  low: {
    dpr: 1,
    shadows: false,
    shadowMapSize: 512,
    sceneryStride: 3,
  },
} as const

export class FrameTimeHistogram {
  readonly capacity: number
  private readonly samples: Uint8Array
  private readonly buckets = new Uint16Array(MAX_FRAME_TIME_MS + 1)
  private cursor = 0
  private sampleCount = 0

  constructor(capacity = 300) {
    this.capacity = capacity
    this.samples = new Uint8Array(capacity)
  }

  get size() {
    return this.sampleCount
  }

  add(frameTimeMs: number) {
    const bucket = Math.min(
      MAX_FRAME_TIME_MS,
      Math.max(0, Math.round(frameTimeMs))
    )

    if (this.sampleCount === this.capacity) {
      this.buckets[this.samples[this.cursor]] -= 1
    } else {
      this.sampleCount += 1
    }

    this.samples[this.cursor] = bucket
    this.buckets[bucket] += 1
    this.cursor = (this.cursor + 1) % this.capacity
  }

  percentile(percentile: number) {
    if (this.sampleCount === 0) return 0
    const rank = Math.max(
      1,
      Math.ceil(this.sampleCount * Math.min(1, Math.max(0, percentile)))
    )
    let observed = 0
    for (let bucket = 0; bucket < this.buckets.length; bucket += 1) {
      observed += this.buckets[bucket]
      if (observed >= rank) return bucket
    }
    return MAX_FRAME_TIME_MS
  }
}

export function adjacentRenderTier(
  tier: JourneyRenderTier,
  direction: "upgrade" | "downgrade"
) {
  const currentIndex = JOURNEY_RENDER_TIER_ORDER.indexOf(tier)
  const offset = direction === "upgrade" ? -1 : 1
  return JOURNEY_RENDER_TIER_ORDER[currentIndex + offset] ?? tier
}

export function frameTimeBucket(frameTimeMs: number) {
  if (frameTimeMs <= 0) return "unavailable"
  if (frameTimeMs <= 20) return "at-or-below-20ms"
  if (frameTimeMs <= 33) return "21-to-33ms"
  if (frameTimeMs <= 50) return "34-to-50ms"
  return "above-50ms"
}

export function playableDurationBucket(durationMs: number) {
  if (durationMs <= 1_000) return "at-or-below-1s"
  if (durationMs <= 2_000) return "1-to-2s"
  if (durationMs <= 4_000) return "2-to-4s"
  return "above-4s"
}
