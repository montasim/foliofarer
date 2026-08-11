import assert from "node:assert/strict"
import test from "node:test"

import type {
  PortfolioCheckpointManifestV3,
  Vec2,
} from "../../lib/journey-v2/contracts/world.ts"
import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import {
  bridgeIntervenesBetweenCheckpointsV3,
  validateWorldManifestV3,
} from "../../lib/journey-v2/generator/validation-v3.ts"

const WORLD = compileJourneyWorldV3()
const routeOrder = new Map(
  WORLD.portfolioRecords.map((record) => [record.recordId, record.routeOrder])
)
const CHECKPOINTS = [...WORLD.checkpoints].sort(
  (a, b) => routeOrder.get(a.recordId)! - routeOrder.get(b.recordId)!
)

function positionedCheckpoint(
  source: PortfolioCheckpointManifestV3,
  point: Vec2
): PortfolioCheckpointManifestV3 {
  return {
    ...source,
    position: [point[0], source.position[1], point[1]],
  }
}

test("only a bridge genuinely spanning two arrivals relaxes chronology spacing", () => {
  const northernBridge = WORLD.bridges.find(
    (bridge) => bridge.waterBodyId === "water.northern-river"
  )
  const before = CHECKPOINTS.find((checkpoint) => checkpoint.recordId === "baust")
  const after = CHECKPOINTS.find(
    (checkpoint) => checkpoint.recordId === "codez-info-tech"
  )
  assert.ok(northernBridge)
  assert.ok(before)
  assert.ok(after)
  assert.equal(
    bridgeIntervenesBetweenCheckpointsV3(northernBridge, before, after),
    true,
    "the real widened-river crossing is recognised"
  )

  const tangentLength = Math.hypot(
    northernBridge.tangent[0],
    northernBridge.tangent[1]
  )
  const tangent: Vec2 = [
    northernBridge.tangent[0] / tangentLength,
    northernBridge.tangent[1] / tangentLength,
  ]
  const normal: Vec2 = [-tangent[1], tangent[0]]
  const center: Vec2 = [
    northernBridge.center[0],
    northernBridge.center[2],
  ]
  const pointAt = (along: number, across = 0): Vec2 => [
    center[0] + tangent[0] * along + normal[0] * across,
    center[1] + tangent[1] * along + normal[1] * across,
  ]

  assert.equal(
    bridgeIntervenesBetweenCheckpointsV3(
      northernBridge,
      positionedCheckpoint(before, pointAt(1)),
      positionedCheckpoint(after, pointAt(38))
    ),
    false,
    "two arrivals beyond the same bridge end do not earn a bridge allowance"
  )
  assert.equal(
    bridgeIntervenesBetweenCheckpointsV3(
      northernBridge,
      positionedCheckpoint(before, pointAt(0, -24)),
      positionedCheckpoint(after, pointAt(0, 24))
    ),
    false,
    "a segment crossing the bridge road sideways is not an intervening bridge"
  )
})

test("an ordinary chronology gap above 36 metres is still rejected", () => {
  const invalid = structuredClone(WORLD)
  const previous = invalid.checkpoints.find(
    (checkpoint) => checkpoint.recordId === "town-square"
  )
  const current = invalid.checkpoints.find(
    (checkpoint) => checkpoint.recordId === "rangpur-zilla-school"
  )
  assert.ok(previous)
  assert.ok(current)
  current.position = [
    previous.position[0] + 37,
    current.position[1],
    previous.position[2],
  ]

  assert.throws(
    () => validateWorldManifestV3(invalid),
    /checkpoint\.rangpur-zilla-school is 37\.0m from the previous checkpoint/
  )
})
