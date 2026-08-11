import * as THREE from "three"
import { JOURNEY_V2_PALETTE } from "@/lib/journey-v2/design"
import {
  createJourneyCodeMaterial,
  type JourneyAnimatedMaterial,
} from "@/lib/journey-v2/runtime/code-materials"

function toonMaterial(id: string, color: string, roughness = 0.9) {
  return createJourneyCodeMaterial({
    id,
    kind: "toon",
    color,
    roughness,
    vertexColors: false,
  })
}

export class JourneyAvatar {
  readonly object = new THREE.Group()
  private readonly animatedRoot = new THREE.Group()
  private readonly leftArm = new THREE.Group()
  private readonly rightArm = new THREE.Group()
  private readonly leftLeg = new THREE.Group()
  private readonly rightLeg = new THREE.Group()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly animatedMaterials: JourneyAnimatedMaterial[] = []
  private heading = 0

  constructor(shadows: boolean) {
    this.object.name = "journey-v2-player"
    this.animatedRoot.name = "journey-v2-avatar"
    this.object.add(this.animatedRoot)

    const box = new THREE.BoxGeometry(1, 1, 1)
    const sphere = new THREE.SphereGeometry(0.5, 10, 7)
    const shadowCircle = new THREE.CircleGeometry(0.56, 18)
    this.geometries.push(box, sphere, shadowCircle)

    const animated = [
      toonMaterial("avatar.trousers", "#263331"),
      toonMaterial("avatar.shoes", "#17211f", 0.96),
      toonMaterial("avatar.jacket", "#263f50", 0.78),
      toonMaterial("avatar.shirt", "#f2f0e9", 0.82),
      toonMaterial("avatar.route", JOURNEY_V2_PALETTE.route, 0.8),
      toonMaterial("avatar.skin", "#a66f57", 0.92),
      toonMaterial("avatar.hair", "#1d1917", 0.97),
    ]
    this.animatedMaterials.push(...animated)
    const [trousers, shoes, jacket, shirt, route, skin, hair] = animated.map(
      (entry) => entry.material
    )
    const shadow = new THREE.MeshBasicMaterial({
      color: "#173a38",
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    })
    this.materials.push(
      trousers,
      shoes,
      jacket,
      shirt,
      route,
      skin,
      hair,
      shadow
    )

    const mesh = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      scale: [number, number, number],
      parent = this.animatedRoot
    ) => {
      const part = new THREE.Mesh(geometry, material)
      part.position.set(...position)
      part.scale.set(...scale)
      part.castShadow = shadows
      part.receiveShadow = false
      parent.add(part)
      return part
    }

    this.leftLeg.position.set(-0.19, 0.61, 0)
    this.rightLeg.position.set(0.19, 0.61, 0)
    this.leftArm.position.set(-0.48, 1.24, 0)
    this.rightArm.position.set(0.48, 1.24, 0)
    this.animatedRoot.add(
      this.leftLeg,
      this.rightLeg,
      this.leftArm,
      this.rightArm
    )

    mesh(box, trousers, [0, -0.28, 0], [0.25, 0.58, 0.27], this.leftLeg)
    mesh(box, shoes, [0, -0.59, 0.055], [0.28, 0.13, 0.38], this.leftLeg)
    mesh(box, trousers, [0, -0.28, 0], [0.25, 0.58, 0.27], this.rightLeg)
    mesh(box, shoes, [0, -0.59, 0.055], [0.28, 0.13, 0.38], this.rightLeg)

    mesh(box, jacket, [0, 1, 0], [0.72, 0.78, 0.35])
    mesh(box, shirt, [0, 1.08, 0.19], [0.32, 0.55, 0.025])
    const badge = mesh(box, route, [0, 1.03, 0.216], [0.1, 0.1, 0.035])
    badge.rotation.z = Math.PI / 4
    mesh(box, jacket, [0, -0.28, 0], [0.22, 0.66, 0.27], this.leftArm)
    mesh(sphere, skin, [0, -0.64, 0], [0.26, 0.26, 0.26], this.leftArm)
    mesh(box, jacket, [0, -0.28, 0], [0.22, 0.66, 0.27], this.rightArm)
    mesh(sphere, skin, [0, -0.64, 0], [0.26, 0.26, 0.26], this.rightArm)
    mesh(sphere, skin, [0, 1.74, 0], [0.72, 0.72, 0.72])
    mesh(sphere, hair, [0, 2, -0.02], [0.76, 0.32, 0.7])

    const blob = mesh(
      shadowCircle,
      shadow,
      [0, 0.016, 0],
      [1, 1, 1],
      this.object
    )
    blob.rotation.x = -Math.PI / 2
    blob.renderOrder = 3
    blob.castShadow = false
    blob.userData.journeyNoShadow = true
  }

  setShadows(enabled: boolean) {
    this.animatedRoot.traverse((object) => {
      if (object instanceof THREE.Mesh && !object.userData.journeyNoShadow) {
        object.castShadow = enabled
      }
    })
  }

  update(
    elapsed: number,
    delta: number,
    moving: boolean,
    running: boolean,
    targetHeading: number,
    reducedMotion: boolean
  ) {
    const damping = 1 - Math.exp(-delta * 12)
    const angleDifference = Math.atan2(
      Math.sin(targetHeading - this.heading),
      Math.cos(targetHeading - this.heading)
    )
    this.heading += angleDifference * damping
    this.animatedRoot.rotation.y = this.heading

    const strideRate = running ? 13 : 9
    const strideLength = running ? 0.68 : 0.55
    const stride =
      moving && !reducedMotion
        ? Math.sin(elapsed * strideRate) * strideLength
        : 0
    this.leftArm.rotation.x += (-stride - this.leftArm.rotation.x) * damping
    this.rightArm.rotation.x += (stride - this.rightArm.rotation.x) * damping
    this.leftLeg.rotation.x += (stride - this.leftLeg.rotation.x) * damping
    this.rightLeg.rotation.x += (-stride - this.rightLeg.rotation.x) * damping
    const bob =
      moving && !reducedMotion
        ? Math.abs(Math.sin(elapsed * strideRate)) * (running ? 0.055 : 0.035)
        : 0
    this.animatedRoot.position.y +=
      (bob - this.animatedRoot.position.y) * damping
    const materialTime = reducedMotion ? 0 : elapsed
    for (const material of this.animatedMaterials) {
      material.update(materialTime)
    }
  }

  dispose() {
    this.object.removeFromParent()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.animatedMaterials.length = 0
  }
}
