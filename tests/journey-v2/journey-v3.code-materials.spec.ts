import { expect, test } from "@playwright/test"
import * as THREE from "three"

import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3"
import { createJourneyCodeMaterial } from "../../lib/journey-v2/runtime/code-materials"

test("compiled water bodies keep normalized body-specific flow materials", () => {
  const world = compileJourneyWorldV3()
  const waterMaterialIds = new Set<string>()

  for (const water of world.waterBodies) {
    expect(Math.hypot(...water.flowDirection)).toBeCloseTo(1, 4)
    expect(water.flowSpeed).toBeGreaterThanOrEqual(0)
    expect(water.flowSpeed).toBeLessThanOrEqual(1)
    expect(water.flowStrength).toBeGreaterThanOrEqual(0)
    expect(water.flowStrength).toBeLessThanOrEqual(1)

    const geometryMaterials = new Set(
      water.geometryIds.map(
        (geometryId) =>
          world.geometries.find((geometry) => geometry.id === geometryId)
            ?.materialId
      )
    )
    expect(geometryMaterials.size).toBe(1)
    const [materialId] = geometryMaterials
    expect(materialId).toBe(`surface.${water.id}`)
    expect(materialId).toBeTruthy()
    waterMaterialIds.add(materialId!)

    const material = world.materials.find(
      (candidate) => candidate.id === materialId
    )
    expect(material).toMatchObject({
      kind: "water",
      flowDirection: water.flowDirection,
      flowSpeed: water.flowSpeed,
      flowStrength: water.flowStrength,
    })
  }

  expect(waterMaterialIds.size).toBe(world.waterBodies.length)
})

test("the code-only water shader receives directional flow uniforms", () => {
  const animated = createJourneyCodeMaterial({
    id: "surface.water.test-river",
    kind: "water",
    color: "#5ea9e1",
    roughness: 0.44,
    vertexColors: false,
    flowDirection: [3, 4],
    flowSpeed: 0.52,
    flowStrength: 0.88,
  })
  const material = animated.material as THREE.ShaderMaterial

  expect(material.isShaderMaterial).toBe(true)
  expect(material.vertexShader).toContain("uJourneyFlowDirection")
  expect(material.vertexShader).toContain("uJourneyBreezeDirection")
  expect(material.fragmentShader).toContain("directionalPhase")
  expect(material.fragmentShader).toContain("breezeRipple")
  expect(material.uniforms.uJourneyFlowDirection.value.x).toBeCloseTo(0.6, 6)
  expect(material.uniforms.uJourneyFlowDirection.value.y).toBeCloseTo(0.8, 6)
  expect(material.uniforms.uJourneyFlowSpeed.value).toBe(0.52)
  expect(material.uniforms.uJourneyFlowStrength.value).toBe(0.88)
  expect(material.uniforms.uJourneyBreezeDirection.value.length()).toBeCloseTo(
    1,
    6
  )

  animated.update(2.75)
  expect(material.uniforms.uJourneyTime.value).toBe(2.75)
  material.dispose()
})
