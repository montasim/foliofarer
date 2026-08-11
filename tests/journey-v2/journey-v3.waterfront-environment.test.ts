import assert from "node:assert/strict"
import test from "node:test"

import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import type {
  AuthoredWaterBodyV3,
  Vec2,
} from "../../lib/journey-v2/contracts/world.ts"
import {
  FAR_LANDSCAPE_APRON_V3,
  extendFarLandscapeWatersV3,
} from "../../lib/journey-v2/generator/far-landscape.ts"
import { pointInMultiPolygon } from "../../lib/journey-v2/generator/geometry.ts"
import {
  compileWaterShapes,
  deriveBridgeCrossings,
} from "../../lib/journey-v2/generator/hydrology.ts"
import { sampleRoad } from "../../lib/journey-v2/generator/roads.ts"
import { createTerrainField } from "../../lib/journey-v2/generator/terrain.ts"
import {
  WATERFRONT_SCENES_V3,
  compileWaterfrontSceneryV3,
} from "../../lib/journey-v2/generator/waterfront-scenery.ts"

function multiPolygonBounds(
  multiPolygon: ReturnType<typeof compileWaterShapes>[number]["multiPolygon"]
) {
  const points = multiPolygon.flat(2)
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ] as const
}

function endpointTangent(
  source: AuthoredWaterBodyV3,
  edge: "start" | "end"
): Vec2 {
  assert.ok(source.centerline)
  const endpointIndex = edge === "start" ? 0 : source.centerline.length - 1
  const neighbourIndex = edge === "start" ? 1 : source.centerline.length - 2
  const endpoint = source.centerline[endpointIndex]
  const neighbour = source.centerline[neighbourIndex]
  const x = endpoint[0] - neighbour[0]
  const z = endpoint[1] - neighbour[1]
  const length = Math.hypot(x, z)
  return [x / length, z / length]
}

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const x = end[0] - start[0]
  const z = end[1] - start[1]
  const lengthSquared = x * x + z * z
  const amount =
    lengthSquared <= 1e-8
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * x + (point[1] - start[1]) * z) /
              lengthSquared
          )
        )
  return Math.hypot(
    point[0] - start[0] - x * amount,
    point[1] - start[1] - z * amount
  )
}

test("far rivers cross both playable seams and finish cleanly at the visual apron", () => {
  const playable = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const far = extendFarLandscapeWatersV3(JOURNEY_V3_WORLD, playable)
  const farBounds = [
    JOURNEY_V3_WORLD.bounds[0] - FAR_LANDSCAPE_APRON_V3,
    JOURNEY_V3_WORLD.bounds[1] - FAR_LANDSCAPE_APRON_V3,
    JOURNEY_V3_WORLD.bounds[2] + FAR_LANDSCAPE_APRON_V3,
    JOURNEY_V3_WORLD.bounds[3] + FAR_LANDSCAPE_APRON_V3,
  ] as const

  for (const source of JOURNEY_V3_WORLD.waterBodies.filter(
    (water) => water.kind === "river"
  )) {
    assert.ok(source.centerline)
    const playableWater = playable.find((water) => water.id === source.id)
    const farWater = far.find((water) => water.id === source.id)
    assert.ok(playableWater)
    assert.ok(farWater)

    for (const edge of ["start", "end"] as const) {
      const endpoint =
        source.centerline[edge === "start" ? 0 : source.centerline.length - 1]
      const tangent = endpointTangent(source, edge)
      const outsideProbe: Vec2 = [
        endpoint[0] + tangent[0] * 1.5,
        endpoint[1] + tangent[1] * 1.5,
      ]

      assert.equal(
        pointInMultiPolygon(outsideProbe, playableWater.multiPolygon),
        false,
        `${source.id} detailed water remains inside gameplay bounds`
      )
      assert.equal(
        pointInMultiPolygon(outsideProbe, farWater.multiPolygon),
        true,
        `${source.id} crosses its ${edge} seam without a shoreline cap`
      )
    }

    const bounds = multiPolygonBounds(farWater.multiPolygon)
    assert.ok(
      Math.abs(bounds[0] - farBounds[0]) <= 0.1,
      `${source.id} reaches the western visual apron`
    )
    assert.ok(
      Math.abs(bounds[2] - farBounds[2]) <= 0.1,
      `${source.id} reaches the eastern visual apron`
    )
    assert.ok(
      bounds[0] >= farBounds[0] - 0.1 &&
        bounds[1] >= farBounds[1] - 0.1 &&
        bounds[2] <= farBounds[2] + 0.1 &&
        bounds[3] <= farBounds[3] + 0.1,
      `${source.id} never overhangs the visual terrain`
    )
    assert.equal(
      farWater.multiPolygon.length,
      1,
      `${source.id} remains one continuous waterway`
    )
  }
})

test("visual continuation does not expand streamed ponds or playable water", () => {
  const playable = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const far = extendFarLandscapeWatersV3(JOURNEY_V3_WORLD, playable)

  for (const water of playable) {
    const source = JOURNEY_V3_WORLD.waterBodies.find(
      (candidate) => candidate.id === water.id
    )
    const farWater = far.find((candidate) => candidate.id === water.id)
    assert.ok(source)
    assert.ok(farWater)

    if (source.kind === "pond") {
      assert.deepEqual(
        farWater,
        water,
        `${source.id} stays authored instead of becoming a horizon feature`
      )
    }

    const playableBounds = multiPolygonBounds(water.multiPolygon)
    assert.ok(
      playableBounds[0] >= JOURNEY_V3_WORLD.bounds[0] &&
        playableBounds[1] >= JOURNEY_V3_WORLD.bounds[1] &&
        playableBounds[2] <= JOURNEY_V3_WORLD.bounds[2] &&
        playableBounds[3] <= JOURNEY_V3_WORLD.bounds[3],
      `${source.id} streamed surface remains within gameplay bounds`
    )
  }
})

test("the western ocean opens to the horizon without flooding its island", () => {
  const playable = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const far = extendFarLandscapeWatersV3(JOURNEY_V3_WORLD, playable)
  const source = JOURNEY_V3_WORLD.waterBodies.find(
    (water) => water.id === "water.western-ocean"
  )
  const farOcean = far.find((water) => water.id === source?.id)
  assert.ok(source?.islands?.[0])
  assert.ok(farOcean)

  const bounds = multiPolygonBounds(farOcean.multiPolygon)
  assert.equal(bounds[0], JOURNEY_V3_WORLD.bounds[0] - FAR_LANDSCAPE_APRON_V3)
  assert.equal(bounds[1], JOURNEY_V3_WORLD.bounds[1] - FAR_LANDSCAPE_APRON_V3)

  const island = source.islands[0]
  const islandCentre: Vec2 = [
    island.reduce((sum, point) => sum + point[0], 0) / island.length,
    island.reduce((sum, point) => sum + point[1], 0) / island.length,
  ]
  assert.equal(
    pointInMultiPolygon(islandCentre, farOcean.multiPolygon),
    false,
    "the visual ocean preserves the authored dry island"
  )
})

test("the northern ghat and country boats form restrained, realistic river scenery", () => {
  const sampledRoads = JOURNEY_V3_WORLD.roads.map((road) =>
    sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
  )
  const waters = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const field = createTerrainField(JOURNEY_V3_WORLD, sampledRoads, waters)
  const first = compileWaterfrontSceneryV3({
    world: JOURNEY_V3_WORLD,
    field,
  })
  const repeated = compileWaterfrontSceneryV3({
    world: JOURNEY_V3_WORLD,
    field,
  })
  assert.deepEqual(first, repeated, "waterfront scenery stays deterministic")
  assert.equal(WATERFRONT_SCENES_V3.length, 1)
  assert.equal(first.positions.length, first.colors.length)
  assert.ok(first.indices.length > 0)
  assert.ok(
    first.indices.length / 3 <= 320,
    "the complete landing stays within its low-poly allocation"
  )

  const ghat = first.features.filter((feature) => feature.kind === "ghat")
  const boats = first.features.filter(
    (feature) => feature.kind === "country-boat"
  )
  assert.equal(ghat.length, 1, "one modest landing avoids marina clutter")
  assert.equal(
    boats.length,
    2,
    "two moored country boats create an inhabited bank"
  )
  assert.equal(new Set(first.features.map((feature) => feature.id)).size, 3)

  const river = waters.find((water) => water.id === "water.northern-river")
  const riverSource = JOURNEY_V3_WORLD.waterBodies.find(
    (water) => water.id === river?.id
  )
  assert.ok(river)
  assert.ok(riverSource)

  const landing = ghat[0]
  const halfDockLength = landing.dimensions[2] / 2
  const landEnd: Vec2 = [
    landing.center[0] - landing.direction[0] * halfDockLength,
    landing.center[2] - landing.direction[1] * halfDockLength,
  ]
  const waterEnd: Vec2 = [
    landing.center[0] + landing.direction[0] * halfDockLength,
    landing.center[2] + landing.direction[1] * halfDockLength,
  ]
  assert.equal(
    pointInMultiPolygon(landEnd, river.multiPolygon),
    false,
    "the ghat starts on its dry bank"
  )
  assert.equal(
    pointInMultiPolygon(waterEnd, river.multiPolygon),
    true,
    "the ghat projects into navigable water"
  )

  const flowLength = Math.hypot(...riverSource.flowDirection)
  const normalizedFlow: Vec2 = [
    riverSource.flowDirection[0] / flowLength,
    riverSource.flowDirection[1] / flowLength,
  ]
  assert.ok(
    Math.abs(
      landing.direction[0] * normalizedFlow[0] +
        landing.direction[1] * normalizedFlow[1]
    ) < 0.15,
    "the landing runs across the current instead of along it"
  )

  for (const boat of boats) {
    assert.equal(boat.waterBodyId, river.id)
    assert.equal(
      pointInMultiPolygon([boat.center[0], boat.center[2]], river.multiPolygon),
      true,
      `${boat.id} is afloat`
    )
    assert.ok(
      Math.abs(
        boat.direction[0] * normalizedFlow[0] +
          boat.direction[1] * normalizedFlow[1]
      ) < 0.15,
      `${boat.id} is tied alongside the short bank jetty instead of drifting across its tip`
    )
    assert.ok(
      boat.dimensions[0] >= 4.4 &&
        boat.dimensions[0] <= 5 &&
        boat.dimensions[2] >= 0.88 &&
        boat.dimensions[2] <= 1,
      `${boat.id} keeps narrow country-boat proportions`
    )
  }

  const scenePoint: Vec2 = [landing.center[0], landing.center[2]]
  const bridges = deriveBridgeCrossings(sampledRoads, waters)
  assert.ok(
    bridges.every(
      (bridge) =>
        Math.hypot(
          scenePoint[0] - bridge.center[0],
          scenePoint[1] - bridge.center[1]
        ) >= 25
    ),
    "the landing does not crowd a bridge"
  )
  assert.ok(
    sampledRoads.every((road) => {
      let distance = Number.POSITIVE_INFINITY
      for (let index = 0; index < road.points.length - 1; index += 1) {
        distance = Math.min(
          distance,
          pointSegmentDistance(
            scenePoint,
            road.points[index],
            road.points[index + 1]
          )
        )
      }
      return distance >= road.source.width / 2 + 20
    }),
    "the landing stays on a quiet bank away from the journey road"
  )
  for (const record of JOURNEY_V3_WORLD.portfolioRecords) {
    assert.equal(
      first.features.some((feature) => feature.id.includes(record.recordId)),
      false,
      "waterfront scenery never becomes a portfolio representation"
    )
  }
})
