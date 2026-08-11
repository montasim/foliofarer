import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"

import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import {
  createJourneyBuildingWayfindingMesh,
  formatJourneyBuildingWayfindingLabel,
  resolveJourneyBuildingLabelPlacement,
  type JourneyBuildingWayfindingAtlas,
} from "../../lib/journey-v2/runtime/building-wayfinding.ts"

const EXPECTED_LABELS = {
  "town-square": "Town Square",
  "rangpur-zilla-school": "Rangpur Zilla School",
  "carmichael-college": "Carmichael College",
  baust: "BAUST",
  "codez-info-tech": "Codez Info Tech",
  drra: "DRRA",
  "multiversal-software": "Multiversal",
  mymedicalhub: "MyMedicalHub",
  "learning-library": "Learning Library",
  "project-workshop": "Project Workshop",
  "community-hall": "Community Hall",
  "contact-pavilion": "Contact Pavilion",
} as const

test("façade copy separates compact and camel-case names without disturbing acronyms", () => {
  assert.equal(
    formatJourneyBuildingWayfindingLabel("MyMedicalHub"),
    "MY MEDICAL HUB"
  )
  assert.equal(
    formatJourneyBuildingWayfindingLabel("Codez Info Tech"),
    "CODEZ INFO TECH"
  )
  assert.equal(formatJourneyBuildingWayfindingLabel("BAUST"), "BAUST")
  assert.equal(
    formatJourneyBuildingWayfindingLabel("HTTPClinic"),
    "HTTP CLINIC"
  )
  assert.equal(
    formatJourneyBuildingWayfindingLabel("my_medical-hub"),
    "MY MEDICAL HUB"
  )
})

test("all twelve arrivals receive a clear plaque mount, with Town Square freestanding", () => {
  const world = compileJourneyWorldV3()
  assert.equal(world.checkpoints.length, 12)
  const claimedBuildings = new Set<string>()

  for (const checkpoint of world.checkpoints) {
    const label =
      EXPECTED_LABELS[checkpoint.recordId as keyof typeof EXPECTED_LABELS]
    assert.ok(label, `${checkpoint.recordId} has canonical wayfinding copy`)
    assert.equal(label, label.trim())
    assert.equal(label.includes("\n"), false)

    const building = world.environmentalBuildings.find(
      (candidate) => candidate.id === checkpoint.arrivalBuildingId
    )
    assert.ok(building, `${checkpoint.id} resolves its arrival building`)
    assert.equal(claimedBuildings.has(building.id), false)
    claimedBuildings.add(building.id)

    const placement = resolveJourneyBuildingLabelPlacement(building, label)
    assert.ok(placement, `${building.id} has a valid façade placement`)
    assert.ok(placement.width >= 2.8 && placement.width <= 5.4)
    assert.equal(placement.height, 0.62)

    const center = building.footprint.reduce(
      (sum, point) => {
        sum.x += point[0] / building.footprint.length
        sum.z += point[1] / building.footprint.length
        return sum
      },
      { x: 0, z: 0 }
    )
    const façadeX = building.entrance[0] - center.x
    const façadeZ = building.entrance[2] - center.z
    const plaqueX = placement.position[0] - building.entrance[0]
    const plaqueZ = placement.position[2] - building.entrance[2]
    const façadeLength = Math.hypot(façadeX, façadeZ)
    const outwardX = façadeX / façadeLength
    const outwardZ = façadeZ / façadeLength
    const rightX = outwardZ
    const rightZ = -outwardX
    const normalOffset = outwardX * plaqueX + outwardZ * plaqueZ
    const lateralOffset = rightX * plaqueX + rightZ * plaqueZ

    if (building.archetype === "town-pavilion") {
      assert.equal(placement.mount, "freestanding")
      assert.ok(
        normalOffset <= -0.37,
        `${building.id} park marker stands inside the civic entrance`
      )
      assert.ok(
        lateralOffset >= placement.width / 2 + 0.7,
        `${building.id} park marker clears the walking path`
      )
      assert.ok(placement.position[1] > placement.supportBaseY + 1.4)
    } else {
      assert.equal(placement.mount, "facade")
      assert.ok(
        normalOffset >= 0.33 && normalOffset <= 0.35,
        `${building.id} uses the universal canopy-safe face standoff`
      )
      assert.ok(
        normalOffset - 0.045 >= 0.28,
        `${building.id} backing clears every procedural canopy front`
      )
      assert.ok(Math.abs(lateralOffset) < 0.001)
      assert.ok(placement.position[1] > building.entrance[1] + 2)
    }
  }

  assert.equal(claimedBuildings.size, 12)
})

test("plaque width responds to copy while respecting the available façade", () => {
  const world = compileJourneyWorldV3()
  const building = world.environmentalBuildings.find(
    (candidate) => candidate.archetype === "schoolhouse"
  )
  assert.ok(building)

  const short = resolveJourneyBuildingLabelPlacement(building, "DRRA")
  const long = resolveJourneyBuildingLabelPlacement(
    building,
    "Rangpur Zilla School"
  )
  assert.ok(short)
  assert.ok(long)
  assert.ok(long.width > short.width)

  const façadeWidths = building.footprint.map((point, index) => {
    const next = building.footprint[(index + 1) % building.footprint.length]
    return Math.hypot(next[0] - point[0], next[1] - point[1])
  })
  assert.ok(long.width <= Math.max(...façadeWidths) - 0.72)
})

test("one atlas material builds backed façade plaques and a posted park marker", () => {
  const world = compileJourneyWorldV3()
  const town = world.environmentalBuildings.find(
    (candidate) => candidate.archetype === "town-pavilion"
  )
  const office = world.environmentalBuildings.find(
    (candidate) => candidate.archetype === "tech-office"
  )
  assert.ok(town)
  assert.ok(office)

  const material = new THREE.MeshBasicMaterial()
  const atlas: JourneyBuildingWayfindingAtlas = {
    material,
    slot: () => ({ u0: 0.01, v0: 0.01, u1: 0.32, v1: 0.24 }),
    dispose: () => material.dispose(),
  }
  const mesh = createJourneyBuildingWayfindingMesh(
    [town, office],
    new Map([
      [town.id, "Town Square"],
      [office.id, "Codez Info Tech"],
    ]),
    atlas
  )
  assert.ok(mesh)

  const position = mesh.mesh.geometry.getAttribute("position")
  assert.equal(position.count, 24)
  assert.equal(mesh.mesh.geometry.getIndex()?.count, 36)
  assert.deepEqual(mesh.mesh.userData.journeyWayfindingMounts, [
    "freestanding",
    "facade",
  ])
  assert.equal(mesh.mesh.material, material)

  const townPlacement = resolveJourneyBuildingLabelPlacement(
    town,
    "Town Square"
  )
  assert.ok(townPlacement)
  const yValues = Array.from({ length: position.count }, (_, index) =>
    position.getY(index)
  )
  assert.ok(
    Math.min(...yValues) <= townPlacement.supportBaseY + 0.001,
    "the park marker posts reach authored grade"
  )

  mesh.dispose()
  material.dispose()
})
