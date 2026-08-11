import fs from "node:fs"
import { expect, test } from "@playwright/test"
import type { WorldManifestV3 } from "../../lib/journey-v2/contracts/world"
import { journeyOpeningOrientation } from "../../lib/journey-v2/runtime/world-runtime"

const world = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../public/journey-v2/generated-next/world.json",
      import.meta.url
    ),
    "utf8"
  )
) as WorldManifestV3

test("opens facing forward along the journey road", () => {
  const orientation = journeyOpeningOrientation(world)
  const road = world.roads[0]
  const [fromX, , fromZ] = road.centerline[0]
  const [toX, , toZ] = road.centerline[1]
  const segmentLength = Math.hypot(toX - fromX, toZ - fromZ)
  const roadForwardX = (toX - fromX) / segmentLength
  const roadForwardZ = (toZ - fromZ) / segmentLength
  const inputForwardX = -Math.sin(orientation.cameraYaw)
  const inputForwardZ = -Math.cos(orientation.cameraYaw)
  const avatarForwardX = Math.sin(orientation.avatarHeading)
  const avatarForwardZ = Math.cos(orientation.avatarHeading)

  expect(
    inputForwardX * roadForwardX + inputForwardZ * roadForwardZ
  ).toBeCloseTo(1, 5)
  expect(
    avatarForwardX * roadForwardX + avatarForwardZ * roadForwardZ
  ).toBeCloseTo(1, 5)
  expect(inputForwardZ).toBeLessThan(-0.9)
})
