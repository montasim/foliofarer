import assert from "node:assert/strict"
import test from "node:test"

import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import type { Vec2 } from "../../lib/journey-v2/contracts/world.ts"
import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import {
  realignRoadsForBridgeApproaches,
  roadEdgeSegment,
} from "../../lib/journey-v2/generator/bridges.ts"
import {
  BRIDGE_DRY_LANDING_FACTOR_V3,
  MAX_BRIDGE_DRY_LANDING_FACTOR_V3,
  MAX_BRIDGE_LATERAL_OFFSET_V3,
  MIN_BRIDGE_DRY_LANDING_FACTOR_V3,
  compileWaterShapes,
  deriveBridgeCrossings,
} from "../../lib/journey-v2/generator/hydrology.ts"
import { sampleRoad } from "../../lib/journey-v2/generator/roads.ts"

const WORLD = compileJourneyWorldV3()

function pointInRing(point: Vec2, ring: readonly Vec2[]) {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const current = ring[index]
    const before = ring[previous]
    if (
      current[1] > point[1] !== before[1] > point[1] &&
      point[0] <
        ((before[0] - current[0]) * (point[1] - current[1])) /
          (before[1] - current[1] || Number.EPSILON) +
          current[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const squared = dx * dx + dz * dz
  const amount =
    squared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / squared
          )
        )
  return Math.hypot(
    point[0] - start[0] - dx * amount,
    point[1] - start[1] - dz * amount
  )
}

function ringsForWater(polygon: (typeof WORLD.waterBodies)[number]["polygon"]) {
  return typeof polygon[0]?.[0] === "number"
    ? ([polygon] as Vec2[][])
    : (polygon as Vec2[][])
}

function isWater(point: Vec2) {
  return WORLD.waterBodies.some((water) => {
    const rings = ringsForWater(water.polygon)
    return (
      pointInRing(point, rings[0]) &&
      !rings.slice(1).some((ring) => pointInRing(point, ring))
    )
  })
}

test("both authored rivers are widened by a further eighty percent", () => {
  const rivers = JOURNEY_V3_WORLD.waterBodies.filter(
    (water) => water.kind === "river"
  )
  assert.deepEqual(
    rivers.map((river) => [river.id, river.width]),
    [
      ["water.northern-river", 22.32],
      ["water.coastal-creek", 17.28],
    ]
  )
})

test("wide-river bridges retain a compact grade-safe landing on each bank", () => {
  const roads = JOURNEY_V3_WORLD.roads.map((road) =>
    sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
  )
  const waters = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const crossings = deriveBridgeCrossings(roads, waters)
  assert.equal(crossings.length, 2)
  for (const crossing of crossings) {
    const road = roads.find(
      (candidate) => candidate.source.id === crossing.roadId
    )
    const water = waters.find(
      (candidate) => candidate.id === crossing.waterBodyId
    )
    assert.ok(road)
    assert.ok(water)
    const groundedSpan = Math.hypot(
      crossing.exit[0] - crossing.entry[0],
      crossing.exit[1] - crossing.entry[1]
    )
    const dryLandingFactor =
      water.bridgeDryLandingFactor ?? BRIDGE_DRY_LANDING_FACTOR_V3
    assert.ok(
      Math.abs(
        crossing.length -
          groundedSpan -
          road.source.width * dryLandingFactor * 2
      ) < 0.000_001
    )
  }
})

test("the coastal road settles into a straight bridge approach without moving the nearby clinic edge", () => {
  const authoredRoads = JOURNEY_V3_WORLD.roads.map((road) =>
    sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
  )
  const waters = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const drafts = deriveBridgeCrossings(authoredRoads, waters)
  const renderedRoads = realignRoadsForBridgeApproaches(authoredRoads, drafts)
  const authoredRoad = authoredRoads.find(
    (road) => road.source.id === "journey-spine"
  )
  const renderedRoad = renderedRoads.find(
    (road) => road.source.id === "journey-spine"
  )
  const coastalBridge = drafts.find(
    (bridge) => bridge.waterBodyId === "water.coastal-creek"
  )
  assert.ok(authoredRoad)
  assert.ok(renderedRoad)
  assert.ok(coastalBridge)

  const renderedSegments = renderedRoad.points
    .slice(0, -1)
    .map((_, index) => roadEdgeSegment(renderedRoad, index))
  const firstInside = renderedSegments.findIndex((segment) =>
    pointInRing(segment.center, coastalBridge.deckPolygon[0])
  )
  assert.ok(firstInside > 3)
  for (const segment of renderedSegments.slice(firstInside - 3, firstInside)) {
    const alignment = Math.max(
      -1,
      Math.min(
        1,
        segment.tangent[0] * coastalBridge.tangent[0] +
          segment.tangent[1] * coastalBridge.tangent[1]
      )
    )
    assert.ok((Math.acos(alignment) * 180) / Math.PI < 0.1)
  }

  const clinic = JOURNEY_V3_WORLD.environmentalBuildings.find(
    (building) => building.id === "structure.arrival-07"
  )
  assert.ok(clinic)
  const clinicSegment = Math.round(
    clinic.roadProgress * (authoredRoad.points.length - 2)
  )
  assert.deepEqual(
    renderedRoad.points.slice(clinicSegment, clinicSegment + 3),
    authoredRoad.points.slice(clinicSegment, clinicSegment + 3)
  )
  assert.ok(
    renderedRoad.points
      .slice(clinicSegment + 3, firstInside)
      .some(
        (point, index) =>
          Math.hypot(
            point[0] - authoredRoad.points[clinicSegment + 3 + index][0],
            point[1] - authoredRoad.points[clinicSegment + 3 + index][1]
          ) > 0.5
      )
  )
})

test("the coastal bridge shifts left while northern bridge ownership stays fixed", () => {
  const roads = JOURNEY_V3_WORLD.roads.map((road) =>
    sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
  )
  const shiftedWaters = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const baselineWaterSources = structuredClone(JOURNEY_V3_WORLD.waterBodies)
  for (const water of baselineWaterSources) {
    delete water.bridgeLateralOffset
  }
  const baselineWaters = compileWaterShapes(
    baselineWaterSources,
    JOURNEY_V3_WORLD.bounds
  )
  const shifted = deriveBridgeCrossings(roads, shiftedWaters)
  const baseline = deriveBridgeCrossings(roads, baselineWaters)
  const shiftedNorthern = shifted.find((bridge) =>
    bridge.id.includes("northern-river")
  )
  const baselineNorthern = baseline.find((bridge) =>
    bridge.id.includes("northern-river")
  )
  assert.deepEqual(shiftedNorthern, baselineNorthern)

  const coastalWater = shiftedWaters.find(
    (water) => water.id === "water.coastal-creek"
  )
  const northernWater = shiftedWaters.find(
    (water) => water.id === "water.northern-river"
  )
  assert.equal(coastalWater?.bridgeLateralOffset, 0.9)
  assert.equal(coastalWater?.bridgeDryLandingFactor, 0.14)
  assert.equal(northernWater?.bridgeLateralOffset, undefined)
  assert.equal(northernWater?.bridgeDryLandingFactor, undefined)

  const shiftedCoastal = shifted.find((bridge) =>
    bridge.id.includes("coastal-creek")
  )
  const baselineCoastal = baseline.find((bridge) =>
    bridge.id.includes("coastal-creek")
  )
  assert.ok(shiftedCoastal)
  assert.ok(baselineCoastal)
  const translation: Vec2 = [
    shiftedCoastal.center[0] - baselineCoastal.center[0],
    shiftedCoastal.center[1] - baselineCoastal.center[1],
  ]
  const left: Vec2 = [baselineCoastal.tangent[1], -baselineCoastal.tangent[0]]
  const leftDistance = translation[0] * left[0] + translation[1] * left[1]
  const longitudinalDistance =
    translation[0] * baselineCoastal.tangent[0] +
    translation[1] * baselineCoastal.tangent[1]
  assert.ok(Math.abs(leftDistance - 0.9) < 0.000_001)
  assert.ok(Math.abs(longitudinalDistance) < 0.000_001)
  for (const [shiftedPoint, baselinePoint] of [
    [shiftedCoastal.entry, baselineCoastal.entry],
    [shiftedCoastal.exit, baselineCoastal.exit],
    ...shiftedCoastal.deckPolygon[0]
      .slice(0, -1)
      .map(
        (point, index) =>
          [point, baselineCoastal.deckPolygon[0][index]] as const
      ),
  ] as const) {
    assert.ok(
      Math.abs(shiftedPoint[0] - baselinePoint[0] - translation[0]) < 0.000_01
    )
    assert.ok(
      Math.abs(shiftedPoint[1] - baselinePoint[1] - translation[1]) < 0.000_01
    )
  }

  const compiledCoastal = WORLD.bridges.find(
    (bridge) => bridge.waterBodyId === "water.coastal-creek"
  )
  assert.ok(compiledCoastal)
  assert.ok(
    compiledCoastal.geometryIds.some((id) => id.endsWith(".approach-verges"))
  )
  assert.ok(
    compiledCoastal.navNodeIds.every((id) =>
      WORLD.navigation.nodes.some((node) => node.id === id)
    )
  )
  assert.ok(
    WORLD.navigation.edges.some(
      (edge) => edge.waterOverrideBridgeId === compiledCoastal.id
    )
  )
})

test("bridge lateral offsets must be finite and conservatively bounded", () => {
  for (const bridgeLateralOffset of [
    Number.POSITIVE_INFINITY,
    MAX_BRIDGE_LATERAL_OFFSET_V3 + 0.001,
    -MAX_BRIDGE_LATERAL_OFFSET_V3 - 0.001,
  ]) {
    const waters = structuredClone(JOURNEY_V3_WORLD.waterBodies)
    const coastal = waters.find((water) => water.id === "water.coastal-creek")
    assert.ok(coastal)
    coastal.bridgeLateralOffset = bridgeLateralOffset
    assert.throws(
      () => compileWaterShapes(waters, JOURNEY_V3_WORLD.bounds),
      /invalid bridge lateral offset/
    )
  }
})

test("bridge dry-bank landings must stay finite and conservatively bounded", () => {
  for (const bridgeDryLandingFactor of [
    Number.POSITIVE_INFINITY,
    MIN_BRIDGE_DRY_LANDING_FACTOR_V3 - 0.001,
    MAX_BRIDGE_DRY_LANDING_FACTOR_V3 + 0.001,
  ]) {
    const waters = structuredClone(JOURNEY_V3_WORLD.waterBodies)
    const coastal = waters.find((water) => water.id === "water.coastal-creek")
    assert.ok(coastal)
    coastal.bridgeDryLandingFactor = bridgeDryLandingFactor
    assert.throws(
      () => compileWaterShapes(waters, JOURNEY_V3_WORLD.bounds),
      /invalid bridge dry landing factor/
    )
  }
})

test("inland water surfaces are authored below the mainland datum", () => {
  assert.deepEqual(
    JOURNEY_V3_WORLD.waterBodies
      .filter((water) => water.kind !== "ocean")
      .map((water) => [water.id, water.waterLevel]),
    [
      ["water.northern-river", -0.3],
      ["water.career-pond", -0.26],
      ["water.coastal-creek", -0.31],
      ["water.contact-garden-pond", -0.27],
    ]
  )
})

test("compiled river and pond beds remain below their rendered water", () => {
  for (const water of WORLD.waterBodies.filter(
    (candidate) => candidate.kind !== "ocean"
  )) {
    const bedHeights: number[] = []
    for (const tile of WORLD.terrain.tiles) {
      for (let row = 0; row < tile.resolution[1]; row += 1) {
        for (let column = 0; column < tile.resolution[0]; column += 1) {
          const point: Vec2 = [
            tile.bounds[0] + column * tile.sampleSpacing,
            tile.bounds[1] + row * tile.sampleSpacing,
          ]
          const rings = ringsForWater(water.polygon)
          if (
            pointInRing(point, rings[0]) &&
            !rings.slice(1).some((ring) => pointInRing(point, ring))
          ) {
            bedHeights.push(tile.heights[row * tile.resolution[0] + column])
          }
        }
      }
    }
    assert.ok(bedHeights.length > 0, `${water.id} has terrain bed samples`)
    assert.ok(
      Math.max(...bedHeights) <= water.waterLevel - 0.6,
      `${water.id} bed is not deeply incised`
    )
  }
})

test("river and pond surfaces sit visibly below their nearby dry banks", () => {
  for (const water of WORLD.waterBodies.filter(
    (candidate) => candidate.kind !== "ocean"
  )) {
    const outer = ringsForWater(water.polygon)[0]
    const bankClearances: number[] = []
    for (const tile of WORLD.terrain.tiles) {
      for (let row = 0; row < tile.resolution[1]; row += 1) {
        for (let column = 0; column < tile.resolution[0]; column += 1) {
          const point: Vec2 = [
            tile.bounds[0] + column * tile.sampleSpacing,
            tile.bounds[1] + row * tile.sampleSpacing,
          ]
          if (isWater(point)) continue
          let shorelineDistance = Number.POSITIVE_INFINITY
          for (let index = 0; index < outer.length; index += 1) {
            shorelineDistance = Math.min(
              shorelineDistance,
              pointSegmentDistance(
                point,
                outer[index],
                outer[(index + 1) % outer.length]
              )
            )
          }
          if (shorelineDistance <= 6) {
            bankClearances.push(
              tile.heights[row * tile.resolution[0] + column] - water.waterLevel
            )
          }
        }
      }
    }
    bankClearances.sort((a, b) => a - b)
    const median = bankClearances[Math.floor(bankClearances.length / 2)]
    const p10 = bankClearances[Math.floor(bankClearances.length * 0.1)]
    assert.ok(
      p10 >= 0.75,
      `${water.id} lower-bank clearance ${p10.toFixed(3)}m`
    )
    assert.ok(
      median >= 0.95,
      `${water.id} median dry bank clearance ${median.toFixed(3)}m`
    )
  }
})

test("unprotected mainland has broad low and high ground", () => {
  const dryHeights: number[] = []
  for (const tile of WORLD.terrain.tiles) {
    for (let row = 0; row < tile.resolution[1]; row += 1) {
      for (let column = 0; column < tile.resolution[0]; column += 1) {
        const point: Vec2 = [
          tile.bounds[0] + column * tile.sampleSpacing,
          tile.bounds[1] + row * tile.sampleSpacing,
        ]
        if (!isWater(point)) {
          dryHeights.push(tile.heights[row * tile.resolution[0] + column])
        }
      }
    }
  }
  dryHeights.sort((a, b) => a - b)
  const p05 = dryHeights[Math.floor(dryHeights.length * 0.05)]
  const p95 = dryHeights[Math.floor(dryHeights.length * 0.95)]
  assert.ok(
    p95 - p05 >= 0.85,
    `dry terrain relief is only ${(p95 - p05).toFixed(3)}m`
  )
})
