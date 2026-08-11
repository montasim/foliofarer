import { expect, test } from "@playwright/test"
import {
  adjacentRenderTier,
  FrameTimeHistogram,
} from "../../lib/journey/performance"
import {
  buildAssistedRoute,
  JOURNEY_NAVIGATION_NODES,
} from "../../lib/journey/navigation"
import {
  JOURNEY_LANDMARK_LAYOUTS,
  JOURNEY_START_POSITION,
} from "../../lib/journey/world-layout"

test("frame histogram keeps a bounded sliding percentile", () => {
  const histogram = new FrameTimeHistogram(5)
  for (const frameTime of [10, 12, 14, 16, 80]) histogram.add(frameTime)

  expect(histogram.size).toBe(5)
  expect(histogram.percentile(0.5)).toBe(14)
  expect(histogram.percentile(0.95)).toBe(80)

  histogram.add(18)
  expect(histogram.size).toBe(5)
  expect(histogram.percentile(0.95)).toBe(80)

  histogram.add(20)
  histogram.add(22)
  histogram.add(24)
  histogram.add(26)
  expect(histogram.percentile(0.95)).toBe(26)
})

test("render tiers only move to an adjacent quality level", () => {
  expect(adjacentRenderTier("high", "downgrade")).toBe("balanced")
  expect(adjacentRenderTier("balanced", "downgrade")).toBe("low")
  expect(adjacentRenderTier("low", "downgrade")).toBe("low")
  expect(adjacentRenderTier("low", "upgrade")).toBe("balanced")
  expect(adjacentRenderTier("balanced", "upgrade")).toBe("high")
  expect(adjacentRenderTier("high", "upgrade")).toBe("high")
})

test("Assisted Travel reaches every chapter and Contact checkpoint", () => {
  const chapterLandmarks = [
    "codez-info-tech",
    "drra",
    "multiversal-software",
    "mymedicalhub",
    "learning-library",
    "project-workshop",
    "community-hall",
    "contact-pavilion",
  ] as const

  for (const landmarkId of chapterLandmarks) {
    const route = buildAssistedRoute(
      { x: JOURNEY_START_POSITION[0], z: JOURNEY_START_POSITION[2] },
      landmarkId
    )
    expect(route.length).toBeGreaterThan(10)
    expect(route.at(-1)).toEqual(
      JOURNEY_LANDMARK_LAYOUTS[landmarkId].checkpointPosition
    )

    for (let index = 1; index < route.length; index += 1) {
      const previous = route[index - 1]
      const current = route[index]
      expect(
        Math.hypot(current[0] - previous[0], current[2] - previous[2])
      ).toBeLessThan(9)
    }
  }
})

test("Assisted Travel keeps longitudinal travel on the left sidewalk", () => {
  const destinations = [
    "rangpur-zilla-school",
    "carmichael-college",
    "baust",
    "codez-info-tech",
    "drra",
    "multiversal-software",
    "mymedicalhub",
    "learning-library",
    "project-workshop",
    "community-hall",
    "contact-pavilion",
  ] as const
  const nodeIdByPosition = new Map(
    JOURNEY_NAVIGATION_NODES.map((node) => [
      `${node.position[0].toFixed(6)}:${node.position[2].toFixed(6)}`,
      node.id,
    ])
  )

  const startingPositions = [
    ["journey-start", JOURNEY_START_POSITION] as const,
    ...Object.entries(JOURNEY_LANDMARK_LAYOUTS).map(
      ([id, layout]) => [id, layout.checkpointPosition] as const
    ),
  ]

  for (const [startId, startPosition] of startingPositions) {
    for (const landmarkId of destinations) {
      if (startId === landmarkId) continue
      const route = buildAssistedRoute(
        { x: startPosition[0], z: startPosition[2] },
        landmarkId
      )
      const sidewalkNodeIds = route.flatMap((position) => {
        const id = nodeIdByPosition.get(
          `${position[0].toFixed(6)}:${position[2].toFixed(6)}`
        )
        return id ? [id] : []
      })
      const sideRuns = sidewalkNodeIds.reduce<string[]>((runs, id) => {
        const side = id.startsWith("west-") ? "left" : "right"
        if (runs.at(-1) !== side) runs.push(side)
        return runs
      }, [])
      const rightNodeRuns = sidewalkNodeIds.reduce<number[]>(
        (runs, id, index) => {
          if (!id.startsWith("east-")) return runs
          const previousId = sidewalkNodeIds[index - 1]
          if (!previousId?.startsWith("east-")) runs.push(0)
          runs[runs.length - 1] += 1
          return runs
        },
        []
      )

      expect(
        ["left", "left-right", "right-left", "right-left-right"],
        `${startId} to ${landmarkId} did not use a left-side primary route`
      ).toContain(sideRuns.join("-"))
      expect(
        rightNodeRuns.every((length) => length <= 1),
        `${startId} to ${landmarkId} used the right sidewalk longitudinally`
      ).toBe(true)
    }
  }
})
