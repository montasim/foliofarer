import polygonClipping, {
  type MultiPolygon,
  type Polygon,
  type Ring,
} from "polygon-clipping"

import type {
  AuthoredWaterBodyV3,
  Bounds2,
  Vec2,
  WaterKindV3,
} from "../contracts/world.ts"
import {
  circlePolygon,
  distance,
  orientedRectangle,
  pointInMultiPolygon,
  round,
} from "./geometry.ts"
import type { SampledRoad } from "./roads.ts"

const { difference, intersection, union } = polygonClipping
export const BRIDGE_DRY_LANDING_FACTOR_V3 = 0.7
export const MIN_BRIDGE_DRY_LANDING_FACTOR_V3 = 0.1
export const MAX_BRIDGE_DRY_LANDING_FACTOR_V3 = 1
export const MAX_BRIDGE_LATERAL_OFFSET_V3 = 2

export interface CompiledWaterShapeV3 {
  id: string
  kind: WaterKindV3
  waterLevel: number
  flowDirection: Vec2
  flowSpeed: number
  flowStrength: number
  /**
   * Signed bridge translation in metres. Positive is left of the crossing's
   * entry-to-exit tangent; the water surface itself is never translated.
   */
  bridgeLateralOffset?: number
  bridgeDryLandingFactor?: number
  multiPolygon: MultiPolygon
}

export interface BridgeCrossingDraftV3 {
  id: string
  roadId: string
  waterBodyId: string
  center: Vec2
  tangent: Vec2
  width: number
  length: number
  deckPolygon: Polygon
  entry: Vec2
  exit: Vec2
}

function closedPolygon(points: readonly Vec2[]): Polygon {
  if (points.length < 3) throw new Error("Water polygon requires three points")
  const ring: Ring = points.map(([x, z]) => [round(x, 5), round(z, 5)])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
  return [ring]
}

function lineWater(source: AuthoredWaterBodyV3) {
  const points = source.centerline
  const width = source.width
  if (!points || points.length < 2 || !width || width <= 0) {
    throw new Error(`${source.id} requires a centerline and positive width`)
  }
  const parts: Polygon[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    parts.push(
      orientedRectangle(
        [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
        [end[0] - start[0], end[1] - start[1]],
        distance(start, end) + 0.02,
        width
      )
    )
  }
  for (const point of points) parts.push(circlePolygon(point, width / 2, 18))
  return union(parts[0], ...parts.slice(1))
}

/**
 * Builds the authored water envelope without applying the playable-world
 * bounds. The regular compiler clips this envelope before it creates streamed
 * surfaces; the far-landscape compiler reuses it for visual-only continuation
 * beyond those bounds.
 */
export function compileWaterEnvelopeV3(source: AuthoredWaterBodyV3) {
  let shape = source.polygon
    ? ([closedPolygon(source.polygon)] as MultiPolygon)
    : lineWater(source)
  if (source.islands && source.islands.length > 0) {
    shape = difference(
      shape,
      ...source.islands.map((island) => closedPolygon(island))
    )
  }
  return shape
}

export function compileWaterShapes(
  sources: readonly AuthoredWaterBodyV3[],
  worldBounds: Bounds2
) {
  const boundsPolygon = closedPolygon([
    [worldBounds[0], worldBounds[1]],
    [worldBounds[2], worldBounds[1]],
    [worldBounds[2], worldBounds[3]],
    [worldBounds[0], worldBounds[3]],
  ])
  return sources.map<CompiledWaterShapeV3>((source) => {
    const bridgeLateralOffset = source.bridgeLateralOffset ?? 0
    const bridgeDryLandingFactor =
      source.bridgeDryLandingFactor ?? BRIDGE_DRY_LANDING_FACTOR_V3
    if (
      !Number.isFinite(bridgeLateralOffset) ||
      Math.abs(bridgeLateralOffset) > MAX_BRIDGE_LATERAL_OFFSET_V3
    ) {
      throw new Error(`${source.id} has invalid bridge lateral offset`)
    }
    if (
      !Number.isFinite(bridgeDryLandingFactor) ||
      bridgeDryLandingFactor < MIN_BRIDGE_DRY_LANDING_FACTOR_V3 ||
      bridgeDryLandingFactor > MAX_BRIDGE_DRY_LANDING_FACTOR_V3
    ) {
      throw new Error(`${source.id} has invalid bridge dry landing factor`)
    }
    const flowLength = Math.hypot(
      source.flowDirection[0],
      source.flowDirection[1]
    )
    if (
      !Number.isFinite(flowLength) ||
      flowLength < 0.001 ||
      !Number.isFinite(source.flowSpeed) ||
      source.flowSpeed < 0 ||
      source.flowSpeed > 1 ||
      !Number.isFinite(source.flowStrength) ||
      source.flowStrength < 0 ||
      source.flowStrength > 1
    ) {
      throw new Error(`${source.id} has invalid water-flow parameters`)
    }
    const shape = compileWaterEnvelopeV3(source)
    return {
      id: source.id,
      kind: source.kind,
      waterLevel: source.waterLevel,
      flowDirection: [
        round(source.flowDirection[0] / flowLength, 5),
        round(source.flowDirection[1] / flowLength, 5),
      ],
      flowSpeed: round(source.flowSpeed, 4),
      flowStrength: round(source.flowStrength, 4),
      ...(source.bridgeLateralOffset === undefined
        ? {}
        : { bridgeLateralOffset: round(bridgeLateralOffset, 4) }),
      ...(source.bridgeDryLandingFactor === undefined
        ? {}
        : { bridgeDryLandingFactor: round(bridgeDryLandingFactor, 4) }),
      multiPolygon: intersection(shape, boundsPolygon),
    }
  })
}

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector[0], vector[1])
  return length > 1e-6 ? [vector[0] / length, vector[1] / length] : [0, -1]
}

/**
 * Finds contiguous road samples inside each water polygon. A crossing is only
 * accepted when the road is grounded immediately before and after the run.
 */
export function deriveBridgeCrossings(
  roads: readonly SampledRoad[],
  waters: readonly CompiledWaterShapeV3[]
) {
  const crossings: BridgeCrossingDraftV3[] = []
  for (const road of roads) {
    for (const water of waters) {
      const inside = road.points.map((point) =>
        pointInMultiPolygon(point, water.multiPolygon)
      )
      let index = 0
      while (index < inside.length) {
        if (!inside[index]) {
          index += 1
          continue
        }
        const firstInside = index
        while (index + 1 < inside.length && inside[index + 1]) index += 1
        const lastInside = index
        const entryIndex = firstInside - 1
        const exitIndex = lastInside + 1
        if (entryIndex < 0 || exitIndex >= road.points.length) {
          throw new Error(
            `${road.source.id} enters ${water.id} without two grounded banks`
          )
        }
        const entry = road.points[entryIndex]
        const exit = road.points[exitIndex]
        const tangent = normalize([exit[0] - entry[0], exit[1] - entry[1]])
        const leftNormal: Vec2 = [tangent[1], -tangent[0]]
        const lateralTranslation: Vec2 = [
          leftNormal[0] * (water.bridgeLateralOffset ?? 0),
          leftNormal[1] * (water.bridgeLateralOffset ?? 0),
        ]
        const shiftedEntry: Vec2 = [
          entry[0] + lateralTranslation[0],
          entry[1] + lateralTranslation[1],
        ]
        const shiftedExit: Vec2 = [
          exit[0] + lateralTranslation[0],
          exit[1] + lateralTranslation[1],
        ]
        // Keep enough dry-bank run for the crowned deck profile without
        // carrying a straight river chord a full road width into a curved
        // approach. The remaining bank run belongs to the centered road loft.
        const dryLandingLength =
          road.source.width *
          (water.bridgeDryLandingFactor ?? BRIDGE_DRY_LANDING_FACTOR_V3)
        const length = distance(entry, exit) + dryLandingLength * 2
        const center: Vec2 = [
          (shiftedEntry[0] + shiftedExit[0]) / 2,
          (shiftedEntry[1] + shiftedExit[1]) / 2,
        ]
        crossings.push({
          id: `bridge.${road.source.id}.${water.id.replace(/^water\./, "")}`,
          roadId: road.source.id,
          waterBodyId: water.id,
          center,
          tangent,
          width: road.source.width + 1,
          length,
          deckPolygon: orientedRectangle(
            center,
            tangent,
            length,
            road.source.width + 1
          ),
          entry: shiftedEntry,
          exit: shiftedExit,
        })
        index += 1
      }
    }
  }
  return crossings
}

export function pointTouchesWater(
  point: Vec2,
  waters: readonly CompiledWaterShapeV3[]
) {
  return waters.find((water) => pointInMultiPolygon(point, water.multiPolygon))
}
