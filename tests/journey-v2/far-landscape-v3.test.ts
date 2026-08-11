import assert from "node:assert/strict"
import test from "node:test"

import {
  FAR_LANDSCAPE_GEOMETRY_ID_V3,
  FAR_LANDSCAPE_MATERIAL_ID_V3,
  type WaterBodyManifestV3,
  type Vec2,
} from "../../lib/journey-v2/contracts/world.ts"
import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import {
  FAR_LANDSCAPE_APRON_V3,
  FAR_LANDSCAPE_MAX_TRIANGLES_V3,
  FAR_LANDSCAPE_WATER_DEPTH_OFFSET_V3,
  isSharedJourneyGeometryV3,
} from "../../lib/journey-v2/generator/far-landscape.ts"

function colorTriples(colors: readonly number[]) {
  const triples = new Set<string>()
  for (let index = 0; index < colors.length; index += 3) {
    triples.add(
      colors
        .slice(index, index + 3)
        .map((value) => value.toFixed(5))
        .join(",")
    )
  }
  return triples
}

function pointInRing(point: Vec2, ring: readonly Vec2[]) {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    if (
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1] || Number.EPSILON) +
          currentPoint[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

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

function distanceToRing(point: Vec2, ring: readonly Vec2[]) {
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < ring.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(point, ring[index], ring[(index + 1) % ring.length])
    )
  }
  return nearest
}

function waterRings(polygon: Vec2[] | Vec2[][]) {
  return (
    Array.isArray(polygon[0]?.[0]) ? polygon : [polygon]
  ) as readonly (readonly Vec2[])[]
}

function pointInWater(point: Vec2, polygon: Vec2[] | Vec2[][]) {
  const rings = waterRings(polygon)
  return (
    pointInRing(point, rings[0]) &&
    !rings.slice(1).some((hole) => pointInRing(point, hole))
  )
}

function representativeWaterPoint(water: WaterBodyManifestV3): Vec2 {
  const source = JOURNEY_V3_WORLD.waterBodies.find(
    (candidate) => candidate.id === water.id
  )
  if (source?.centerline && source.centerline.length > 2) {
    return source.centerline[1]
  }

  const rings = waterRings(water.polygon)
  const outer = rings[0]
  const minimumX = Math.min(...outer.map((point) => point[0]))
  const maximumX = Math.max(...outer.map((point) => point[0]))
  const minimumZ = Math.min(...outer.map((point) => point[1]))
  const maximumZ = Math.max(...outer.map((point) => point[1]))
  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      const point: Vec2 = [
        minimumX + ((maximumX - minimumX) * column) / 12,
        minimumZ + ((maximumZ - minimumZ) * row) / 12,
      ]
      if (
        pointInWater(point, water.polygon) &&
        Math.min(...rings.map((ring) => distanceToRing(point, ring))) > 0.35
      ) {
        return point
      }
    }
  }
  throw new Error(`${water.id} has no representative open-water point`)
}

function triangleHeightAt(
  positions: readonly number[],
  indices: readonly number[],
  triangleOffset: number,
  point: Vec2
) {
  const a = indices[triangleOffset] * 3
  const b = indices[triangleOffset + 1] * 3
  const c = indices[triangleOffset + 2] * 3
  const ax = positions[a]
  const az = positions[a + 2]
  const bx = positions[b]
  const bz = positions[b + 2]
  const cx = positions[c]
  const cz = positions[c + 2]
  if (
    point[0] < Math.min(ax, bx, cx) - 1e-6 ||
    point[0] > Math.max(ax, bx, cx) + 1e-6 ||
    point[1] < Math.min(az, bz, cz) - 1e-6 ||
    point[1] > Math.max(az, bz, cz) + 1e-6
  ) {
    return null
  }
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(denominator) <= 1e-9) return null
  const weightA =
    ((bz - cz) * (point[0] - cx) + (cx - bx) * (point[1] - cz)) / denominator
  const weightB =
    ((cz - az) * (point[0] - cx) + (ax - cx) * (point[1] - cz)) / denominator
  const weightC = 1 - weightA - weightB
  if (weightA < -1e-6 || weightB < -1e-6 || weightC < -1e-6) return null
  return (
    weightA * positions[a + 1] +
    weightB * positions[b + 1] +
    weightC * positions[c + 1]
  )
}

function surfaceHeightsAt(
  geometry: {
    positions: readonly number[]
    indices: readonly number[]
  },
  point: Vec2
) {
  const heights: number[] = []
  for (
    let triangleOffset = 0;
    triangleOffset < geometry.indices.length;
    triangleOffset += 3
  ) {
    const height = triangleHeightAt(
      geometry.positions,
      geometry.indices,
      triangleOffset,
      point
    )
    if (height !== null) heights.push(height)
  }
  return heights
}

test("the deterministic far landscape covers the streamed world without joining traversal", () => {
  const first = compileJourneyWorldV3()
  const second = compileJourneyWorldV3()
  const geometry = first.geometries.find(
    (candidate) => candidate.id === FAR_LANDSCAPE_GEOMETRY_ID_V3
  )
  const repeated = second.geometries.find(
    (candidate) => candidate.id === FAR_LANDSCAPE_GEOMETRY_ID_V3
  )
  assert.ok(geometry)
  assert.deepEqual(geometry, repeated)
  assert.equal(geometry.kind, "primitive")
  assert.equal(geometry.materialId, FAR_LANDSCAPE_MATERIAL_ID_V3)
  assert.equal(geometry.walkable, false)
  assert.equal(geometry.colors?.length, geometry.positions.length)
  assert.ok(geometry.indices.length > 0)
  assert.ok(
    geometry.indices.length / 3 < FAR_LANDSCAPE_MAX_TRIANGLES_V3,
    "the complete far landscape remains below its triangle budget"
  )

  const xCoordinates = geometry.positions.filter((_, index) => index % 3 === 0)
  const zCoordinates = geometry.positions.filter((_, index) => index % 3 === 2)
  assert.ok(
    Math.min(...xCoordinates) <=
      JOURNEY_V3_WORLD.bounds[0] - FAR_LANDSCAPE_APRON_V3
  )
  assert.ok(
    Math.max(...xCoordinates) >=
      JOURNEY_V3_WORLD.bounds[2] + FAR_LANDSCAPE_APRON_V3
  )
  assert.ok(
    Math.min(...zCoordinates) <=
      JOURNEY_V3_WORLD.bounds[1] - FAR_LANDSCAPE_APRON_V3
  )
  assert.ok(
    Math.max(...zCoordinates) >=
      JOURNEY_V3_WORLD.bounds[3] + FAR_LANDSCAPE_APRON_V3
  )

  assert.equal(
    first.cells.some((cell) =>
      cell.geometryIds.includes(FAR_LANDSCAPE_GEOMETRY_ID_V3)
    ),
    false,
    "the proxy is never streamed or registered as a traversal cell surface"
  )
  assert.equal(isSharedJourneyGeometryV3(geometry), true)
})

test("the shared proxy retains terrain, complete road markings, and every water silhouette", () => {
  const world = compileJourneyWorldV3()
  const geometry = world.geometries.find(
    (candidate) => candidate.id === FAR_LANDSCAPE_GEOMETRY_ID_V3
  )
  const material = world.materials.find(
    (candidate) => candidate.id === FAR_LANDSCAPE_MATERIAL_ID_V3
  )
  assert.ok(geometry)
  assert.ok(material)
  assert.equal(material.kind, "toon")
  assert.equal(material.vertexColors, true)

  const colors = colorTriples(geometry.colors ?? [])
  assert.ok(
    colors.size >= 8,
    "terrain variation, road, markings, river, pond, and ocean remain distinct"
  )

  for (const road of world.roads) {
    for (const endpoint of [
      road.centerline[0],
      road.centerline[road.centerline.length - 1],
    ]) {
      assert.ok(
        geometry.positions.some((value, index) => {
          if (index % 3 !== 0) return false
          return (
            Math.hypot(
              value - endpoint[0],
              geometry.positions[index + 2] - endpoint[2]
            ) <=
            road.width * 0.9
          )
        }),
        `${road.id} reaches its proxy endpoint`
      )
    }
  }

  for (const water of world.waterBodies) {
    const point = representativeWaterPoint(water)
    const expectedHeight =
      water.waterLevel - FAR_LANDSCAPE_WATER_DEPTH_OFFSET_V3
    assert.ok(
      surfaceHeightsAt(geometry, point).some(
        (height) => Math.abs(height - expectedHeight) <= 0.002
      ),
      `${water.id} keeps visible open water in the shared proxy`
    )
  }
})

test("coarse proxy terrain never covers river, pond, or ocean water away from bridges", () => {
  const world = compileJourneyWorldV3()
  const geometry = world.geometries.find(
    (candidate) => candidate.id === FAR_LANDSCAPE_GEOMETRY_ID_V3
  )
  assert.ok(geometry)

  for (const water of world.waterBodies) {
    const rings = waterRings(water.polygon)
    const outer = rings[0]
    const minimumX = Math.min(...outer.map((point) => point[0]))
    const maximumX = Math.max(...outer.map((point) => point[0]))
    const minimumZ = Math.min(...outer.map((point) => point[1]))
    const maximumZ = Math.max(...outer.map((point) => point[1]))
    let samples = 0

    for (
      let z = minimumZ + 0.7;
      z < maximumZ - 0.7 && samples < 64;
      z += 3.25
    ) {
      for (
        let x = minimumX + 0.7;
        x < maximumX - 0.7 && samples < 64;
        x += 3.25
      ) {
        const point: Vec2 = [x, z]
        if (
          !pointInRing(point, outer) ||
          rings.slice(1).some((hole) => pointInRing(point, hole)) ||
          Math.min(...rings.map((ring) => distanceToRing(point, ring))) < 0.35
        ) {
          continue
        }
        const nearRoad = world.roads.some((road) => {
          let distance = Number.POSITIVE_INFINITY
          for (let index = 0; index < road.centerline.length - 1; index += 1) {
            distance = Math.min(
              distance,
              pointSegmentDistance(
                point,
                [road.centerline[index][0], road.centerline[index][2]],
                [road.centerline[index + 1][0], road.centerline[index + 1][2]]
              )
            )
          }
          return distance <= road.width / 2 + 2.5
        })
        if (nearRoad) continue

        const heights = surfaceHeightsAt(geometry, point)
        assert.ok(heights.length > 0, `${water.id} remains visibly surfaced`)
        const visibleHeight = Math.max(...heights)
        const containingWater = world.waterBodies.filter((candidate) =>
          pointInWater(point, candidate.polygon)
        )
        const expectedProxyHeight = Math.max(
          ...containingWater.map(
            (candidate) =>
              candidate.waterLevel - FAR_LANDSCAPE_WATER_DEPTH_OFFSET_V3
          )
        )
        assert.ok(
          Math.abs(visibleHeight - expectedProxyHeight) <= 0.002,
          `${water.id} proxy water is not covered by coarse terrain at ${point.join(",")}`
        )
        assert.ok(
          visibleHeight <
            Math.max(
              ...containingWater.map((candidate) => candidate.waterLevel)
            ),
          `${water.id} proxy remains beneath loaded animated water`
        )
        samples += 1
      }
    }
    assert.ok(samples >= 4, `${water.id} validates multiple open-water points`)
  }
})
