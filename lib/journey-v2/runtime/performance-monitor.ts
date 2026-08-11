import type * as THREE from "three"
import {
  JOURNEY_V2_PERFORMANCE_BUDGETS,
  JOURNEY_V2_QUALITY,
  type JourneyV2Quality,
} from "@/lib/journey-v2/design"
import type { JourneyWorldPerformance } from "@/lib/journey-v2/runtime/types"

interface JourneyPerformanceMonitorOptions {
  renderer: THREE.WebGLRenderer
  quality: JourneyV2Quality
  onMetrics: (metrics: JourneyWorldPerformance) => void
  onDprChange: (dpr: number) => void
}

export class JourneyPerformanceMonitor {
  private readonly renderer: THREE.WebGLRenderer
  private readonly onMetrics: (metrics: JourneyWorldPerformance) => void
  private readonly onDprChange: (dpr: number) => void
  private quality: JourneyV2Quality
  private samples: number[] = []
  private startedAt = performance.now()
  private lastReportAt = this.startedAt
  private lastAdjustmentAt = this.startedAt
  private slowReports = 0
  private fastReports = 0
  private lastMetrics: JourneyWorldPerformance | null = null

  constructor(options: JourneyPerformanceMonitorOptions) {
    this.renderer = options.renderer
    this.quality = options.quality
    this.onMetrics = options.onMetrics
    this.onDprChange = options.onDprChange
  }

  setQuality(quality: JourneyV2Quality) {
    if (quality === this.quality) return
    this.quality = quality
    this.samples = []
    this.slowReports = 0
    this.fastReports = 0
    this.lastAdjustmentAt = performance.now()
    const maximum = JOURNEY_V2_QUALITY[quality].maximumDpr
    if (this.renderer.getPixelRatio() > maximum) {
      this.onDprChange(maximum)
    }
  }

  sample(deltaSeconds: number, now = performance.now()) {
    const frameMs = Math.min(Math.max(deltaSeconds * 1000, 0), 1_000)
    this.samples.push(frameMs)
    if (this.samples.length > 180) this.samples.shift()
    if (now - this.lastReportAt < 1_000 || this.samples.length < 8) return null

    const sorted = [...this.samples].sort((a, b) => a - b)
    const total = this.samples.reduce((sum, sample) => sum + sample, 0)
    const averageFrameMs = total / this.samples.length
    const p95FrameMs =
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    const metrics: JourneyWorldPerformance = {
      fps: averageFrameMs > 0 ? 1_000 / averageFrameMs : 0,
      averageFrameMs,
      p95FrameMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      dpr: this.renderer.getPixelRatio(),
      quality: this.quality,
    }
    this.lastMetrics = metrics
    this.lastReportAt = now
    this.samples = []
    this.onMetrics(metrics)

    if (now - this.startedAt < JOURNEY_V2_PERFORMANCE_BUDGETS.warmupMs) {
      return metrics
    }

    const target =
      this.quality === "low"
        ? JOURNEY_V2_PERFORMANCE_BUDGETS.mobileP95FrameMs
        : JOURNEY_V2_PERFORMANCE_BUDGETS.desktopP95FrameMs
    if (p95FrameMs > target * 1.08) {
      this.slowReports += 1
      this.fastReports = 0
    } else if (p95FrameMs < target * 0.72) {
      this.fastReports += 1
      this.slowReports = 0
    } else {
      this.slowReports = 0
      this.fastReports = 0
    }

    const config = JOURNEY_V2_QUALITY[this.quality]
    const dpr = this.renderer.getPixelRatio()
    const canAdjust = now - this.lastAdjustmentAt >= 4_000
    if (canAdjust && this.slowReports >= 3 && dpr > config.minimumDpr) {
      this.lastAdjustmentAt = now
      this.slowReports = 0
      this.onDprChange(Math.max(config.minimumDpr, dpr - 0.1))
    } else if (canAdjust && this.fastReports >= 8 && dpr < config.maximumDpr) {
      this.lastAdjustmentAt = now
      this.fastReports = 0
      this.onDprChange(Math.min(config.maximumDpr, dpr + 0.05))
    }
    return metrics
  }

  suspendSampling(now = performance.now()) {
    this.samples = []
    this.lastReportAt = now
  }

  restartWarmup(now = performance.now()) {
    this.startedAt = now
    this.lastReportAt = now
    this.lastAdjustmentAt = now
    this.samples = []
    this.slowReports = 0
    this.fastReports = 0
  }

  getLastMetrics() {
    return this.lastMetrics
  }
}
