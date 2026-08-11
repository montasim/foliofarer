import assert from "node:assert/strict"
import test from "node:test"

import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import { ROAD_VERGE_WIDTH_V3 } from "../../lib/journey-v2/generator/bridges.ts"
import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import {
  AMBIENT_COMPOUND_GATE_WIDTH_V3,
  AMBIENT_COMPOUND_TARGET_SETBACKS_V3,
  DESTINATION_COMPOUND_TARGET_SETBACKS_V3,
} from "../../lib/journey-v2/generator/inhabited-scenery.ts"

const WORLD = compileJourneyWorldV3()

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ] as const
}

function inhabitedVerticesWithColors(colors: readonly (readonly number[])[]) {
  const points: [number, number][] = []
  for (const geometry of WORLD.geometries.filter((candidate) =>
    candidate.id.startsWith("geometry.inhabited.")
  )) {
    for (let index = 0; index < (geometry.colors?.length ?? 0); index += 3) {
      const vertexColor = geometry.colors!.slice(index, index + 3)
      if (
        colors.some((candidate) =>
          candidate.every(
            (channel, channelIndex) =>
              Math.abs(channel - vertexColor[channelIndex]) < 0.00001
          )
        )
      ) {
        points.push([geometry.positions[index], geometry.positions[index + 2]])
      }
    }
  }
  return points
}

function inhabitedSurfaceSamplesWithColors(
  colors: readonly (readonly number[])[]
) {
  const points = inhabitedVerticesWithColors(colors)
  for (const geometry of WORLD.geometries.filter((candidate) =>
    candidate.id.startsWith("geometry.inhabited.")
  )) {
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const vertexIndices = geometry.indices.slice(index, index + 3)
      if (
        !vertexIndices.every((vertexIndex) => {
          const offset = vertexIndex * 3
          const vertexColor = geometry.colors!.slice(offset, offset + 3)
          return colors.some((candidate) =>
            candidate.every(
              (channel, channelIndex) =>
                Math.abs(channel - vertexColor[channelIndex]) < 0.00001
            )
          )
        })
      ) {
        continue
      }
      points.push([
        vertexIndices.reduce(
          (sum, vertexIndex) => sum + geometry.positions[vertexIndex * 3],
          0
        ) / 3,
        vertexIndices.reduce(
          (sum, vertexIndex) => sum + geometry.positions[vertexIndex * 3 + 2],
          0
        ) / 3,
      ])
    }
  }
  return points
}

function inhabitedTrianglesWithColors(colors: readonly (readonly number[])[]) {
  const triangles: Array<
    [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ]
  > = []
  for (const geometry of WORLD.geometries.filter((candidate) =>
    candidate.id.startsWith("geometry.inhabited.")
  )) {
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const vertexIndices = geometry.indices.slice(index, index + 3)
      if (
        !vertexIndices.every((vertexIndex) => {
          const offset = vertexIndex * 3
          const vertexColor = geometry.colors!.slice(offset, offset + 3)
          return colors.some((candidate) =>
            candidate.every(
              (channel, channelIndex) =>
                Math.abs(channel - vertexColor[channelIndex]) < 0.00001
            )
          )
        })
      ) {
        continue
      }
      triangles.push(
        vertexIndices.map((vertexIndex) => {
          const offset = vertexIndex * 3
          return geometry.positions.slice(offset, offset + 3) as [
            number,
            number,
            number,
          ]
        }) as [
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ]
      )
    }
  }
  return triangles
}

function pointInRing(
  point: readonly [number, number],
  ring: readonly (readonly [number, number])[]
) {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const current = ring[index]
    const prior = ring[previous]
    if (
      current[1] > point[1] !== prior[1] > point[1] &&
      point[0] <
        ((prior[0] - current[0]) * (point[1] - current[1])) /
          (prior[1] - current[1] || Number.EPSILON) +
          current[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function pointInWater(point: readonly [number, number]) {
  return WORLD.waterBodies.some((water) => {
    const rings =
      typeof water.polygon[0]?.[0] === "number"
        ? [water.polygon as (readonly [number, number])[]]
        : (water.polygon as (readonly (readonly [number, number])[])[])
    return (
      pointInRing(point, rings[0]) &&
      !rings.slice(1).some((ring) => pointInRing(point, ring))
    )
  })
}

function pointSegmentDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number]
) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const squared = dx * dx + dz * dz
  const progress =
    squared <= Number.EPSILON
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / squared
          )
        )
  return Math.hypot(
    point[0] - start[0] - dx * progress,
    point[1] - start[1] - dz * progress
  )
}

function closestRoadPoint(point: readonly [number, number]) {
  let selected:
    | {
        point: [number, number]
        distance: number
      }
    | undefined
  for (const road of WORLD.roads) {
    for (let index = 0; index < road.centerline.length - 1; index += 1) {
      const start: [number, number] = [
        road.centerline[index][0],
        road.centerline[index][2],
      ]
      const end: [number, number] = [
        road.centerline[index + 1][0],
        road.centerline[index + 1][2],
      ]
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const squared = dx * dx + dz * dz
      const progress =
        squared <= Number.EPSILON
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
                  squared
              )
            )
      const candidate: [number, number] = [
        start[0] + dx * progress,
        start[1] + dz * progress,
      ]
      const candidateDistance = Math.hypot(
        point[0] - candidate[0],
        point[1] - candidate[1]
      )
      if (!selected || candidateDistance < selected.distance) {
        selected = { point: candidate, distance: candidateDistance }
      }
    }
  }
  assert.ok(selected)
  return selected.point
}

test("the inhabited layer adds ordinary environmental fabric without portfolio semantics", () => {
  assert.ok(WORLD.validation.counts.ambientStructures >= 5)
  assert.ok(WORLD.validation.counts.ambientStructures <= 8)
  assert.ok(WORLD.validation.counts.contextualPlantClusters >= 30)
  assert.ok(WORLD.validation.counts.utilityPoles >= 4)
  assert.ok(WORLD.validation.counts.utilityPoles <= 8)
  assert.ok(WORLD.validation.counts.wireSpans >= 2)

  const references = [
    ...WORLD.materials.map((material) => material.id),
    ...WORLD.geometries.map((geometry) => geometry.id),
    ...WORLD.instanceBatches.map((batch) => batch.id),
    ...WORLD.colliders.map((collider) => collider.id),
  ].filter((reference) => reference.includes("inhabited"))

  assert.ok(references.length > 0)
  assert.equal(
    references.some((reference) =>
      /\b(?:project|role|skill|career|record|portfolio|bench)\b/i.test(
        reference
      )
    ),
    false
  )
})

test("inhabited scenery is merged per cell and stays inside its draw and triangle allocation", () => {
  const geometries = WORLD.geometries.filter((geometry) =>
    geometry.id.startsWith("geometry.inhabited.")
  )
  const batches = WORLD.instanceBatches.filter((batch) =>
    batch.id.startsWith("batch.inhabited.")
  )
  const triangleCount = geometries.reduce(
    (sum, geometry) => sum + geometry.indices.length / 3,
    0
  )

  assert.equal(
    geometries.length,
    WORLD.validation.counts.inhabitedSceneryMeshes
  )
  assert.ok(geometries.length <= WORLD.cells.length)
  assert.ok(triangleCount <= 9_000)
  assert.ok(batches.length <= 14)
  assert.ok(
    batches.every(
      (batch) =>
        batch.kind === "lamp" &&
        batch.speciesId === "infrastructure" &&
        batch.geometryId.startsWith("primitive.inhabited.utility-pole.")
    )
  )

  for (const cell of WORLD.cells) {
    assert.ok(
      cell.geometryIds.filter((id) => id.startsWith("geometry.inhabited."))
        .length <= 1
    )
  }

  for (const geometry of geometries) {
    assert.equal(geometry.materialId, "environment.inhabited-static")
    assert.equal(geometry.walkable, false)
    assert.equal(geometry.positions.length, geometry.colors?.length)
    assert.ok(geometry.indices.length > 0)
  }
})

test("reflected roadside frames keep grounding tops upward and bottoms below the terrain view", () => {
  const contact = rgb("#466d5c")
  const reflectedBuildings = JOURNEY_V3_WORLD.environmentalBuildings.filter(
    (building) =>
      building.roadSide === -1 && building.archetype !== "town-pavilion"
  )
  assert.ok(reflectedBuildings.length > 0)

  for (const authored of reflectedBuildings) {
    const building = WORLD.environmentalBuildings.find(
      (candidate) => candidate.id === authored.id
    )
    assert.ok(building)
    const center: [number, number] = [
      building.footprint.reduce((sum, point) => sum + point[0], 0) /
        building.footprint.length,
      building.footprint.reduce((sum, point) => sum + point[1], 0) /
        building.footprint.length,
    ]
    const radius =
      Math.hypot(authored.footprint[0] / 2, authored.footprint[1] / 2) + 0.8
    const horizontalTriangles: Array<{ y: number; normalY: number }> = []

    for (const geometry of WORLD.geometries.filter((candidate) =>
      candidate.id.startsWith("geometry.inhabited.")
    )) {
      for (let index = 0; index < geometry.indices.length; index += 3) {
        const vertexIndices = geometry.indices.slice(index, index + 3)
        if (
          !vertexIndices.every((vertexIndex) => {
            const offset = vertexIndex * 3
            return contact.every(
              (channel, channelIndex) =>
                Math.abs(channel - geometry.colors![offset + channelIndex]) <
                0.00001
            )
          })
        ) {
          continue
        }
        const points = vertexIndices.map((vertexIndex) => {
          const offset = vertexIndex * 3
          return [
            geometry.positions[offset],
            geometry.positions[offset + 1],
            geometry.positions[offset + 2],
          ] as const
        })
        const midpoint: [number, number] = [
          points.reduce((sum, point) => sum + point[0], 0) / 3,
          points.reduce((sum, point) => sum + point[2], 0) / 3,
        ]
        if (
          Math.hypot(midpoint[0] - center[0], midpoint[1] - center[1]) > radius
        ) {
          continue
        }
        const first = [
          points[1][0] - points[0][0],
          points[1][1] - points[0][1],
          points[1][2] - points[0][2],
        ]
        const second = [
          points[2][0] - points[0][0],
          points[2][1] - points[0][1],
          points[2][2] - points[0][2],
        ]
        const normalY = first[2] * second[0] - first[0] * second[2]
        if (Math.abs(normalY) < 0.00001) continue
        horizontalTriangles.push({
          y: points.reduce((sum, point) => sum + point[1], 0) / 3,
          normalY,
        })
      }
    }

    const bottoms = horizontalTriangles.filter(
      (triangle) => Math.abs(triangle.y - building.baseHeight) < 0.002
    )
    const tops = horizontalTriangles.filter(
      (triangle) => Math.abs(triangle.y - (building.baseHeight + 0.028)) < 0.002
    )
    assert.equal(bottoms.length, 2, `${building.id} lost its grounding bottom`)
    assert.equal(tops.length, 2, `${building.id} lost its grounding top`)
    assert.ok(
      bottoms.every((triangle) => triangle.normalY < 0),
      `${building.id} exposes a coplanar upward bottom at terrain height`
    )
    assert.ok(
      tops.every((triangle) => triangle.normalY > 0),
      `${building.id} culls its raised grounding top`
    )
  }
})

test("ambient structures contribute exactly one streamed collider each", () => {
  const colliders = WORLD.colliders.filter((collider) =>
    collider.id.startsWith("collider.environment.ambient.")
  )
  assert.equal(colliders.length, WORLD.validation.counts.ambientStructures)
  assert.ok(
    colliders.every((collider) =>
      WORLD.cells
        .find((cell) => cell.id === collider.cellId)
        ?.colliderIds.includes(collider.id)
    )
  )

  const vegetationPoints = WORLD.instanceBatches
    .filter((batch) =>
      ["tree-trunk", "tree-canopy", "grass", "shrub", "rock"].includes(
        batch.kind
      )
    )
    .flatMap((batch) =>
      batch.transforms.map((transform) => [transform[0], transform[2]] as const)
    )
  for (const collider of colliders) {
    assert.equal(
      vegetationPoints.some((point) => pointInRing(point, collider.polygon)),
      false,
      `${collider.id} remains clear of generated vegetation`
    )
  }
})

test("ambient cottages, roadside shops, and tin sheds use distinct rural silhouettes", () => {
  const markerColors = [
    rgb("#e1d2b1"), // cottage porch and window trim
    rgb("#6d8587"), // shop canopy
    rgb("#879b98"), // shed wall tin
  ]
  for (const marker of markerColors) {
    assert.ok(
      inhabitedTrianglesWithColors([marker]).length >= 4,
      `rural archetype marker ${marker.join(",")} is missing`
    )
  }

  const authoredDetailTriangles = inhabitedTrianglesWithColors([
    ...markerColors,
    rgb("#203b3e"),
    rgb("#b55f43"),
  ])
  assert.ok(authoredDetailTriangles.length > 100)
  for (const triangle of authoredDetailTriangles) {
    const first = [
      triangle[1][0] - triangle[0][0],
      triangle[1][1] - triangle[0][1],
      triangle[1][2] - triangle[0][2],
    ]
    const second = [
      triangle[2][0] - triangle[0][0],
      triangle[2][1] - triangle[0][1],
      triangle[2][2] - triangle[0][2],
    ]
    const cross = [
      first[1] * second[2] - first[2] * second[1],
      first[2] * second[0] - first[0] * second[2],
      first[0] * second[1] - first[1] * second[0],
    ]
    assert.ok(
      Math.hypot(...cross) > 0.00001,
      "rural scenery contains a zero-area face"
    )
  }
})

test("ambient cottage compounds retain a generous central gate and access path", () => {
  const fencePoints = inhabitedVerticesWithColors([
    rgb("#806247"),
    rgb("#59463a"),
  ])
  let cottageCount = 0

  for (const collider of WORLD.colliders.filter((candidate) =>
    candidate.id.startsWith("collider.environment.ambient.")
  )) {
    const center: [number, number] = [
      collider.polygon.reduce((sum, point) => sum + point[0], 0) /
        collider.polygon.length,
      collider.polygon.reduce((sum, point) => sum + point[1], 0) /
        collider.polygon.length,
    ]
    const localFence = fencePoints.filter(
      (point) => Math.hypot(point[0] - center[0], point[1] - center[1]) < 12
    )
    if (localFence.length === 0) continue
    cottageCount += 1

    const roadPoint = closestRoadPoint(center)
    const outwardLength = Math.hypot(
      center[0] - roadPoint[0],
      center[1] - roadPoint[1]
    )
    const outward: [number, number] = [
      (center[0] - roadPoint[0]) / outwardLength,
      (center[1] - roadPoint[1]) / outwardLength,
    ]
    const tangent: [number, number] = [-outward[1], outward[0]]
    const colliderLocal = collider.polygon.map((point) => {
      const dx = point[0] - center[0]
      const dz = point[1] - center[1]
      return [
        dx * tangent[0] + dz * tangent[1],
        dx * outward[0] + dz * outward[1],
      ] as const
    })
    const halfWidth = Math.max(
      ...colliderLocal.map((point) => Math.abs(point[0]))
    )
    const halfDepth = Math.max(
      ...colliderLocal.map((point) => Math.abs(point[1]))
    )
    let frontSamples = 0

    for (const point of localFence) {
      const dx = point[0] - center[0]
      const dz = point[1] - center[1]
      const localX = dx * tangent[0] + dz * tangent[1]
      const localZ = dx * outward[0] + dz * outward[1]
      const sideSetback = Math.abs(localX) - halfWidth
      const frontSetback = -localZ - halfDepth
      const backSetback = localZ - halfDepth
      assert.ok(
        sideSetback >= AMBIENT_COMPOUND_TARGET_SETBACKS_V3.side - 0.14 ||
          frontSetback >= AMBIENT_COMPOUND_TARGET_SETBACKS_V3.front - 0.14 ||
          backSetback >= AMBIENT_COMPOUND_TARGET_SETBACKS_V3.back - 0.14,
        `${collider.id} crowds its cottage compound`
      )

      const frontCenter =
        -halfDepth - AMBIENT_COMPOUND_TARGET_SETBACKS_V3.front - 0.06
      if (Math.abs(localZ - frontCenter) < 0.18) {
        frontSamples += 1
        assert.ok(
          Math.abs(localX) >= AMBIENT_COMPOUND_GATE_WIDTH_V3 / 2 - 0.15,
          `${collider.id} blocks its central gate`
        )
      }
    }
    assert.ok(frontSamples > 0, `${collider.id} lost its front fence`)
  }

  assert.ok(cottageCount >= 2, "too few rural cottage compounds survived")
})

test("the code-authored bicycles have two complete wheels and a visible frame", () => {
  const rubberTriangles = inhabitedTrianglesWithColors([rgb("#203b3e")])
  const frameTriangles = inhabitedTrianglesWithColors([rgb("#b55f43")])

  // Two cycles, two fourteen-segment wheels, and four visible tube faces per
  // segment produce a stable silhouette from either side of the road.
  assert.ok(rubberTriangles.length >= 400)
  assert.ok(frameTriangles.length >= 100)
})

test("Town Square receives no generic residential frontage inside its civic park", () => {
  const town = WORLD.environmentalBuildings.find(
    (building) => building.archetype === "town-pavilion"
  )
  assert.ok(town)
  const genericGrounding = inhabitedSurfaceSamplesWithColors([rgb("#466d5c")])
  assert.equal(
    genericGrounding.some((point) => pointInRing(point, town.footprint)),
    false
  )
})

test("inhabited plots, checkpoint gates, and planters retain real-world clearances", () => {
  const timberVertices = inhabitedVerticesWithColors([
    rgb("#72533a"),
    rgb("#4f3c31"),
    rgb("#76573d"),
    rgb("#513c31"),
  ])
  for (const collider of WORLD.colliders.filter((candidate) =>
    candidate.id.startsWith("collider.environment.ambient.")
  )) {
    const center: [number, number] = [
      collider.polygon.reduce((sum, point) => sum + point[0], 0) /
        collider.polygon.length,
      collider.polygon.reduce((sum, point) => sum + point[1], 0) /
        collider.polygon.length,
    ]
    const plotTimber = timberVertices.filter(
      (point) => Math.hypot(point[0] - center[0], point[1] - center[1]) < 9
    )
    assert.equal(
      plotTimber.some(pointInWater),
      false,
      `${collider.id} places its fence or plot detail in water`
    )
  }

  const fencedArchetypes = new Set([
    "schoolhouse",
    "academic-hall",
    "engineering-campus",
    "community-hall",
  ])
  for (const building of WORLD.environmentalBuildings.filter((candidate) =>
    fencedArchetypes.has(candidate.archetype)
  )) {
    const checkpoint = WORLD.checkpoints.find(
      (candidate) => candidate.arrivalBuildingId === building.id
    )
    assert.ok(checkpoint)
    const roadCenter: [number, number] = [
      (checkpoint.sharedRoadBoundary[0][0] +
        checkpoint.sharedRoadBoundary[1][0]) /
        2,
      (checkpoint.sharedRoadBoundary[0][2] +
        checkpoint.sharedRoadBoundary[1][2]) /
        2,
    ]
    const entrance: [number, number] = [
      building.entrance[0],
      building.entrance[2],
    ]
    const localTimber = timberVertices.filter(
      (point) => Math.hypot(point[0] - entrance[0], point[1] - entrance[1]) < 12
    )
    assert.ok(
      localTimber.every(
        (point) =>
          pointSegmentDistance(point, roadCenter, entrance) >= 3 - 0.001
      ),
      `${building.id} narrows its six-metre checkpoint gate`
    )
  }

  const planterVertices = inhabitedVerticesWithColors([rgb("#a85f42")])
  for (const checkpoint of WORLD.checkpoints) {
    assert.ok(
      planterVertices.every(
        (point) =>
          Math.hypot(
            point[0] - checkpoint.position[0],
            point[1] - checkpoint.position[2]
          ) >=
          checkpoint.interactionRadius + 2.5
      ),
      `${checkpoint.id} has a planter clipping its forecourt`
    )
  }
})

test("destination compound fences keep the full five-times setback or omit unsafe spans", () => {
  const compoundColors = [rgb("#76573d"), rgb("#513c31")]
  const samples = inhabitedSurfaceSamplesWithColors(compoundColors)
  const fencedArchetypes = new Set([
    "schoolhouse",
    "academic-hall",
    "engineering-campus",
    "community-hall",
  ])
  const buildings = WORLD.environmentalBuildings
    .filter((building) => fencedArchetypes.has(building.archetype))
    .map((building) => {
      const authored = JOURNEY_V3_WORLD.environmentalBuildings.find(
        (candidate) => candidate.id === building.id
      )
      assert.ok(authored)
      const center: [number, number] = [
        building.footprint.reduce((sum, point) => sum + point[0], 0) /
          building.footprint.length,
        building.footprint.reduce((sum, point) => sum + point[1], 0) /
          building.footprint.length,
      ]
      const outwardLength = Math.hypot(
        center[0] - building.entrance[0],
        center[1] - building.entrance[2]
      )
      const outward: [number, number] = [
        (center[0] - building.entrance[0]) / outwardLength,
        (center[1] - building.entrance[2]) / outwardLength,
      ]
      const tangent: [number, number] = [-outward[1], outward[0]]
      return { building, authored, center, outward, tangent, samples: 0 }
    })

  assert.ok(samples.length > 0)
  for (const point of samples) {
    const nearest = buildings
      .map((candidate) => {
        const dx = point[0] - candidate.center[0]
        const dz = point[1] - candidate.center[1]
        const localX = dx * candidate.tangent[0] + dz * candidate.tangent[1]
        const localZ = dx * candidate.outward[0] + dz * candidate.outward[1]
        const sideBoundary =
          candidate.authored.footprint[0] / 2 +
          DESTINATION_COMPOUND_TARGET_SETBACKS_V3.side
        const depthBoundary =
          candidate.authored.footprint[1] / 2 +
          DESTINATION_COMPOUND_TARGET_SETBACKS_V3.front
        return {
          candidate,
          localX,
          localZ,
          score: Math.min(
            Math.abs(Math.abs(localX) - sideBoundary),
            Math.abs(Math.abs(localZ) - depthBoundary)
          ),
        }
      })
      .sort((a, b) => a.score - b.score)[0]
    nearest.candidate.samples += 1
    const sideSetback =
      Math.abs(nearest.localX) - nearest.candidate.authored.footprint[0] / 2
    const depthSetback =
      Math.abs(nearest.localZ) - nearest.candidate.authored.footprint[1] / 2
    assert.ok(
      sideSetback >= DESTINATION_COMPOUND_TARGET_SETBACKS_V3.side - 0.02 ||
        depthSetback >= DESTINATION_COMPOUND_TARGET_SETBACKS_V3.front - 0.02,
      `${nearest.candidate.building.id} renders a fence inside its 5x setback`
    )

    assert.equal(pointInWater(point), false, "compound fence enters water")
    assert.ok(
      point[0] >= WORLD.world.bounds[0] &&
        point[0] <= WORLD.world.bounds[2] &&
        point[1] >= WORLD.world.bounds[1] &&
        point[1] <= WORLD.world.bounds[3],
      "compound fence leaves the world bounds"
    )
    assert.ok(
      WORLD.roads.every((road) => {
        let nearestRoad = Number.POSITIVE_INFINITY
        for (let index = 0; index < road.centerline.length - 1; index += 1) {
          nearestRoad = Math.min(
            nearestRoad,
            pointSegmentDistance(
              point,
              [road.centerline[index][0], road.centerline[index][2]],
              [road.centerline[index + 1][0], road.centerline[index + 1][2]]
            )
          )
        }
        return nearestRoad >= road.width / 2 + ROAD_VERGE_WIDTH_V3 - 0.12
      }),
      "compound fence enters the road or authored verge"
    )
  }

  for (const candidate of buildings) {
    assert.ok(
      candidate.samples > 0,
      `${candidate.building.id} lost every fence`
    )
    assert.ok(
      WORLD.validation.warnings.some(
        (warning) =>
          warning.includes(candidate.building.id) &&
          warning.includes("full 5x compound setbacks") &&
          warning.includes("unsafe fence edges omitted")
      ),
      `${candidate.building.id} does not report its omitted unsafe spans`
    )
  }
})

test("utility poles and overhead wire corridors remain clear of tree canopies", () => {
  const poles = WORLD.instanceBatches
    .filter(
      (batch) => batch.id.startsWith("batch.inhabited.") && batch.lod === "near"
    )
    .flatMap((batch) =>
      batch.transforms.map((transform, index) => ({
        point: [transform[0], transform[2]] as const,
        rank: batch.densityRanks[index],
      }))
    )
    .sort((a, b) => a.rank - b.rank)
  const trees = WORLD.instanceBatches
    .filter((batch) => batch.kind === "tree-trunk" && batch.lod === "near")
    .flatMap((batch) =>
      batch.transforms.map((transform) => [transform[0], transform[2]] as const)
    )

  for (const pole of poles) {
    assert.ok(
      trees.every(
        (tree) =>
          Math.hypot(tree[0] - pole.point[0], tree[1] - pole.point[1]) >= 3.2
      ),
      `utility pole ${pole.point.join(",")} overlaps a tree`
    )
  }

  for (let index = 0; index < poles.length - 1; index += 1) {
    const start = poles[index].point
    const end = poles[index + 1].point
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 48) continue
    assert.ok(
      trees.every((tree) => pointSegmentDistance(tree, start, end) >= 3.4),
      `wire span ${start.join(",")}–${end.join(",")} crosses a canopy`
    )
  }
})
