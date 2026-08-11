import { expect, test } from "@playwright/test"
import * as THREE from "three"

import { JourneyAtmosphere } from "../../lib/journey-v2/runtime/atmosphere"

const WORLD_BOUNDS = [-80, -240, 80, 40] as const
const WORLD_SEED = 2_025_061_4

function renderObjects(atmosphere: JourneyAtmosphere) {
  const objects: THREE.Mesh[] = []
  atmosphere.object.traverse((object) => {
    if (object instanceof THREE.Mesh) objects.push(object)
  })
  return objects
}

function materialsOf(object: THREE.Mesh) {
  return Array.isArray(object.material) ? object.material : [object.material]
}

function textureReferences(material: THREE.Material) {
  const references = Object.entries(material)
    .filter(([, value]) => value instanceof THREE.Texture)
    .map(([property]) => property)

  if (material instanceof THREE.ShaderMaterial) {
    for (const [uniform, definition] of Object.entries(material.uniforms)) {
      const value = definition.value
      if (
        value instanceof THREE.Texture ||
        (Array.isArray(value) &&
          value.some((candidate) => candidate instanceof THREE.Texture))
      ) {
        references.push(`uniforms.${uniform}`)
      }
    }
  }

  return references
}

function numericArray(value: ArrayLike<number> | undefined) {
  return value ? Array.from(value) : []
}

function topologySnapshot(atmosphere: JourneyAtmosphere) {
  return renderObjects(atmosphere)
    .map((object) => {
      const position = object.geometry.getAttribute("position")
      return {
        name: object.name,
        type: object.type,
        geometryType: object.geometry.type,
        position: object.position.toArray(),
        quaternion: object.quaternion.toArray(),
        scale: object.scale.toArray(),
        vertices: numericArray(position?.array),
        indices: numericArray(object.geometry.index?.array),
        instanceCount:
          object instanceof THREE.InstancedMesh ? object.count : null,
        instanceMatrices:
          object instanceof THREE.InstancedMesh
            ? numericArray(object.instanceMatrix.array)
            : [],
      }
    })
    .sort((first, second) => first.name.localeCompare(second.name))
}

test("the procedural atmosphere is open, texture-free, bounded, and deterministic", () => {
  const first = new JourneyAtmosphere(WORLD_BOUNDS, WORLD_SEED)
  const second = new JourneyAtmosphere(WORLD_BOUNDS, WORLD_SEED)
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 145)
  camera.position.set(17.5, 6.25, -83.75)

  try {
    first.update(camera, 1 / 30)
    second.update(camera, 1 / 30)

    const objects = renderObjects(first)
    const names = objects.map((object) => object.name)

    expect(names).toEqual(
      expect.arrayContaining([
        "journey-v3-sky",
        "journey-v3-clouds",
        "journey-v3-distant-birds",
      ])
    )
    expect(names).not.toContain("journey-v3-horizon")
    expect(objects.length).toBeGreaterThanOrEqual(2)
    expect(objects.length).toBeLessThanOrEqual(4)

    const insideFacingCylinders = objects
      .filter((object) => object.geometry instanceof THREE.CylinderGeometry)
      .filter((object) =>
        materialsOf(object).some((material) => material.side === THREE.BackSide)
      )
      .map((object) => object.name)
    expect(insideFacingCylinders).toEqual([])

    const textureBackedMaterials = objects.flatMap((object) =>
      materialsOf(object).flatMap((material) =>
        textureReferences(material).map(
          (reference) => `${object.name}:${material.name}:${reference}`
        )
      )
    )
    expect(textureBackedMaterials).toEqual([])

    expect(topologySnapshot(first)).toEqual(topologySnapshot(second))
  } finally {
    first.dispose()
    second.dispose()
  }
})

test("reduced motion freezes the shared summer-breeze phase", () => {
  const atmosphere = new JourneyAtmosphere(WORLD_BOUNDS, WORLD_SEED)
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 145)
  camera.position.set(17.5, 6.25, -83.75)

  try {
    atmosphere.update(camera, 1 / 30, true)
    const birds = atmosphere.object.getObjectByName("journey-v3-distant-birds")
    expect(birds).toBeInstanceOf(THREE.InstancedMesh)
    const firstMatrices = numericArray(
      (birds as THREE.InstancedMesh).instanceMatrix.array
    )

    atmosphere.update(camera, 2, true)
    expect(
      numericArray((birds as THREE.InstancedMesh).instanceMatrix.array)
    ).toEqual(firstMatrices)
  } finally {
    atmosphere.dispose()
  }
})
