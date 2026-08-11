"use client"

import * as React from "react"
import { useFrame } from "@react-three/fiber"
import {
  adjacentRenderTier,
  FrameTimeHistogram,
} from "@/lib/journey/performance"
import type { JourneyRenderTier } from "@/lib/journey/types"

const EVALUATION_INTERVAL_SECONDS = 1
const MINIMUM_SAMPLES = 60
const DOWNGRADE_CHECKS = 3
const UPGRADE_CHECKS = 10
const CHANGE_COOLDOWN_SECONDS = 8

interface JourneyPerformanceMonitorProps {
  enabled: boolean
  tier: JourneyRenderTier
  onFrameTime: (p95FrameTimeMs: number) => void
  onTierChange: (
    tier: JourneyRenderTier,
    direction: "upgrade" | "downgrade",
    p95FrameTimeMs: number
  ) => void
}

export function JourneyPerformanceMonitor({
  enabled,
  tier,
  onFrameTime,
  onTierChange,
}: JourneyPerformanceMonitorProps) {
  const histogram = React.useRef(new FrameTimeHistogram())
  const lastEvaluation = React.useRef(0)
  const lastChange = React.useRef(Number.NEGATIVE_INFINITY)
  const downgradeChecks = React.useRef(0)
  const upgradeChecks = React.useRef(0)

  React.useEffect(() => {
    downgradeChecks.current = 0
    upgradeChecks.current = 0
  }, [tier])

  useFrame(({ clock }, delta) => {
    if (!enabled || document.visibilityState !== "visible" || delta > 0.25) {
      return
    }

    histogram.current.add(delta * 1_000)
    const elapsed = clock.elapsedTime
    if (
      histogram.current.size < MINIMUM_SAMPLES ||
      elapsed - lastEvaluation.current < EVALUATION_INTERVAL_SECONDS
    ) {
      return
    }

    lastEvaluation.current = elapsed
    const p95FrameTimeMs = histogram.current.percentile(0.95)
    onFrameTime(p95FrameTimeMs)

    if (elapsed - lastChange.current < CHANGE_COOLDOWN_SECONDS) return

    const missesBudget = p95FrameTimeMs > (tier === "low" ? 33 : 20)
    const hasUpgradeHeadroom = p95FrameTimeMs <= 18

    downgradeChecks.current = missesBudget ? downgradeChecks.current + 1 : 0
    upgradeChecks.current = hasUpgradeHeadroom ? upgradeChecks.current + 1 : 0

    if (downgradeChecks.current >= DOWNGRADE_CHECKS && tier !== "low") {
      lastChange.current = elapsed
      onTierChange(
        adjacentRenderTier(tier, "downgrade"),
        "downgrade",
        p95FrameTimeMs
      )
      return
    }

    if (upgradeChecks.current >= UPGRADE_CHECKS && tier !== "high") {
      lastChange.current = elapsed
      onTierChange(
        adjacentRenderTier(tier, "upgrade"),
        "upgrade",
        p95FrameTimeMs
      )
    }
  })

  return null
}
