import fs from "node:fs"
import { expect, test } from "@playwright/test"
import * as THREE from "three"
import type { WorldManifest } from "../../lib/journey-v2/contracts/world"
import { JourneyNavigation } from "../../lib/journey-v2/runtime/navigation"

const world = JSON.parse(
  fs.readFileSync(
    new URL("../../public/journey-v2/generated/world.json", import.meta.url),
    "utf8"
  )
) as WorldManifest

function routeLength(route: readonly (readonly number[])[]) {
  return route.slice(1).reduce((total, point, index) => {
    const previous = route[index]
    return total + Math.hypot(point[0] - previous[0], point[2] - previous[2])
  }, 0)
}

test("string-pulls assisted routes through the walkable portals", () => {
  const navigation = new JourneyNavigation(
    world.navigation.nodes,
    world.navigation.edges,
    world.navigation.landmarkNodeIds
  )
  const spawn = new THREE.Vector3(...world.world.spawn)

  for (const landmark of world.landmarks) {
    const route = navigation.routeToLandmark(spawn, landmark.id)
    expect(route, `${landmark.id} should be reachable`).not.toBeNull()
    if (!route) continue

    for (let index = 1; index < route.length; index += 1) {
      expect(
        Math.hypot(
          route[index][0] - route[index - 1][0],
          route[index][2] - route[index - 1][2]
        ),
        `${landmark.id} should not contain duplicate corners`
      ).toBeGreaterThan(0.01)
    }

    const directDistance = Math.hypot(
      landmark.position[0] - spawn.x,
      landmark.position[2] - spawn.z
    )
    expect(routeLength(route)).toBeLessThanOrEqual(directDistance * 1.8 + 15)
  }

  const schoolRoute = navigation.routeToLandmark(spawn, "rangpur-zilla-school")
  expect(schoolRoute?.length).toBeLessThanOrEqual(12)
  expect(routeLength(schoolRoute ?? [])).toBeLessThan(45)
})
