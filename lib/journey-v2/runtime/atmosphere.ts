import * as THREE from "three"
import { JOURNEY_V2_PALETTE } from "@/lib/journey-v2/design"
import type { Bounds2 } from "@/lib/journey-v2/runtime/types"

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vJourneySkyDirection;

  void main() {
    vJourneySkyDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uJourneyHorizon;
  uniform vec3 uJourneyZenith;
  uniform vec3 uJourneyCloud;
  varying vec3 vJourneySkyDirection;

  void main() {
    float altitude = smoothstep(-0.12, 0.82, vJourneySkyDirection.y);
    vec3 sky = mix(uJourneyHorizon, uJourneyZenith, altitude);
    vec3 sunDirection = normalize(vec3(-0.62, 0.31, -0.72));
    float sunGlow = pow(max(dot(vJourneySkyDirection, sunDirection), 0.0), 24.0);
    sky = mix(sky, uJourneyCloud, sunGlow * 0.38);
    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function seededUnit(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * A texture-free illustrated sky. The sky gradient is GLSL, while every cloud
 * lobe is an instance of one low-poly geometry authored in code.
 */
export class JourneyAtmosphere {
  readonly object = new THREE.Group()
  private readonly skyGeometry = new THREE.SphereGeometry(122, 24, 12)
  private readonly skyMaterial = new THREE.ShaderMaterial({
    name: "journey-v3-gradient-sky",
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: {
      uJourneyHorizon: {
        value: new THREE.Color(JOURNEY_V2_PALETTE.skyHaze),
      },
      uJourneyZenith: { value: new THREE.Color(JOURNEY_V2_PALETTE.sky) },
      uJourneyCloud: { value: new THREE.Color(JOURNEY_V2_PALETTE.cloud) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: true,
    fog: false,
  })
  private readonly cloudGeometry = new THREE.IcosahedronGeometry(1, 1)
  private readonly cloudMaterial = new THREE.MeshBasicMaterial({
    name: "journey-v3-code-cloud",
    color: JOURNEY_V2_PALETTE.cloud,
    fog: true,
    toneMapped: true,
  })
  private readonly birdGeometry = new THREE.BufferGeometry()
  private readonly birdMaterial = new THREE.MeshBasicMaterial({
    name: "journey-v3-code-bird",
    color: JOURNEY_V2_PALETTE.inkSoft,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
    toneMapped: true,
  })
  private readonly sky = new THREE.Mesh(this.skyGeometry, this.skyMaterial)
  private readonly clouds: THREE.InstancedMesh
  private readonly birds: THREE.InstancedMesh
  private readonly birdOffsets: ReadonlyArray<{
    x: number
    y: number
    z: number
    speed: number
    scale: number
  }>
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly yAxis = new THREE.Vector3(0, 1, 0)
  private readonly cloudAnchor = new THREE.Vector2()
  private readonly cloudTarget = new THREE.Vector2()
  private readonly breezeDirection = new THREE.Vector2(0.82, 0.57).normalize()
  private cloudAnchorReady = false
  private breezeElapsed = 0

  constructor(bounds: Bounds2, seed: number) {
    this.object.name = "journey-v3-atmosphere"
    this.sky.name = "journey-v3-sky"
    this.sky.renderOrder = -100
    this.sky.frustumCulled = false
    this.object.add(this.sky)

    const random = seededUnit(seed ^ 0xa7f23d91)
    const [minX, minZ, maxX, maxZ] = bounds
    const width = maxX - minX
    const depth = maxZ - minZ
    const worldScale = Math.max(width, depth)
    const clusterCount = Math.max(12, Math.min(20, Math.ceil(worldScale / 30)))
    const lobeCount = clusterCount * 4
    this.clouds = new THREE.InstancedMesh(
      this.cloudGeometry,
      this.cloudMaterial,
      lobeCount
    )
    this.clouds.name = "journey-v3-clouds"
    this.clouds.castShadow = false
    this.clouds.receiveShadow = false

    let instance = 0
    for (let cluster = 0; cluster < clusterCount; cluster += 1) {
      const angle = random() * Math.PI * 2
      const radius = 48 + random() * 52
      const centerX = Math.cos(angle) * radius
      const centerZ = Math.sin(angle) * radius
      const centerY = 19 + random() * 17
      const baseScale = 2.8 + random() * 3.8
      for (let lobe = 0; lobe < 4; lobe += 1) {
        this.position.set(
          centerX + (lobe - 1.5) * baseScale * 0.62,
          centerY + (lobe === 1 || lobe === 2 ? baseScale * 0.22 : 0),
          centerZ + (random() - 0.5) * baseScale * 0.7
        )
        this.scale.set(
          baseScale * (0.72 + random() * 0.5),
          baseScale * (0.38 + random() * 0.2),
          baseScale * (0.62 + random() * 0.42)
        )
        this.matrix.compose(this.position, this.quaternion, this.scale)
        this.clouds.setMatrixAt(instance, this.matrix)
        instance += 1
      }
    }
    this.clouds.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    this.clouds.instanceMatrix.needsUpdate = true
    this.clouds.computeBoundingBox()
    this.clouds.computeBoundingSphere()
    this.object.add(this.clouds)

    this.birdGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          0, 0, 0, -0.86, 0.08, -0.28, -0.16, 0, -0.1, 0, 0, 0, 0.86, 0.08,
          -0.28, 0.16, 0, -0.1,
        ],
        3
      )
    )
    this.birdGeometry.setIndex([0, 1, 2, 3, 4, 5])
    this.birdGeometry.computeVertexNormals()
    this.birdOffsets = Array.from({ length: 7 }, (_, index) => ({
      x: -36 + index * 7.4 + random() * 5,
      y: 14 + random() * 7,
      z: -38 + random() * 42,
      speed: 0.52 + random() * 0.28,
      scale: 0.42 + random() * 0.3,
    }))
    this.birds = new THREE.InstancedMesh(
      this.birdGeometry,
      this.birdMaterial,
      this.birdOffsets.length
    )
    this.birds.name = "journey-v3-distant-birds"
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.birds.castShadow = false
    this.birds.receiveShadow = false
    this.birds.frustumCulled = false
    this.object.add(this.birds)
  }

  update(camera: THREE.Camera, deltaSeconds = 1 / 60, reducedMotion = false) {
    this.sky.position.copy(camera.position)
    if (!reducedMotion) {
      this.breezeElapsed += Math.max(0, deltaSeconds)
    }
    if (!this.cloudAnchorReady) {
      this.cloudAnchor.set(camera.position.x, camera.position.z)
      this.cloudAnchorReady = true
    } else {
      const damping = 1 - Math.exp(-Math.max(deltaSeconds, 0.001) * 0.24)
      this.cloudAnchor.lerp(
        this.cloudTarget.set(camera.position.x, camera.position.z),
        damping
      )
    }
    const cloudDrift = this.breezeElapsed * 0.16
    this.clouds.position.set(
      this.cloudAnchor.x + this.breezeDirection.x * cloudDrift,
      0,
      this.cloudAnchor.y + this.breezeDirection.y * cloudDrift
    )
    const flockCycle = 118
    const birdHeading = Math.atan2(
      this.breezeDirection.x,
      this.breezeDirection.y
    )
    this.birdOffsets.forEach((bird, index) => {
      const progress =
        ((this.breezeElapsed * bird.speed + bird.x + flockCycle) % flockCycle) -
        flockCycle / 2
      this.position.set(
        this.cloudAnchor.x +
          progress * this.breezeDirection.x -
          bird.z * this.breezeDirection.y,
        camera.position.y + bird.y,
        this.cloudAnchor.y +
          progress * this.breezeDirection.y +
          bird.z * this.breezeDirection.x
      )
      this.quaternion.setFromAxisAngle(this.yAxis, birdHeading)
      const wingPulse = reducedMotion
        ? 1
        : 0.88 + Math.sin(this.breezeElapsed * 3.1 + index) * 0.12
      this.scale.set(bird.scale, wingPulse, bird.scale)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.birds.setMatrixAt(index, this.matrix)
    })
    this.birds.instanceMatrix.needsUpdate = true
    this.sky.updateMatrixWorld()
    this.clouds.updateMatrixWorld()
    this.birds.updateMatrixWorld()
  }

  dispose() {
    this.object.removeFromParent()
    this.clouds.dispose()
    this.skyGeometry.dispose()
    this.skyMaterial.dispose()
    this.cloudGeometry.dispose()
    this.cloudMaterial.dispose()
    this.birdGeometry.dispose()
    this.birdMaterial.dispose()
    this.birds.dispose()
  }
}
