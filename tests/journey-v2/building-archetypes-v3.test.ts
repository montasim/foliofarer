import assert from "node:assert/strict"
import test from "node:test"

import type {
  EnvironmentalBuildingManifestV3,
  GeometryDefinitionV3,
  Vec2,
} from "../../lib/journey-v2/contracts/world.ts"
import { JOURNEY_V3_WORLD } from "../../lib/journey-v2/authored/world-v3.ts"
import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"

const WORLD = compileJourneyWorldV3()
const GEOMETRY_BY_ID = new Map(
  WORLD.geometries.map((geometry) => [geometry.id, geometry])
)
const AUTHORED_BUILDING_BY_ID = new Map(
  JOURNEY_V3_WORLD.environmentalBuildings.map((building) => [
    building.id,
    building,
  ])
)

interface LocalFrame {
  center: Vec2
  tangent: Vec2
  outward: Vec2
  baseHeight: number
}

interface LocalVertex {
  x: number
  y: number
  z: number
}

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector[0], vector[1])
  assert.ok(length > 0)
  return [vector[0] / length, vector[1] / length]
}

function localFrame(building: EnvironmentalBuildingManifestV3): LocalFrame {
  const center = building.footprint.reduce<Vec2>(
    (sum, point) => [
      sum[0] + point[0] / building.footprint.length,
      sum[1] + point[1] / building.footprint.length,
    ],
    [0, 0]
  )
  const tangent = normalize([
    building.footprint[1][0] - building.footprint[0][0],
    building.footprint[1][1] - building.footprint[0][1],
  ])
  const outward = normalize([
    center[0] - building.entrance[0],
    center[1] - building.entrance[2],
  ])
  return { center, tangent, outward, baseHeight: building.baseHeight }
}

function localVertices(
  geometry: GeometryDefinitionV3,
  frame: LocalFrame
): LocalVertex[] {
  const vertices: LocalVertex[] = []
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const dx = geometry.positions[index] - frame.center[0]
    const dz = geometry.positions[index + 2] - frame.center[1]
    vertices.push({
      x: dx * frame.tangent[0] + dz * frame.tangent[1],
      y: geometry.positions[index + 1] - frame.baseHeight,
      z: dx * frame.outward[0] + dz * frame.outward[1],
    })
  }
  return vertices
}

test("every arrival archetype removes grade-coplanar faces and covers its complete wall envelope", () => {
  for (const building of WORLD.environmentalBuildings) {
    const architecture = GEOMETRY_BY_ID.get(
      `geometry.${building.id}.architecture`
    )
    assert.ok(architecture, `${building.id} has architecture geometry`)
    const vertices = localVertices(architecture, localFrame(building))
    const minimumY = Math.min(...vertices.map((vertex) => vertex.y))
    assert.ok(
      minimumY <= -0.19,
      `${building.id} foundation extends below terrain grade`
    )

    const top = vertices.filter((vertex) => Math.abs(vertex.y - 0.12) <= 0.002)
    assert.ok(top.length >= 4, `${building.id} has a raised foundation cap`)
    const topMinX = Math.min(...top.map((vertex) => vertex.x))
    const topMaxX = Math.max(...top.map((vertex) => vertex.x))
    const topMinZ = Math.min(...top.map((vertex) => vertex.z))
    const topMaxZ = Math.max(...top.map((vertex) => vertex.z))
    if (building.archetype === "town-pavilion") {
      const authored = AUTHORED_BUILDING_BY_ID.get(building.id)
      assert.ok(authored)
      assert.ok(
        topMinX <= -authored.footprint[0] / 2 &&
          topMaxX >= authored.footprint[0] / 2 &&
          topMinZ <= -authored.footprint[1] / 2 &&
          topMaxZ >= authored.footprint[1] / 2,
        `${building.id} foundation supports the complete civic park`
      )
    } else {
      const gradeContacts = vertices.filter(
        (vertex) => Math.abs(vertex.y) <= 0.002
      )
      assert.ok(
        gradeContacts.length >= 4,
        `${building.id} preserves vertical wall-to-foundation joins`
      )
      const contactMinX = Math.min(...gradeContacts.map((vertex) => vertex.x))
      const contactMaxX = Math.max(...gradeContacts.map((vertex) => vertex.x))
      const contactMinZ = Math.min(...gradeContacts.map((vertex) => vertex.z))
      const contactMaxZ = Math.max(...gradeContacts.map((vertex) => vertex.z))
      assert.ok(
        topMinX <= contactMinX - 0.1 && topMaxX >= contactMaxX + 0.1,
        `${building.id} foundation projects past every grade-level wall in X`
      )
      assert.ok(
        topMinZ <= contactMinZ - 0.1 && topMaxZ >= contactMaxZ + 0.1,
        `${building.id} foundation projects past every grade-level wall in Z`
      )
    }

    for (let index = 0; index < architecture.indices.length; index += 3) {
      const triangle = architecture.indices.slice(index, index + 3)
      assert.equal(
        triangle.every(
          (vertexIndex) => Math.abs(vertices[vertexIndex].y) <= 0.002
        ),
        false,
        `${building.id} has no triangle coplanar with rendered terrain`
      )
    }
    assert.deepEqual(
      building.materialIds,
      ["building.architecture"],
      `${building.id} foundation stays in the merged building draw call`
    )
  }
})

function triangleNormal(
  geometry: GeometryDefinitionV3,
  offset: number
): readonly [number, number, number] | null {
  const vertexOffsets = geometry.indices
    .slice(offset, offset + 3)
    .map((index) => index * 3)
  const [a, b, c] = vertexOffsets.map((index) =>
    geometry.positions.slice(index, index + 3)
  )
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const normal: [number, number, number] = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
  const length = Math.hypot(...normal)
  if (length <= 0.000001) return null
  return [normal[0] / length, normal[1] / length, normal[2] / length]
}

/**
 * A vertex is hard-normal-ready when every triangle using that index is on
 * the same plane. Runtime-computed normals can then keep a low-poly corner
 * crisp instead of averaging unrelated wall faces together.
 */
function hardNormalReadyRatio(geometry: GeometryDefinitionV3) {
  const incidentNormals = new Map<number, (readonly number[])[]>()
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const normal = triangleNormal(geometry, offset)
    assert.ok(normal, `${geometry.id} contains a degenerate triangle`)
    for (const index of geometry.indices.slice(offset, offset + 3)) {
      const incidents = incidentNormals.get(index) ?? []
      incidents.push(normal)
      incidentNormals.set(index, incidents)
    }
  }

  let ready = 0
  for (const normals of incidentNormals.values()) {
    const [reference] = normals
    if (
      normals.every(
        (normal) =>
          reference[0] * normal[0] +
            reference[1] * normal[1] +
            reference[2] * normal[2] >
          0.995
      )
    ) {
      ready += 1
    }
  }
  return ready / incidentNormals.size
}

function pointInTriangle(
  point: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number]
) {
  const cross = (
    first: readonly [number, number],
    second: readonly [number, number],
    third: readonly [number, number]
  ) =>
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  const epsilon = 0.002
  const ab = cross(a, b, point)
  const bc = cross(b, c, point)
  const ca = cross(c, a, point)
  return (
    (ab >= -epsilon && bc >= -epsilon && ca >= -epsilon) ||
    (ab <= epsilon && bc <= epsilon && ca <= epsilon)
  )
}

function polygonArea(polygon: readonly Vec2[]) {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) / 2
}

function distinct(values: readonly number[], precision = 0.04) {
  return [...values]
    .sort((a, b) => a - b)
    .filter(
      (value, index, sorted) =>
        index === 0 || Math.abs(value - sorted[index - 1]) > precision
    )
}

test("procedural building buffers retain crisp low-poly normals, vertex colors, and authored envelopes", () => {
  const buildingGeometryIds = new Set(
    WORLD.environmentalBuildings.flatMap((building) => building.geometryIds)
  )
  let totalTriangles = 0

  for (const building of WORLD.environmentalBuildings) {
    const authored = AUTHORED_BUILDING_BY_ID.get(building.id)
    assert.ok(authored)
    const frame = localFrame(building)
    let buildingTriangles = 0

    for (const geometryId of building.geometryIds) {
      const geometry = GEOMETRY_BY_ID.get(geometryId)
      assert.ok(geometry)
      assert.equal(geometry.kind, "building")
      assert.ok(geometry.colors, `${geometry.id} serializes vertex colors`)
      assert.equal(
        geometry.colors.length,
        geometry.positions.length,
        `${geometry.id} has one RGB triplet per position`
      )
      assert.ok(
        geometry.colors.every((component) => component >= 0 && component <= 1),
        `${geometry.id} keeps RGB components normalized`
      )

      const vertices = localVertices(geometry, frame)
      const minimumEnvelopeY = geometry.id.endsWith(".architecture")
        ? -0.21
        : -0.01
      for (const vertex of vertices) {
        assert.ok(
          Math.abs(vertex.x) <= authored.footprint[0] / 2 + 0.8,
          `${geometry.id} exceeds its lateral footprint/eave envelope`
        )
        assert.ok(
          Math.abs(vertex.z) <= authored.footprint[1] / 2 + 0.8,
          `${geometry.id} exceeds its depth footprint/eave envelope`
        )
        assert.ok(
          vertex.y >= minimumEnvelopeY && vertex.y <= building.height + 0.01,
          `${geometry.id} exceeds its serialized vertical envelope`
        )
      }

      if (geometry.positions.length === 0) {
        assert.equal(
          geometry.indices.length,
          0,
          `${geometry.id} has no orphaned indices`
        )
        continue
      }

      const readyRatio = hardNormalReadyRatio(geometry)
      if (geometry.id.endsWith(".openings")) {
        assert.equal(
          readyRatio,
          1,
          `${geometry.id} box faces use separate normal-ready vertices`
        )
      } else {
        const minimumReadyRatio =
          building.archetype === "town-pavilion" ? 0.62 : 0.7
        assert.ok(
          readyRatio >= minimumReadyRatio,
          `${geometry.id} keeps box-like architecture crisp (${readyRatio})`
        )
      }

      buildingTriangles += geometry.indices.length / 3
    }

    assert.ok(
      building.geometryIds.length <= 3,
      `${building.id} stays within three static building draw groups`
    )
    assert.ok(
      buildingTriangles <= 600,
      `${building.id} stays within 600 static building triangles`
    )
    totalTriangles += buildingTriangles
  }

  assert.ok(buildingGeometryIds.size <= 36)
  assert.ok(totalTriangles <= 6_000)
})

test("software-studio openings are backed by the stepped support volume", () => {
  const building = WORLD.environmentalBuildings.find(
    (candidate) => candidate.archetype === "software-studio"
  )
  assert.ok(building)
  const frame = localFrame(building)
  const architecture = GEOMETRY_BY_ID.get(
    building.geometryIds.find((id) => id.endsWith(".architecture"))!
  )
  const openings = GEOMETRY_BY_ID.get(
    building.geometryIds.find((id) => id.endsWith(".openings"))!
  )
  assert.ok(architecture)
  assert.ok(openings)

  const architectureVertices = localVertices(architecture, frame)
  const openingVertices = localVertices(openings, frame)
  const architectureTriangles = [] as LocalVertex[][]
  for (let offset = 0; offset < architecture.indices.length; offset += 3) {
    architectureTriangles.push(
      architecture.indices
        .slice(offset, offset + 3)
        .map((index) => architectureVertices[index])
    )
  }

  for (const opening of openingVertices) {
    const supported = architectureTriangles.some(([a, b, c]) => {
      const averageZ = (a.z + b.z + c.z) / 3
      const frontSupported =
        averageZ >= opening.z - 0.02 &&
        averageZ <= opening.z + 0.45 &&
        pointInTriangle(
          [opening.x, opening.y],
          [a.x, a.y],
          [b.x, b.y],
          [c.x, c.y]
        )
      const averageX = (a.x + b.x + c.x) / 3
      const sideSupported =
        Math.abs(averageX - opening.x) <= 0.45 &&
        pointInTriangle(
          [opening.z, opening.y],
          [a.z, a.y],
          [b.z, b.y],
          [c.z, c.y]
        )
      return frontSupported || sideSupported
    })
    assert.ok(
      supported,
      `software-studio opening (${opening.x.toFixed(2)}, ${opening.y.toFixed(
        2
      )}) has a wall immediately behind it`
    )
  }
})

test("maker-workshop exposes three repeated sawtooth peaks on its road-facing silhouette", () => {
  const building = WORLD.environmentalBuildings.find(
    (candidate) => candidate.archetype === "maker-workshop"
  )
  assert.ok(building)
  const architecture = GEOMETRY_BY_ID.get(
    building.geometryIds.find((id) => id.endsWith(".architecture"))!
  )
  assert.ok(architecture)
  const vertices = localVertices(architecture, localFrame(building)).filter(
    (vertex) => vertex.y >= 2.9
  )
  const frontZ = Math.min(...vertices.map((vertex) => vertex.z))
  const silhouette = vertices.filter(
    (vertex) => Math.abs(vertex.z - frontZ) <= 0.04
  )
  const minimumY = Math.min(...silhouette.map((vertex) => vertex.y))
  const maximumY = Math.max(...silhouette.map((vertex) => vertex.y))
  assert.ok(
    maximumY - minimumY >= 0.7,
    "the workshop roof front is visibly non-coplanar"
  )

  const peakXs: number[] = distinct(
    silhouette
      .filter((vertex) => vertex.y >= maximumY - 0.04)
      .map((vertex) => vertex.x)
  )
  assert.equal(peakXs.length, 3, "the workshop has three readable roof teeth")
  assert.ok(
    peakXs.every(
      (value, index) => index === 0 || value - peakXs[index - 1] >= 1.5
    ),
    "the three workshop teeth remain visibly separated"
  )
})

test("town square is an open medium civic park rather than an enclosed building", () => {
  const building = WORLD.environmentalBuildings.find(
    (candidate) => candidate.archetype === "town-pavilion"
  )
  assert.ok(building)
  const authored = AUTHORED_BUILDING_BY_ID.get(building.id)
  assert.ok(authored)
  assert.ok(
    authored.footprint[0] >= 15 && authored.footprint[1] >= 10,
    "the civic park reads at a medium public-space scale"
  )

  const openings = GEOMETRY_BY_ID.get(
    building.geometryIds.find((id) => id.endsWith(".openings"))!
  )
  assert.ok(openings)
  assert.equal(
    openings.positions.length,
    0,
    "the park has no façade doors or windows"
  )

  const colliders = WORLD.colliders.filter((collider) =>
    collider.id.startsWith(`collider.${building.id}.`)
  )
  assert.equal(
    colliders.length,
    9,
    "only four trees, four pavilion posts and the planter block movement"
  )
  const footprintArea = polygonArea(building.footprint)
  const colliderArea = colliders.reduce(
    (sum, collider) => sum + polygonArea(collider.polygon),
    0
  )
  const planter = colliders.find((collider) =>
    collider.id.endsWith(".central-planter")
  )
  assert.ok(planter)
  assert.ok(
    polygonArea(planter.polygon) <= 2.5,
    "the central planter leaves comfortable circulation on both crossing paths"
  )
  assert.ok(
    colliderArea < footprintArea * 0.03,
    "the park remains substantially walkable"
  )
})

test("garden pavilion collision follows its posts instead of blocking the open footprint", () => {
  const building = WORLD.environmentalBuildings.find(
    (candidate) => candidate.archetype === "garden-pavilion"
  )
  assert.ok(building)
  const colliders = WORLD.colliders.filter((collider) =>
    collider.id.startsWith(`collider.${building.id}`)
  )
  assert.ok(colliders.length >= 4, "the pavilion has multiple post colliders")

  const footprintArea = polygonArea(building.footprint)
  const colliderAreas = colliders.map((collider) =>
    polygonArea(collider.polygon)
  )
  assert.ok(
    colliderAreas.every((area) => area < footprintArea * 0.1),
    "no pavilion collider blocks a substantial part of the open footprint"
  )
  assert.ok(
    colliderAreas.reduce((sum, area) => sum + area, 0) < footprintArea * 0.25,
    "the pavilion remains mostly walk-through"
  )
  for (const collider of colliders) {
    const cell = WORLD.cells.find(
      (candidate) => candidate.id === collider.cellId
    )
    assert.ok(cell?.colliderIds.includes(collider.id))
    assert.ok(collider.maxY <= building.baseHeight + building.height + 0.01)
  }
})
