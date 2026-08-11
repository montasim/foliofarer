import fs from "node:fs"
import { expect, test } from "@playwright/test"
import * as THREE from "three"
import {
  cameraOccluderVisibilityFraction,
  combineCameraVisibilityFractions,
  minimumSafeCameraFraction,
  segmentEllipsoidEntryFraction,
} from "../../lib/journey-v2/runtime/camera-occlusion"
import {
  JourneyCellManager,
  JourneyWorldAssetRegistry,
} from "../../lib/journey-v2/runtime/scene-assets"
import type { JourneyWorldManifest } from "../../lib/journey-v2/runtime/types"

const world = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../public/journey-v2/generated-next/world.json",
      import.meta.url
    ),
    "utf8"
  )
) as JourneyWorldManifest

test("detects a canopy crossing the target-to-camera line", () => {
  const target = new THREE.Vector3(0, 2, 0)
  const camera = new THREE.Vector3(0, 5, 10)
  const canopy = {
    centerX: 0,
    centerY: 3.5,
    centerZ: 5,
    radiusXZ: 2,
    radiusY: 2,
  }

  const entry = segmentEllipsoidEntryFraction(target, camera, canopy)
  expect(entry).not.toBeNull()
  expect(entry ?? 1).toBeGreaterThan(0.25)
  expect(entry ?? 1).toBeLessThan(0.5)
  expect(cameraOccluderVisibilityFraction(target, camera, canopy)).toBeLessThan(
    entry ?? 1
  )
})

test("leaves a camera line above or beside the canopy unchanged", () => {
  const canopy = {
    centerX: 0,
    centerY: 4,
    centerZ: 5,
    radiusXZ: 1.5,
    radiusY: 1.5,
  }

  expect(
    cameraOccluderVisibilityFraction(
      new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(0, 8, 10),
      canopy
    )
  ).toBe(1)
  expect(
    cameraOccluderVisibilityFraction(
      new THREE.Vector3(5, 2, 0),
      new THREE.Vector3(5, 5, 10),
      canopy
    )
  ).toBe(1)
})

test("never pulls the camera inside the avatar when a canopy starts nearby", () => {
  const target = new THREE.Vector3(0, 1.1, 0)
  const camera = new THREE.Vector3(0, 4.2, 10.8)
  const canopy = {
    centerX: 0,
    centerY: 2.5,
    centerZ: 1.3,
    radiusXZ: 1.8,
    radiusY: 1.8,
  }
  const fraction = cameraOccluderVisibilityFraction(target, camera, canopy)

  expect(fraction).toBe(minimumSafeCameraFraction(target, camera))
  expect(target.distanceTo(camera) * fraction).toBeGreaterThanOrEqual(2.75)
})

test("never weakens a more restrictive structural camera collision", () => {
  const structuralFraction = 0.08
  const vegetationSafeFraction = 0.27

  expect(
    combineCameraVisibilityFractions(structuralFraction, vegetationSafeFraction)
  ).toBe(structuralFraction)
})

test("queries only visible canopies in active cells", () => {
  const canopyBatch = world.instanceBatches.find(
    (batch) =>
      batch.kind === "tree-canopy" &&
      "lod" in batch &&
      batch.lod === "near" &&
      batch.transforms.length > 0
  )
  expect(canopyBatch).toBeTruthy()
  if (!canopyBatch) return

  const registry = new JourneyWorldAssetRegistry(world)
  const cells = new JourneyCellManager(world, registry, "balanced")
  const canopy = canopyBatch.transforms[0]
  cells.updateVisibility(canopy[0], canopy[2], true)

  const target = new THREE.Vector3(canopy[0], canopy[1], canopy[2] - 7)
  const camera = new THREE.Vector3(canopy[0], canopy[1], canopy[2] + 7)
  expect(cells.cameraVegetationVisibilityFraction(target, camera)).toBeLessThan(
    1
  )

  const corners = [
    [world.world.bounds[0], world.world.bounds[1]],
    [world.world.bounds[0], world.world.bounds[3]],
    [world.world.bounds[2], world.world.bounds[1]],
    [world.world.bounds[2], world.world.bounds[3]],
  ] as const
  const farthestCorner = [...corners].sort(
    (first, second) =>
      Math.hypot(second[0] - canopy[0], second[1] - canopy[2]) -
      Math.hypot(first[0] - canopy[0], first[1] - canopy[2])
  )[0]
  cells.updateVisibility(farthestCorner[0], farthestCorner[1], true)
  expect(cells.getActiveCellIds()).not.toContain(canopyBatch.cellId)
  expect(cells.cameraVegetationVisibilityFraction(target, camera)).toBe(1)

  cells.dispose()
  registry.dispose()
})

test("keeps the northern bridge audit orbit clear of canopy clipping", () => {
  const registry = new JourneyWorldAssetRegistry(world)
  const cells = new JourneyCellManager(world, registry, "balanced")
  const player = new THREE.Vector3(4.693, 0.8, -59.416)
  const target = player.clone().add(new THREE.Vector3(0, 1.08, 0))
  cells.updateVisibility(player.x, player.z, true)

  let nearestFraction = 1
  const orbitOffset = new THREE.Vector3(0, 4.2, 10.8)
  for (let step = 0; step < 72; step += 1) {
    const desiredCamera = orbitOffset
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), (step / 72) * Math.PI * 2)
      .add(target)
    const fraction = cells.cameraVegetationVisibilityFraction(
      target,
      desiredCamera
    )
    nearestFraction = Math.min(nearestFraction, fraction)
  }
  expect(nearestFraction).toBeGreaterThanOrEqual(0.9)

  cells.dispose()
  registry.dispose()
})
