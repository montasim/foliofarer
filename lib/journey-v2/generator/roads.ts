import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import type {
  AuthoredCrosswalk,
  AuthoredRoad,
  Vec2,
} from "../contracts/world.ts"
import {
  circlePolygon,
  distance,
  lerp,
  normalize,
  orientedRectangle,
} from "./geometry.ts"

const { difference, intersection, union } = polygonClipping

export interface SampledRoad {
  source: AuthoredRoad
  points: Vec2[]
  cumulativeLengths: number[]
  length: number
}

export interface RoadSurfaces {
  road: MultiPolygon
  curb: MultiPolygon
  sidewalk: MultiPolygon
  outer: MultiPolygon
}

function chaikin(points: readonly Vec2[], iterations = 3) {
  let result = [...points]
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const refined: Vec2[] = [result[0]]
    for (let index = 0; index < result.length - 1; index += 1) {
      refined.push(lerp(result[index], result[index + 1], 0.25))
      refined.push(lerp(result[index], result[index + 1], 0.75))
    }
    refined.push(result[result.length - 1])
    result = refined
  }
  return result
}

function resamplePolyline(points: readonly Vec2[], spacing: number) {
  const cumulative = [0]
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + distance(points[index - 1], points[index])
    )
  }
  const total = cumulative[cumulative.length - 1]
  const count = Math.max(2, Math.ceil(total / spacing) + 1)
  const result: Vec2[] = []
  let segment = 0
  for (let index = 0; index < count; index += 1) {
    const target = (index / (count - 1)) * total
    while (
      segment < cumulative.length - 2 &&
      cumulative[segment + 1] < target
    ) {
      segment += 1
    }
    const segmentLength = cumulative[segment + 1] - cumulative[segment]
    const amount =
      segmentLength === 0 ? 0 : (target - cumulative[segment]) / segmentLength
    result.push(lerp(points[segment], points[segment + 1], amount))
  }
  return result
}

export function sampleRoad(source: AuthoredRoad, spacing: number): SampledRoad {
  const points = resamplePolyline(chaikin(source.controlPoints), spacing)
  const cumulativeLengths = [0]
  for (let index = 1; index < points.length; index += 1) {
    cumulativeLengths.push(
      cumulativeLengths[index - 1] + distance(points[index - 1], points[index])
    )
  }
  return {
    source,
    points,
    cumulativeLengths,
    length: cumulativeLengths[cumulativeLengths.length - 1],
  }
}

export function roadFrameAt(road: SampledRoad, progress: number) {
  const target = Math.max(0, Math.min(1, progress)) * road.length
  let segment = 0
  while (
    segment < road.cumulativeLengths.length - 2 &&
    road.cumulativeLengths[segment + 1] < target
  ) {
    segment += 1
  }
  const segmentLength =
    road.cumulativeLengths[segment + 1] - road.cumulativeLengths[segment]
  const amount =
    segmentLength === 0
      ? 0
      : (target - road.cumulativeLengths[segment]) / segmentLength
  const center = lerp(road.points[segment], road.points[segment + 1], amount)
  const tangent = normalize([
    road.points[segment + 1][0] - road.points[segment][0],
    road.points[segment + 1][1] - road.points[segment][1],
  ])
  const normal: Vec2 = [-tangent[1], tangent[0]]
  return { center, tangent, normal }
}

function bufferedRoadParts(road: SampledRoad, radius: number): Polygon[] {
  const left: [number, number][] = []
  const right: [number, number][] = []

  for (let index = 0; index < road.points.length; index += 1) {
    const current = road.points[index]
    const previous = road.points[Math.max(0, index - 1)]
    const next = road.points[Math.min(road.points.length - 1, index + 1)]
    const previousDirection = normalize([
      current[0] - previous[0] || next[0] - current[0],
      current[1] - previous[1] || next[1] - current[1],
    ])
    const nextDirection = normalize([
      next[0] - current[0] || current[0] - previous[0],
      next[1] - current[1] || current[1] - previous[1],
    ])
    const previousNormal: Vec2 = [-previousDirection[1], previousDirection[0]]
    const nextNormal: Vec2 = [-nextDirection[1], nextDirection[0]]
    const miter = normalize([
      previousNormal[0] + nextNormal[0],
      previousNormal[1] + nextNormal[1],
    ])
    const denominator = Math.max(
      0.55,
      miter[0] * nextNormal[0] + miter[1] * nextNormal[1]
    )
    const offset = Math.min(radius * 1.65, radius / denominator)
    left.push([
      Math.round((current[0] + miter[0] * offset) * 100_000) / 100_000,
      Math.round((current[1] + miter[1] * offset) * 100_000) / 100_000,
    ])
    right.push([
      Math.round((current[0] - miter[0] * offset) * 100_000) / 100_000,
      Math.round((current[1] - miter[1] * offset) * 100_000) / 100_000,
    ])
  }

  const ring = [...left, ...right.reverse(), left[0]]
  return [
    [ring],
    circlePolygon(road.points[0], radius, 16),
    circlePolygon(road.points[road.points.length - 1], radius, 16),
  ]
}

function unionAll(polygons: Polygon[]) {
  if (polygons.length === 0) return [] as MultiPolygon
  return union(polygons[0], ...polygons.slice(1))
}

export function createRoadSurfaces(
  roads: readonly SampledRoad[],
  curbWidth: number,
  sidewalkWidth: number
): RoadSurfaces {
  const roadParts = roads.flatMap((road) =>
    bufferedRoadParts(road, road.source.width / 2)
  )
  const curbOuterParts = roads.flatMap((road) =>
    bufferedRoadParts(road, road.source.width / 2 + curbWidth)
  )
  const outerParts = roads.flatMap((road) =>
    bufferedRoadParts(road, road.source.width / 2 + curbWidth + sidewalkWidth)
  )

  const road = unionAll(roadParts)
  const curbOuter = unionAll(curbOuterParts)
  const outer = unionAll(outerParts)

  return {
    road,
    curb: difference(curbOuter, road),
    sidewalk: difference(outer, curbOuter),
    outer,
  }
}

export function createCrosswalkPolygon(
  source: AuthoredCrosswalk,
  road: SampledRoad,
  curbWidth: number,
  sidewalkWidth: number
) {
  const frame = roadFrameAt(road, source.progress)
  const crossingLength =
    road.source.width + (curbWidth + sidewalkWidth * 0.62) * 2
  const polygon = orientedRectangle(
    frame.center,
    frame.normal,
    crossingLength,
    source.width
  )
  return {
    source,
    frame,
    polygon,
    rotationY: Math.atan2(frame.normal[0], frame.normal[1]),
  }
}

export function clipMultiPolygon(
  geometry: MultiPolygon,
  clip: Polygon
): MultiPolygon {
  if (geometry.length === 0) return []
  return intersection(geometry, clip)
}
