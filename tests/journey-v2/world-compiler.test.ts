import assert from "node:assert/strict"
import test from "node:test"

import { compileJourneyWorld } from "../../lib/journey-v2/generator/compiler.ts"

test("Journey V2 compilation is deterministic", () => {
  assert.deepEqual(compileJourneyWorld(), compileJourneyWorld())
})

test("the code-authored town has a complete professional route", () => {
  const world = compileJourneyWorld()
  assert.equal(world.landmarks.length, 12)
  assert.deepEqual(
    world.landmarks.map((landmark) => landmark.routeOrder),
    Array.from({ length: 12 }, (_, index) => index)
  )
  assert.ok(
    world.buildings.filter((building) => building.landmarkId === null).length >=
      8
  )
})

test("every navigation crossing is backed by a visible crosswalk", () => {
  const world = compileJourneyWorld()
  const crosswalkIds = new Set(
    world.features.crosswalks.map((crosswalk) => crosswalk.id)
  )
  const crossingEdges = world.navigation.edges.filter(
    (edge) => edge.kind === "crossing"
  )
  assert.ok(crossingEdges.length > 0)
  for (const edge of crossingEdges) {
    assert.ok(edge.crosswalkId)
    assert.ok(crosswalkIds.has(edge.crosswalkId))
  }
  for (const edge of world.navigation.edges) {
    assert.equal(edge.portal?.length, 2)
  }
})

test("cells contain only local streamed data references", () => {
  const world = compileJourneyWorld()
  const geometryIds = new Set(world.geometries.map((geometry) => geometry.id))
  const batchIds = new Set(world.instanceBatches.map((batch) => batch.id))
  const colliderIds = new Set(world.colliders.map((collider) => collider.id))
  for (const cell of world.cells) {
    assert.ok(cell.geometryIds.every((id) => geometryIds.has(id)))
    assert.ok(cell.batchIds.every((id) => batchIds.has(id)))
    assert.ok(cell.colliderIds.every((id) => colliderIds.has(id)))
  }
})

test("serialized ground surfaces face upward without degenerate triangles", () => {
  const world = compileJourneyWorld()
  for (const geometry of world.geometries.filter(
    (candidate) => candidate.kind === "surface"
  )) {
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const a = geometry.indices[index]
      const b = geometry.indices[index + 1]
      const c = geometry.indices[index + 2]
      const ax = geometry.positions[a * 3]
      const az = geometry.positions[a * 3 + 2]
      const bx = geometry.positions[b * 3]
      const bz = geometry.positions[b * 3 + 2]
      const cx = geometry.positions[c * 3]
      const cz = geometry.positions[c * 3 + 2]
      const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      assert.ok(normalY > 0, `${geometry.id} includes a non-upward triangle`)
    }
  }
})
