import assert from "node:assert/strict"
import test from "node:test"

import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import type { Vec2 } from "../../lib/journey-v2/contracts/world.ts"
import { pointInMultiPolygon } from "../../lib/journey-v2/generator/geometry.ts"
import {
  compileWaterShapes,
  deriveBridgeCrossings,
} from "../../lib/journey-v2/generator/hydrology.ts"
import { sampleRoad } from "../../lib/journey-v2/generator/roads.ts"
import { createTerrainField } from "../../lib/journey-v2/generator/terrain.ts"
import {
  compileWaterfrontSceneryV3,
  WATERFRONT_SCENES_V3,
} from "../../lib/journey-v2/generator/waterfront-scenery.ts"

const sampledRoads = JOURNEY_V3_WORLD.roads.map((road) =>
  sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
)
const waters = compileWaterShapes(
  JOURNEY_V3_WORLD.waterBodies,
  JOURNEY_V3_WORLD.bounds
)
const field = createTerrainField(JOURNEY_V3_WORLD, sampledRoads, waters)

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  const amount =
    lengthSquared <= 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
              lengthSquared
          )
        )
  return Math.hypot(
    point[0] - start[0] - dx * amount,
    point[1] - start[1] - dz * amount
  )
}

test("the code-generated northern ghat is deterministic and keeps one shared mesh", () => {
  const first = compileWaterfrontSceneryV3({
    world: JOURNEY_V3_WORLD,
    field,
  })
  const second = compileWaterfrontSceneryV3({
    world: JOURNEY_V3_WORLD,
    field,
  })

  assert.deepEqual(first, second)
  assert.equal(WATERFRONT_SCENES_V3.length, 1)
  assert.equal(first.features.filter((feature) => feature.kind === "ghat").length, 1)
  assert.equal(
    first.features.filter((feature) => feature.kind === "country-boat").length,
    2
  )
  assert.equal(first.colors.length, first.positions.length)
  assert.ok(first.positions.length > 0)
  assert.ok(first.indices.length > 0)
  assert.ok(
    first.indices.length / 3 <= 320,
    "the ghat and both boats remain a restrained addition to the shared proxy"
  )
  assert.ok(
    first.indices.every(
      (index) => index >= 0 && index < first.positions.length / 3
    )
  )
})

test("boats berth beside the ghat while the landing stays on a clear dry bank", () => {
  const scenery = compileWaterfrontSceneryV3({
    world: JOURNEY_V3_WORLD,
    field,
  })
  const ghat = scenery.features.find((feature) => feature.kind === "ghat")
  const boats = scenery.features.filter(
    (feature) => feature.kind === "country-boat"
  )
  assert.ok(ghat)

  const water = waters.find(
    (candidate) => candidate.id === ghat.waterBodyId
  )
  assert.ok(water)
  const bridges = deriveBridgeCrossings(sampledRoads, waters)

  for (const boat of boats) {
    const point: Vec2 = [boat.center[0], boat.center[2]]
    assert.equal(
      pointInMultiPolygon(point, water.multiPolygon),
      true,
      `${boat.id} remains inside its authored river`
    )
    const flowAlignment = Math.abs(
      boat.direction[0] * water.flowDirection[0] +
        boat.direction[1] * water.flowDirection[1]
    )
    assert.ok(
      flowAlignment <= 0.12,
      "short moored boats sit across the current without crossing mid-channel"
    )
    const dockAlignment = Math.abs(
      boat.direction[0] * ghat.direction[0] +
        boat.direction[1] * ghat.direction[1]
    )
    assert.ok(
      dockAlignment >= 0.98,
      "the boats lie alongside the two long jetty edges"
    )
  }

  const ghatPoint: Vec2 = [ghat.center[0], ghat.center[2]]
  assert.ok(
    bridges.every(
      (bridge) =>
        Math.hypot(
          bridge.center[0] - ghatPoint[0],
          bridge.center[1] - ghatPoint[1]
        ) > 20
    ),
    "the landing stays away from bridge traffic"
  )
  const nearestRoad = Math.min(
    ...sampledRoads.flatMap((road) =>
      road.points
        .slice(1)
        .map((point, index) =>
          pointSegmentDistance(ghatPoint, road.points[index], point)
        )
    )
  )
  assert.ok(nearestRoad > 20, "the landing stays away from the portfolio route")
})

test("the compact landing keeps both boats beside the jetty instead of scattering across the river", () => {
  const scenery = compileWaterfrontSceneryV3({
    world: JOURNEY_V3_WORLD,
    field,
  })
  const ghat = scenery.features.find((feature) => feature.kind === "ghat")
  const boats = scenery.features.filter(
    (feature) => feature.kind === "country-boat"
  )
  assert.ok(ghat)
  assert.equal(boats.length, 2)
  assert.deepEqual(ghat.dimensions, [1.8, 1.1, 5.6])

  const lateralOffsets = boats.map((boat) => {
    const delta: Vec2 = [
      boat.center[0] - ghat.center[0],
      boat.center[2] - ghat.center[2],
    ]
    const acrossJetty: Vec2 = [-ghat.direction[1], ghat.direction[0]]
    const lateral =
      delta[0] * acrossJetty[0] + delta[1] * acrossJetty[1]
    const intoWater =
      delta[0] * ghat.direction[0] + delta[1] * ghat.direction[1]
    const clearance =
      Math.abs(lateral) - boat.dimensions[2] / 2 - ghat.dimensions[0] / 2

    assert.ok(
      intoWater >= 0.45 && intoWater <= 0.6,
      `${boat.id} stays alongside the jetty instead of floating past its tip`
    )
    assert.ok(
      clearance >= 0.18 && clearance <= 0.28,
      `${boat.id} has a practical narrow mooring gap`
    )
    return lateral
  })

  assert.ok(
    lateralOffsets[0] * lateralOffsets[1] < 0,
    "one boat is secured on each side of the jetty"
  )
  assert.ok(
    Math.hypot(
      boats[0].center[0] - boats[1].center[0],
      boats[0].center[2] - boats[1].center[2]
    ) < 3.5,
    "the waterfront remains one coherent environmental cluster"
  )
})
