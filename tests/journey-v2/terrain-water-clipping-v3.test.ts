import assert from "node:assert/strict"
import test from "node:test"

import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import type {
  GeometryDefinitionV3,
  Vec2,
} from "../../lib/journey-v2/contracts/world.ts"
import { pointInMultiPolygon } from "../../lib/journey-v2/generator/geometry.ts"
import { compileWaterShapes } from "../../lib/journey-v2/generator/hydrology.ts"
import { sampleRoad } from "../../lib/journey-v2/generator/roads.ts"
import {
  compileTerrainTiles,
  createCellSkeletonsV3,
  createTerrainField,
} from "../../lib/journey-v2/generator/terrain.ts"

function triangleContains(
  geometry: GeometryDefinitionV3,
  triangleOffset: number,
  point: Vec2
) {
  const a = geometry.indices[triangleOffset] * 3
  const b = geometry.indices[triangleOffset + 1] * 3
  const c = geometry.indices[triangleOffset + 2] * 3
  const ax = geometry.positions[a]
  const az = geometry.positions[a + 2]
  const bx = geometry.positions[b]
  const bz = geometry.positions[b + 2]
  const cx = geometry.positions[c]
  const cz = geometry.positions[c + 2]
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(denominator) <= 1e-9) return false
  const weightA =
    ((bz - cz) * (point[0] - cx) + (cx - bx) * (point[1] - cz)) /
    denominator
  const weightB =
    ((cz - az) * (point[0] - cx) + (ax - cx) * (point[1] - cz)) /
    denominator
  const weightC = 1 - weightA - weightB
  return weightA > 1e-5 && weightB > 1e-5 && weightC > 1e-5
}

function terrainCovers(
  geometries: readonly GeometryDefinitionV3[],
  point: Vec2
) {
  return geometries.some((geometry) => {
    for (
      let triangleOffset = 0;
      triangleOffset < geometry.indices.length;
      triangleOffset += 3
    ) {
      if (triangleContains(geometry, triangleOffset, point)) return true
    }
    return false
  })
}

test("detailed terrain is clipped away from river interiors and world-edge seams", () => {
  const sampledRoads = JOURNEY_V3_WORLD.roads.map((road) =>
    sampleRoad(road, JOURNEY_V3_WORLD.roadSampleSpacing)
  )
  const waters = compileWaterShapes(
    JOURNEY_V3_WORLD.waterBodies,
    JOURNEY_V3_WORLD.bounds
  )
  const field = createTerrainField(
    JOURNEY_V3_WORLD,
    sampledRoads,
    waters
  )
  const cells = createCellSkeletonsV3(JOURNEY_V3_WORLD)
  const terrain = compileTerrainTiles(
    JOURNEY_V3_WORLD,
    cells,
    field,
    waters
  )

  for (const source of JOURNEY_V3_WORLD.waterBodies.filter(
    (water) => water.kind === "river"
  )) {
    assert.ok(source.centerline)
    const water = waters.find((candidate) => candidate.id === source.id)
    assert.ok(water)
    const probes: Vec2[] = source.centerline.slice(1, -1)

    for (const edge of ["start", "end"] as const) {
      const endpointIndex = edge === "start" ? 0 : source.centerline.length - 1
      const neighbourIndex = edge === "start" ? 1 : source.centerline.length - 2
      const endpoint = source.centerline[endpointIndex]
      const neighbour = source.centerline[neighbourIndex]
      const length = Math.hypot(
        neighbour[0] - endpoint[0],
        neighbour[1] - endpoint[1]
      )
      const inward: Vec2 = [
        (neighbour[0] - endpoint[0]) / length,
        (neighbour[1] - endpoint[1]) / length,
      ]
      const normal: Vec2 = [-inward[1], inward[0]]
      const seamCenter: Vec2 = [
        // Keep the full cross-channel probe just inside the clipped world
        // envelope even where a river reaches the boundary on a diagonal.
        endpoint[0] + inward[0] * 2,
        endpoint[1] + inward[1] * 2,
      ]
      for (const channelOffset of [
        0,
        -source.width! * 0.2,
        source.width! * 0.2,
        -source.width! * 0.4,
        source.width! * 0.4,
      ]) {
        probes.push([
          seamCenter[0] + normal[0] * channelOffset,
          seamCenter[1] + normal[1] * channelOffset,
        ])
      }
    }

    for (const point of probes) {
      assert.equal(
        pointInMultiPolygon(point, water.multiPolygon),
        true,
        `${source.id} probe remains inside its compiled water`
      )
      assert.equal(
        terrainCovers(terrain.geometries, point),
        false,
        `${source.id} has no green terrain triangle over open water at ${point.join(",")}`
      )
    }
  }
})
