import fs from "node:fs"
import { expect, test } from "@playwright/test"
import * as THREE from "three"
import { JourneyCollisionWorld } from "../../lib/journey-v2/runtime/collision-world"
import type { JourneyWorldManifest } from "../../lib/journey-v2/runtime/types"
import { JourneyNavigation } from "../../lib/journey-v2/runtime/navigation"
import { JourneySurfaceWorld } from "../../lib/journey-v2/runtime/surface-world"
import { assertJourneyWorldManifest } from "../../lib/journey-v2/runtime/world-loader"

function runtimeManifest() {
  return {
    schemaVersion: 3,
    generatorVersion: "runtime-test",
    checksum: "runtime-test-checksum",
    seed: 42,
    units: "metres",
    scope: "vertical-slice",
    world: {
      bounds: [0, 0, 8, 4],
      cellSize: 2,
      spawn: [0.5, 0, 0.5],
      heightRange: [0, 4],
      waterLevel: 0.4,
    },
    materials: [],
    geometries: [],
    cells: [],
    roads: [],
    accessJunctions: [],
    portfolioRecords: [],
    checkpoints: [],
    terrain: {
      sampleSpacing: 1,
      tiles: [
        {
          id: "terrain.west",
          cellId: "west",
          bounds: [0, 0, 2, 2],
          resolution: [3, 3],
          sampleSpacing: 1,
          heights: [0, 0.1, 0.2, 0, 0.1, 0.2, 0, 0.1, 0.2],
          minHeight: 0,
          maxHeight: 0.2,
          geometryId: "terrain.west",
          checksum: "terrain-west",
        },
        {
          id: "terrain.east",
          cellId: "east",
          bounds: [2, 0, 4, 2],
          resolution: [3, 3],
          sampleSpacing: 1,
          heights: [0.2, 0.3, 0.4, 0.2, 0.3, 0.4, 0.2, 0.3, 0.4],
          minHeight: 0.2,
          maxHeight: 0.4,
          geometryId: "terrain.east",
          checksum: "terrain-east",
        },
        {
          id: "terrain.steep",
          cellId: "steep",
          bounds: [4, 0, 6, 2],
          resolution: [3, 3],
          sampleSpacing: 1,
          heights: [0, 2, 4, 0, 2, 4, 0, 2, 4],
          minHeight: 0,
          maxHeight: 4,
          geometryId: "terrain.steep",
          checksum: "terrain-steep",
        },
      ],
    },
    waterBodies: [
      {
        id: "river",
        kind: "river",
        polygon: [
          [1, 0],
          [3, 0],
          [3, 2],
          [1, 2],
        ],
        waterLevel: 0.4,
        geometryIds: [],
        walkable: false,
      },
    ],
    bridges: [
      {
        id: "bridge",
        roadId: "road",
        waterBodyId: "river",
        center: [2, 0.8, 1],
        tangent: [1, 0],
        width: 0.6,
        length: 2,
        deckHeight: 0.8,
        deckPolygon: [
          [1, 0.7],
          [3, 0.7],
          [3, 1.3],
          [1, 1.3],
        ],
        geometryIds: [],
        railColliderIds: ["bridge.rail.left", "bridge.rail.right"],
        navNodeIds: ["bridge.a", "bridge.b"],
        walkable: true,
      },
    ],
    biomes: [],
    environmentalBuildings: [],
    instanceBatches: [],
    colliders: [],
    navigation: {
      nodes: [],
      edges: [],
      checkpointNodeIds: {},
    },
    validation: { valid: true, counts: {}, warnings: [] },
  } as unknown as JourneyWorldManifest
}

test("samples seamless terrain and lets bridge decks override water", () => {
  const surfaces = new JourneySurfaceWorld(runtimeManifest())

  const sharedEdge = surfaces.sample(2, 2)
  expect(sharedEdge.kind).toBe("terrain")
  expect(sharedEdge.height).toBeCloseTo(0.2, 6)

  const dryWest = surfaces.sample(0.75, 2)
  expect(dryWest.height).toBeCloseTo(0.075, 5)
  expect(dryWest.walkable).toBe(true)

  const river = surfaces.sample(1.4, 0.4)
  expect(river.kind).toBe("water")
  expect(river.walkable).toBe(false)

  const bridge = surfaces.sample(2, 1)
  expect(bridge.kind).toBe("bridge")
  expect(bridge.height).toBeCloseTo(0.8, 6)
  expect(bridge.walkable).toBe(true)
})

test("profiled bridges follow streamed crown triangles and ignore supports", () => {
  const manifest = runtimeManifest()
  if (manifest.schemaVersion !== 3) throw new Error("Expected Journey V3")
  manifest.bridges[0].deckCenterline = [
    [1, 0.62, 1],
    [2, 1.02, 1],
    [3, 0.62, 1],
  ]
  // Deliberately stale/high compatibility metadata proves the triangle surface
  // is authoritative when a sampled profile is present.
  manifest.bridges[0].deckHeight = 2.4
  manifest.geometries = [
    {
      id: "geometry.bridge.profiled.deck",
      kind: "bridge",
      materialId: "surface.road-summer",
      y: 0,
      walkable: true,
      positions: [
        1, 0.62, 0.7, 1, 0.62, 1.3, 2, 1.02, 0.7, 2, 1.02, 1.3, 3, 0.62, 0.7, 3,
        0.62, 1.3,
      ],
      indices: [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3],
    },
    {
      id: "geometry.bridge.profiled.support",
      kind: "bridge",
      materialId: "surface.bridge-support",
      y: 0,
      walkable: false,
      positions: [1.8, 3, 0.8, 2.2, 3, 0.8, 2, 3, 1.2],
      indices: [0, 1, 2],
    },
  ]

  const surfaces = new JourneySurfaceWorld(manifest)
  const entry = surfaces.sample(1.1, 1)
  const crown = surfaces.sample(2, 1)
  const exit = surfaces.sample(2.9, 1)

  expect(entry.kind).toBe("bridge")
  expect(crown.kind).toBe("bridge")
  expect(crown.sourceId).toBe("geometry.bridge.profiled.deck")
  expect(crown.height).toBeCloseTo(1.02, 6)
  expect(crown.height).toBeGreaterThan(entry.height)
  expect(crown.height).toBeGreaterThan(exit.height)
  expect(crown.height).toBeLessThan(manifest.bridges[0].deckHeight)

  const uphill = surfaces.resolveMovement([1.1, entry.height, 1], 1.5, 1)
  expect(uphill.accepted).toBe(true)
  expect(uphill.y).toBeGreaterThan(entry.height)
  expect(surfaces.sample(1.4, 0.4).kind).toBe("water")
})

test("grounds dry-road movement to the visible traversal surface", () => {
  const manifest = runtimeManifest()
  manifest.geometries = [
    {
      id: "geometry.road.test",
      kind: "surface",
      materialId: "surface.road-summer",
      y: 0,
      positions: [
        0.2, 0.42, 0.2, 0.8, 0.42, 0.2, 0.2, 0.42, 0.8, 0.8, 0.42, 0.8,
      ],
      indices: [0, 2, 1, 1, 2, 3],
    },
  ]

  const road = new JourneySurfaceWorld(manifest).sample(0.5, 0.5)
  expect(road.kind).toBe("road")
  expect(road.height).toBeCloseTo(0.42, 6)
})

test("rejects water and steep terrain during movement", () => {
  const surfaces = new JourneySurfaceWorld(runtimeManifest())

  const waterMove = surfaces.resolveMovement([0.75, 0.075, 0.4], 1.4, 0.4)
  expect(waterMove.accepted).toBe(false)
  expect(waterMove.x).toBe(0.75)

  const bridgeMove = surfaces.resolveMovement([1.2, 0.8, 1], 2, 1)
  expect(bridgeMove.accepted).toBe(true)
  expect(bridgeMove.y).toBeCloseTo(0.8, 6)

  const steepMove = surfaces.resolveMovement([4, 0, 1.5], 4.5, 1.5)
  expect(steepMove.accepted).toBe(false)
  expect(steepMove.sample.slopeRadians).toBeGreaterThan(Math.PI / 4)
})

test("routes across V3 nodes without requiring navmesh portals", () => {
  const nodes = [
    {
      id: "spawn",
      position: [0, 0, 0] as const,
      cellId: "west",
      kind: "road" as const,
      walkableSurfaceId: "terrain.west",
    },
    {
      id: "bridge",
      position: [2, 0.8, 1] as const,
      cellId: "east",
      kind: "bridge" as const,
      walkableSurfaceId: "bridge",
    },
    {
      id: "checkpoint",
      position: [3.5, 0.35, 1] as const,
      cellId: "east",
      kind: "checkpoint" as const,
      walkableSurfaceId: "terrain.east",
    },
  ]
  const navigation = new JourneyNavigation(
    nodes,
    [
      {
        id: "edge.spawn-bridge",
        a: "spawn",
        b: "bridge",
        cost: 2.4,
        kind: "bridge",
        waterOverrideBridgeId: "bridge",
      },
      {
        id: "edge.bridge-checkpoint",
        a: "bridge",
        b: "checkpoint",
        cost: 1.5,
        kind: "checkpoint",
      },
    ],
    { record: "checkpoint" }
  )

  expect(
    navigation.routeToLandmark(new THREE.Vector3(0, 0, 0), "record")
  ).toEqual([
    [0, 0, 0],
    [2, 0.8, 1],
    [3.5, 0.35, 1],
  ])
})

test("accepts the generated V3 package as a runtime manifest", () => {
  const generated = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../public/journey-v2/generated-next/world.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as unknown
  expect(() => assertJourneyWorldManifest(generated)).not.toThrow()
})

test("generated bridge rails collide while the navigation centerline stays clear", () => {
  const generated = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../public/journey-v2/generated-next/world.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as JourneyWorldManifest
  if (generated.schemaVersion !== 3) throw new Error("Expected Journey V3")

  const bridge = generated.bridges[0]
  const railColliders = generated.colliders.filter((collider) =>
    bridge.railColliderIds.includes(collider.id)
  )
  expect(railColliders).toHaveLength(2)
  const collision = new JourneyCollisionWorld(
    railColliders,
    generated.world.bounds,
    generated.world.cellSize
  )
  const normal = new THREE.Vector2(-bridge.tangent[1], bridge.tangent[0])
  const center = new THREE.Vector2(bridge.center[0], bridge.center[2])
  const nearRail = center
    .clone()
    .addScaledVector(normal, bridge.width / 2 - 0.72)
  const outward = normal.clone().multiplyScalar(0.45)
  const intended = nearRail.clone().add(outward)
  const stopped = collision.moveCircle(nearRail, outward, 0.34)

  expect(stopped.distanceTo(intended)).toBeGreaterThan(0.05)
  expect(stopped.clone().sub(center).dot(normal)).toBeLessThan(
    bridge.width / 2 - 0.36
  )

  const centerlineMovement = new THREE.Vector2(
    ...bridge.tangent
  ).multiplyScalar(0.5)
  const alongCenterline = collision.moveCircle(center, centerlineMovement, 0.34)
  expect(alongCenterline.distanceTo(center)).toBeCloseTo(
    centerlineMovement.length(),
    6
  )
})
