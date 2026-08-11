import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import type {
  AuthoredLandmark,
  AuthoredWorld,
  BuildingManifest,
  ColliderManifest,
  GeometryDefinition,
  LandmarkManifest,
  Vec2,
  Vec3,
} from "../contracts/world.ts"
import {
  boundsOfPoints,
  distance,
  multiPolygonArea,
  orientedRectangle,
  polygonArea,
  round,
} from "./geometry.ts"
import type { SampledRoad } from "./roads.ts"
import { roadFrameAt } from "./roads.ts"
import { createSeededRandom, hashString } from "./random.ts"

const { intersection } = polygonClipping

export interface CompiledBuilding {
  id: string
  districtId: string
  style: AuthoredLandmark["style"]
  height: number
  landmark: AuthoredLandmark | null
  footprintPolygon: Polygon
  accessPolygon: Polygon
  center: Vec2
  entrance: Vec3
  checkpoint: Vec3
  rotationY: number
}

interface BuildingPlacementInput {
  id: string
  districtId: string
  style: AuthoredLandmark["style"]
  height: number
  landmark: AuthoredLandmark | null
  roadId: string
  roadProgress: number
  roadSide: -1 | 1
  setback: number
  footprint: readonly [width: number, depth: number]
}

function asMultiPolygon(polygon: Polygon): MultiPolygon {
  return [polygon]
}

function assertClearOfSurface(
  label: string,
  footprint: Polygon,
  surface: MultiPolygon
) {
  const overlap = intersection(asMultiPolygon(footprint), surface)
  if (multiPolygonArea(overlap) > 0.001) {
    throw new Error(`${label} footprint intersects a protected street surface`)
  }
}

function createBuildingPlacement(
  input: BuildingPlacementInput,
  world: AuthoredWorld,
  sampledRoads: ReadonlyMap<string, SampledRoad>
) {
  const road = sampledRoads.get(input.roadId)
  if (!road)
    throw new Error(`${input.id} references missing road ${input.roadId}`)
  const frame = roadFrameAt(road, input.roadProgress)
  const outward: Vec2 = [
    frame.normal[0] * input.roadSide,
    frame.normal[1] * input.roadSide,
  ]
  const roadOuter =
    road.source.width / 2 + world.curbWidth + world.sidewalkWidth
  const centerDistance = roadOuter + input.setback + input.footprint[1] / 2
  const center: Vec2 = [
    frame.center[0] + outward[0] * centerDistance,
    frame.center[1] + outward[1] * centerDistance,
  ]
  const footprintPolygon = orientedRectangle(
    center,
    frame.tangent,
    input.footprint[0],
    input.footprint[1]
  )
  const entrancePoint: Vec2 = [
    center[0] - (outward[0] * input.footprint[1]) / 2,
    center[1] - (outward[1] * input.footprint[1]) / 2,
  ]
  const accessStart: Vec2 = [
    frame.center[0] + outward[0] * (roadOuter - 0.015),
    frame.center[1] + outward[1] * (roadOuter - 0.015),
  ]
  const accessCenter: Vec2 = [
    (accessStart[0] + entrancePoint[0]) / 2,
    (accessStart[1] + entrancePoint[1]) / 2,
  ]
  const accessPolygon = orientedRectangle(
    accessCenter,
    outward,
    distance(accessStart, entrancePoint) + 0.03,
    Math.min(2.4, Math.max(1.4, input.footprint[0] * 0.16))
  )
  const checkpointOffset = input.landmark
    ? Math.min(2.4, input.setback * 0.5)
    : 0.7

  return {
    id: input.id,
    districtId: input.districtId,
    style: input.style,
    height: input.height,
    landmark: input.landmark,
    footprintPolygon,
    accessPolygon,
    center,
    entrance: [round(entrancePoint[0]), 0.06, round(entrancePoint[1])] as Vec3,
    checkpoint: [
      round(entrancePoint[0] - outward[0] * checkpointOffset),
      0.06,
      round(entrancePoint[1] - outward[1] * checkpointOffset),
    ] as Vec3,
    rotationY: Math.atan2(frame.tangent[0], frame.tangent[1]),
  } satisfies CompiledBuilding
}

function placementIsClear(
  candidate: CompiledBuilding,
  streetOuter: MultiPolygon,
  roadSurface: MultiPolygon,
  existing: readonly CompiledBuilding[]
) {
  if (
    multiPolygonArea(
      intersection(asMultiPolygon(candidate.footprintPolygon), streetOuter)
    ) > 0.001
  ) {
    return false
  }
  if (
    multiPolygonArea(
      intersection(asMultiPolygon(candidate.accessPolygon), roadSurface)
    ) > 0.001
  ) {
    return false
  }
  for (const building of existing) {
    if (
      multiPolygonArea(
        intersection(
          asMultiPolygon(candidate.footprintPolygon),
          asMultiPolygon(building.footprintPolygon)
        )
      ) > 0.001
    ) {
      return false
    }
    // Driveways may meet the public sidewalk, but may not pass through another
    // complete building footprint or another building's entrance path.
    if (
      multiPolygonArea(
        intersection(
          asMultiPolygon(candidate.accessPolygon),
          asMultiPolygon(building.footprintPolygon)
        )
      ) > 0.001 ||
      multiPolygonArea(
        intersection(
          asMultiPolygon(candidate.footprintPolygon),
          asMultiPolygon(building.accessPolygon)
        )
      ) > 0.001
    ) {
      return false
    }
  }
  return true
}

export function compileBuildings(
  world: AuthoredWorld,
  sampledRoads: ReadonlyMap<string, SampledRoad>,
  streetOuter: MultiPolygon,
  roadSurface: MultiPolygon
) {
  const compiled: CompiledBuilding[] = []

  for (const source of world.landmarks) {
    const candidate = createBuildingPlacement(
      {
        id: source.id,
        districtId: source.districtId,
        style: source.style,
        height: source.height,
        landmark: source,
        roadId: source.roadId,
        roadProgress: source.roadProgress,
        roadSide: source.roadSide,
        setback: source.setback,
        footprint: source.footprint,
      },
      world,
      sampledRoads
    )
    assertClearOfSurface(source.id, candidate.footprintPolygon, streetOuter)
    if (!placementIsClear(candidate, streetOuter, roadSurface, compiled)) {
      throw new Error(`${source.id} overlaps another building or entrance path`)
    }
    compiled.push(candidate)
  }

  const random = createSeededRandom(world.seed ^ hashString("residential"))
  const roads = [...sampledRoads.values()]
  for (const road of roads) {
    const slots = Math.max(3, Math.floor(road.length / 11.5))
    for (let slot = 1; slot < slots; slot += 1) {
      for (const side of [-1, 1] as const) {
        if (random() > 0.84) continue
        const progress = (slot + 0.16 + random() * 0.55) / slots
        if (progress < 0.12 || progress > 0.9) continue
        const width = 6.2 + random() * 2.4
        const depth = 5.4 + random() * 1.8
        const id = `house.${road.source.id}.${slot}.${side === -1 ? "l" : "r"}`
        const candidate = createBuildingPlacement(
          {
            id,
            districtId: road.source.districtId,
            style: "residential",
            height: 3.8 + random() * 1.5,
            landmark: null,
            roadId: road.source.id,
            roadProgress: progress,
            roadSide: side,
            setback: 3.2 + random() * 2,
            footprint: [width, depth],
          },
          world,
          sampledRoads
        )
        if (!placementIsClear(candidate, streetOuter, roadSurface, compiled))
          continue
        compiled.push(candidate)
      }
    }
  }

  if (compiled.filter((building) => !building.landmark).length < 8) {
    throw new Error("Residential generator produced too few valid houses")
  }

  return compiled
}

export function landmarkBuildings(buildings: readonly CompiledBuilding[]) {
  return buildings.filter(
    (building): building is CompiledBuilding & { landmark: AuthoredLandmark } =>
      building.landmark !== null
  )
}

export function createBuildingGeometry(
  building: CompiledBuilding,
  materialId: string
): GeometryDefinition {
  const ring = building.footprintPolygon[0].slice(0, -1)
  const positions: number[] = []
  const indices: number[] = []
  const height = building.height

  for (const [x, z] of ring) positions.push(round(x), 0, round(z))
  for (const [x, z] of ring) positions.push(round(x), round(height), round(z))
  const count = ring.length
  const ringIsCounterClockwise = polygonArea(ring) > 0

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    if (ringIsCounterClockwise) {
      indices.push(
        index,
        count + next,
        next,
        index,
        count + index,
        count + next
      )
    } else {
      indices.push(
        index,
        next,
        count + next,
        index,
        count + next,
        count + index
      )
    }
  }

  // The roof is triangulated as a convex fan. Parametric buildings currently
  // use rectangular footprints, so no runtime CSG or triangulation is needed.
  for (let index = 1; index < count - 1; index += 1) {
    if (ringIsCounterClockwise) {
      indices.push(count, count + index + 1, count + index)
    } else {
      indices.push(count, count + index, count + index + 1)
    }
  }

  return {
    id: `building.${building.id}`,
    kind: "building",
    materialId,
    y: 0,
    positions,
    indices,
  }
}

export function toBuildingManifest(
  building: CompiledBuilding,
  cellId: string,
  materialId: string
): BuildingManifest {
  return {
    id: `building.${building.id}`,
    landmarkId: building.landmark?.id ?? null,
    districtId: building.districtId,
    cellId,
    style: building.style,
    footprint: building.footprintPolygon[0]
      .slice(0, -1)
      .map(([x, z]) => [round(x), round(z)] as Vec2),
    height: round(building.height),
    entrance: building.entrance,
    geometryId: `building.${building.id}`,
    materialId,
  }
}

export function toBuildingCollider(
  building: CompiledBuilding,
  cellId: string
): ColliderManifest {
  return {
    id: `collider.building.${building.id}`,
    kind: "polygon",
    cellId,
    polygon: building.footprintPolygon[0]
      .slice(0, -1)
      .map(([x, z]) => [round(x), round(z)] as Vec2),
    minY: 0,
    maxY: round(building.height),
  }
}

export function landmarkSkeleton(
  building: CompiledBuilding & { landmark: AuthoredLandmark },
  navNodeId: string
): LandmarkManifest {
  return {
    id: building.landmark.id,
    title: building.landmark.title,
    shortTitle: building.landmark.shortTitle,
    districtId: building.landmark.districtId,
    kind: building.landmark.kind,
    routeOrder: building.landmark.routeOrder,
    position: building.checkpoint,
    entrance: building.entrance,
    buildingId: `building.${building.id}`,
    navNodeId,
  }
}

export function buildingBounds(buildings: readonly CompiledBuilding[]) {
  return boundsOfPoints(
    buildings.flatMap((building) =>
      building.footprintPolygon[0].slice(0, -1).map(([x, z]) => [x, z] as Vec2)
    )
  )
}
