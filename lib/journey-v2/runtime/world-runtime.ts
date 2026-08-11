import * as THREE from "three"
import { JOURNEY_V2_PALETTE, JOURNEY_V2_QUALITY } from "@/lib/journey-v2/design"
import { JourneyAtmosphere } from "@/lib/journey-v2/runtime/atmosphere"
import { JourneyAvatar } from "@/lib/journey-v2/runtime/avatar"
import { combineCameraVisibilityFractions } from "@/lib/journey-v2/runtime/camera-occlusion"
import {
  createJourneyCodeMaterial,
  type JourneyAnimatedMaterial,
} from "@/lib/journey-v2/runtime/code-materials"
import { JourneyCollisionWorld } from "@/lib/journey-v2/runtime/collision-world"
import { JourneyFarLandscape } from "@/lib/journey-v2/runtime/far-landscape"
import { JourneyNavigation } from "@/lib/journey-v2/runtime/navigation"
import { JourneyPerformanceMonitor } from "@/lib/journey-v2/runtime/performance-monitor"
import {
  checkpointArrivalDistance,
  distancePointToSegment2D,
} from "@/lib/journey-v2/runtime/proximity"
import {
  JourneyCellManager,
  JourneyWorldAssetRegistry,
} from "@/lib/journey-v2/runtime/scene-assets"
import { nextAdaptiveEnvironmentDensity } from "@/lib/journey-v2/runtime/streaming-policy"
import { JourneySurfaceWorld } from "@/lib/journey-v2/runtime/surface-world"
import type {
  JourneyWorldManifest,
  JourneyWorldMovementInput,
  JourneyWorldRuntimeCallbacks,
  JourneyWorldRuntimeEvent,
  JourneyWorldRuntimeOptions,
  JourneyWorldSnapshot,
  Vec3,
} from "@/lib/journey-v2/runtime/types"
import type {
  CellWorldAsset,
  CellWorldAssetV3,
} from "@/lib/journey-v2/contracts/world"

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
])
const CAMERA_KEYS = new Set(["KeyJ", "KeyL"])
const RUN_KEYS = new Set(["ShiftLeft", "ShiftRight"])
const PLAYER_RADIUS = 0.38
const WALK_SPEED = 4.2
const RUN_SPEED = 6.2
const ASSISTED_SPEED = 3.25
const NEARBY_DISTANCE = 11
const SNAPSHOT_INTERVAL_MOVING = 0.5
const SNAPSHOT_INTERVAL_IDLE = 2
const Y_AXIS = new THREE.Vector3(0, 1, 0)
type JourneyCellAsset = CellWorldAsset | CellWorldAssetV3

export interface JourneyOpeningOrientation {
  cameraYaw: number
  avatarHeading: number
}

/**
 * Faces the opening shot along the authored road, choosing the segment nearest
 * the spawn. Forward input and the camera therefore share the same world-space
 * direction instead of relying on unrelated magic angles.
 */
export function journeyOpeningOrientation(
  manifest: JourneyWorldManifest
): JourneyOpeningOrientation {
  const centerlines: readonly (readonly [number, number])[][] =
    manifest.schemaVersion === 3
      ? manifest.roads.map((road) =>
          road.centerline.map(([x, , z]) => [x, z] as const)
        )
      : manifest.roads.map((road) => road.centerline)
  const [spawnX, , spawnZ] = manifest.world.spawn
  let nearestDistance = Number.POSITIVE_INFINITY
  let forwardX = 0
  let forwardZ = 0

  for (const centerline of centerlines) {
    for (let index = 0; index < centerline.length - 1; index += 1) {
      const [fromX, fromZ] = centerline[index]
      const [toX, toZ] = centerline[index + 1]
      const distance = distancePointToSegment2D(
        spawnX,
        spawnZ,
        fromX,
        fromZ,
        toX,
        toZ
      )
      if (distance >= nearestDistance) continue
      const length = Math.hypot(toX - fromX, toZ - fromZ)
      if (length <= Number.EPSILON) continue
      nearestDistance = distance
      forwardX = (toX - fromX) / length
      forwardZ = (toZ - fromZ) / length
    }
  }

  if (!Number.isFinite(nearestDistance)) {
    const cameraYaw = 0.58
    return { cameraYaw, avatarHeading: cameraYaw - Math.PI }
  }
  return {
    cameraYaw: Math.atan2(-forwardX, -forwardZ),
    avatarHeading: Math.atan2(forwardX, forwardZ),
  }
}

interface RuntimeCheckpoint {
  checkpointId: string
  recordId: string
  position: Vec3
  interactionRadius: number
  title?: string
  shortTitle?: string
}

function runtimeCheckpoints(
  manifest: JourneyWorldManifest
): RuntimeCheckpoint[] {
  if (manifest.schemaVersion === 3) {
    return manifest.checkpoints.map((checkpoint) => ({
      checkpointId: checkpoint.id,
      recordId: checkpoint.recordId,
      position: checkpoint.position,
      interactionRadius: checkpoint.interactionRadius,
    }))
  }
  return manifest.landmarks.map((landmark) => ({
    checkpointId: landmark.id,
    recordId: landmark.id,
    position: landmark.position,
    interactionRadius: NEARBY_DISTANCE,
    title: landmark.title,
    shortTitle: landmark.shortTitle,
  }))
}

function navigationTargets(manifest: JourneyWorldManifest) {
  if (manifest.schemaVersion === 2) {
    return manifest.navigation.landmarkNodeIds
  }
  const targets: Record<string, string> = {
    ...manifest.navigation.checkpointNodeIds,
  }
  for (const checkpoint of manifest.checkpoints) {
    const nodeId = manifest.navigation.checkpointNodeIds[checkpoint.id]
    if (nodeId) targets[checkpoint.recordId] = nodeId
  }
  return targets
}

function buildingWayfindingLabels(
  manifest: JourneyWorldManifest,
  labelsByRecordId: Readonly<Record<string, string>>
) {
  const labels = new Map<string, string>()
  if (manifest.schemaVersion === 3) {
    for (const checkpoint of manifest.checkpoints) {
      const label = labelsByRecordId[checkpoint.recordId]?.trim()
      if (label) labels.set(checkpoint.arrivalBuildingId, label)
    }
    return labels
  }
  for (const landmark of manifest.landmarks) {
    const label = labelsByRecordId[landmark.id]?.trim()
    if (label && landmark.buildingId) labels.set(landmark.buildingId, label)
  }
  return labels
}

function ignoresWorldInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'input, textarea, select, button, a, [role="button"], [contenteditable="true"], [data-journey-panel]'
      )
    )
  )
}

interface JourneyWorldRuntimeConstructor {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  manifest: JourneyWorldManifest
  options: JourneyWorldRuntimeOptions
  callbacks?: JourneyWorldRuntimeCallbacks
  getMovementInput: () => JourneyWorldMovementInput
  setDpr: (dpr: number) => void
  requestRender: () => void
  wayfindingLabels?: Readonly<Record<string, string>>
  loadedCellIds?: Set<string>
  loadCell?: (cellId: string) => Promise<JourneyCellAsset>
}

export class JourneyWorldRuntime {
  private readonly root = new THREE.Group()
  private readonly registry: JourneyWorldAssetRegistry
  private readonly cells: JourneyCellManager
  private readonly collision: JourneyCollisionWorld
  private readonly surfaces: JourneySurfaceWorld
  private readonly navigation: JourneyNavigation
  private readonly avatar: JourneyAvatar
  private readonly atmosphere: JourneyAtmosphere
  private readonly farLandscape: JourneyFarLandscape
  private readonly checkpoints: RuntimeCheckpoint[]
  private readonly hemisphere = new THREE.HemisphereLight(
    JOURNEY_V2_PALETTE.sky,
    JOURNEY_V2_PALETTE.fieldShadow,
    2.1
  )
  private readonly sun = new THREE.DirectionalLight("#fff2d4", 2.35)
  private readonly playerPosition = new THREE.Vector3()
  private readonly playerXZ = new THREE.Vector2()
  private readonly movementXZ = new THREE.Vector2()
  private readonly collisionTarget = new THREE.Vector2()
  private readonly movementDirection = new THREE.Vector3()
  private readonly previousPlayerXZ = new THREE.Vector2()
  private readonly cameraTarget = new THREE.Vector3()
  private readonly smoothedCameraTarget = new THREE.Vector3()
  private readonly desiredCamera = new THREE.Vector3()
  private readonly raisedCamera = new THREE.Vector3()
  private readonly cameraOffset = new THREE.Vector3()
  private readonly keys = new Set<string>()
  private readonly arrivedLandmarks = new Set<string>()
  private readonly getMovementInput: () => JourneyWorldMovementInput
  private readonly requestRender: () => void
  private readonly loadCell?: (cellId: string) => Promise<JourneyCellAsset>
  private readonly loadingCells = new Map<string, Promise<JourneyCellAsset>>()
  private readonly cellLoadFailures = new Map<
    string,
    { attempts: number; retryAt: number }
  >()
  private readonly cellRetryTimers = new Map<string, number>()
  private readonly previousBackground: THREE.Color | THREE.Texture | null
  private readonly previousFog: THREE.Fog | THREE.FogExp2 | null
  private readonly performanceMonitor: JourneyPerformanceMonitor
  private callbacks: JourneyWorldRuntimeCallbacks
  private options: JourneyWorldRuntimeOptions
  private cameraYaw = 0.58
  private heading = Math.PI
  private moving = false
  private running = false
  private elapsed = 0
  private lastInputAt = performance.now()
  private lastSnapshotAt = Number.NEGATIVE_INFINITY
  private nearbyLandmarkId: string | null = null
  private nearestLandmarkId: string | null = null
  private nearestDistance: number | null = null
  private activeRoute: Vec3[] | null = null
  private routeCursor = 0
  private routeRequestKey = ""
  private cancelledRouteKey: string | null = null
  private dragging = false
  private previousPointerX = 0
  private disposed = false
  private samplingPerformance = false
  private ready = false
  private contextLost = false
  private preparePromise: Promise<void> | null = null
  private adaptiveDensityScale = 1
  private readonly groundGeometry: THREE.PlaneGeometry | null
  private readonly groundMaterial: JourneyAnimatedMaterial | null

  constructor({
    scene,
    camera,
    renderer,
    manifest,
    options,
    callbacks = {},
    getMovementInput,
    setDpr,
    requestRender,
    wayfindingLabels = {},
    loadedCellIds,
    loadCell,
  }: JourneyWorldRuntimeConstructor) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.manifest = manifest
    this.options = options
    this.callbacks = callbacks
    this.getMovementInput = getMovementInput
    this.requestRender = requestRender
    this.loadCell = loadCell
    this.previousBackground = scene.background
    this.previousFog = scene.fog
    const openingOrientation = journeyOpeningOrientation(manifest)
    this.cameraYaw = openingOrientation.cameraYaw
    this.heading = openingOrientation.avatarHeading

    this.collision = new JourneyCollisionWorld(
      manifest.colliders,
      manifest.world.bounds,
      manifest.world.cellSize
    )
    this.surfaces = new JourneySurfaceWorld(manifest)
    this.registry = new JourneyWorldAssetRegistry(manifest)
    this.cells = new JourneyCellManager(
      manifest,
      this.registry,
      options.quality,
      loadedCellIds,
      loadCell ? (cellId) => this.requestCell(cellId) : undefined,
      loadCell
        ? (cellId) => {
            this.collision.removeCell(cellId)
            this.surfaces.unregisterCell(cellId)
          }
        : undefined,
      buildingWayfindingLabels(manifest, wayfindingLabels)
    )
    this.checkpoints = runtimeCheckpoints(manifest)
    this.navigation = new JourneyNavigation(
      manifest.navigation.nodes,
      manifest.navigation.edges,
      navigationTargets(manifest)
    )
    this.avatar = new JourneyAvatar(JOURNEY_V2_QUALITY[options.quality].shadows)
    this.atmosphere = new JourneyAtmosphere(
      manifest.world.bounds,
      manifest.seed
    )
    this.farLandscape = new JourneyFarLandscape(this.registry)
    this.performanceMonitor = new JourneyPerformanceMonitor({
      renderer,
      quality: options.quality,
      onMetrics: (metrics) => {
        renderer.domElement.dataset.journeyV2Fps = metrics.fps.toFixed(1)
        renderer.domElement.dataset.journeyV2FrameMs =
          metrics.p95FrameMs.toFixed(2)
        renderer.domElement.dataset.journeyV2DrawCalls = String(
          metrics.drawCalls
        )
        const nextDensity = nextAdaptiveEnvironmentDensity(
          metrics,
          this.adaptiveDensityScale
        )
        if (this.cells.setAdaptiveDensityScale(nextDensity)) {
          this.adaptiveDensityScale = nextDensity
          renderer.domElement.dataset.journeyV2Density = nextDensity.toFixed(2)
          this.requestRender()
        }
        this.syncResidencyDataset()
        this.emit({ type: "performance", metrics })
      },
      onDprChange: setDpr,
    })

    this.root.name = "journey-v2-world"
    const [minX, minZ, maxX, maxZ] = manifest.world.bounds
    if (manifest.schemaVersion === 2) {
      this.groundGeometry = new THREE.PlaneGeometry(
        maxX - minX + 24,
        maxZ - minZ + 24
      )
      this.groundMaterial = createJourneyCodeMaterial({
        id: "journey-v2-fallback-field",
        kind: "toon",
        color: JOURNEY_V2_PALETTE.field,
        roughness: 1,
        vertexColors: false,
      })
      const ground = new THREE.Mesh(
        this.groundGeometry,
        this.groundMaterial.material
      )
      ground.name = "journey-v2-field"
      ground.rotation.x = -Math.PI / 2
      ground.position.set(
        (minX + maxX) * 0.5,
        manifest.world.spawn[1] - 0.035,
        (minZ + maxZ) * 0.5
      )
      ground.receiveShadow = true
      ground.castShadow = false
      ground.matrixAutoUpdate = false
      ground.updateMatrix()
      this.root.add(ground)
    } else {
      this.groundGeometry = null
      this.groundMaterial = null
    }
    this.root.add(
      this.atmosphere.object,
      this.farLandscape.object,
      this.cells.object,
      this.avatar.object
    )
    scene.add(this.root)
    scene.background = new THREE.Color(JOURNEY_V2_PALETTE.sky)
    scene.fog = new THREE.Fog(JOURNEY_V2_PALETTE.skyHaze, 58, 132)

    this.hemisphere.position.set(0, 1, 0)
    scene.add(this.hemisphere)
    this.sun.position.set(15, 24, 12)
    this.sun.castShadow = JOURNEY_V2_QUALITY[options.quality].shadows
    this.sun.shadow.mapSize.set(512, 512)
    this.sun.shadow.bias = -0.00045
    const shadowCamera = this.sun.shadow.camera
    shadowCamera.left = -11
    shadowCamera.right = 11
    shadowCamera.top = 11
    shadowCamera.bottom = -11
    shadowCamera.near = 1
    shadowCamera.far = 48
    scene.add(this.sun, this.sun.target)
    renderer.shadowMap.enabled = this.sun.castShadow
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const [spawnX, spawnY, spawnZ] = manifest.world.spawn
    const spawnSurface = this.surfaces.sample(spawnX, spawnZ)
    this.playerPosition.set(
      spawnX,
      spawnSurface.walkable ? spawnSurface.height : spawnY,
      spawnZ
    )
    this.avatar.object.position.copy(this.playerPosition)
    this.smoothedCameraTarget.set(spawnX, spawnY + 1.05, spawnZ)
    this.updateCamera(1)
    const activeCellIds = this.cells.updateVisibility(spawnX, spawnZ, true)
    if (activeCellIds) {
      this.emit({ type: "cell-visibility", activeCellIds })
    }
    this.syncResidencyDataset()

    this.attachInput()
    this.syncAssistedRoute()
    renderer.domElement.dataset.journeyV2Renderer = renderer.capabilities
      .isWebGL2
      ? "webgl2"
      : "webgl1"
    renderer.domElement.dataset.journeyV2Quality = options.quality
    renderer.domElement.dataset.journeyV2Density =
      this.adaptiveDensityScale.toFixed(2)
    renderer.domElement.dataset.journeyV2Generation =
      manifest.schemaVersion === 3
        ? manifest.checksum
        : manifest.generatorVersion
  }

  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly manifest: JourneyWorldManifest

  private emit(event: JourneyWorldRuntimeEvent) {
    this.callbacks.onEvent?.(event)
  }

  private syncResidencyDataset() {
    const metrics = this.cells.getResidencyMetrics()
    const dataset = this.renderer.domElement.dataset
    dataset.journeyV2ActiveCells = String(metrics.active)
    dataset.journeyV2ResidentCells = String(metrics.gpuResident)
    dataset.journeyV2StreamedCells = String(metrics.streamed)
    dataset.journeyV2LoadingCells = String(metrics.loading)
    dataset.journeyV2PrefetchedCells = String(metrics.prefetched)
  }

  private nextPaint() {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  /**
   * Shader compilation and one requested R3F paint are part of readiness.
   * Performance calibration starts afterwards, so upload/compile spikes cannot
   * immediately force a lower DPR.
   */
  prepare() {
    if (this.preparePromise) return this.preparePromise
    this.preparePromise = (async () => {
      await this.renderer.compileAsync(this.scene, this.camera)
      if (this.disposed || this.contextLost) return
      this.requestRender()
      await this.nextPaint()
      await this.nextPaint()
      if (this.disposed || this.contextLost) return
      this.ready = true
      this.performanceMonitor.restartWarmup()
      this.renderer.domElement.dataset.journeyV2Ready = "true"
      this.renderer.domElement.dataset.journeyV2World = "ready"
      this.emit({
        type: "ready",
        schemaVersion: this.manifest.schemaVersion,
        generatorVersion: this.manifest.generatorVersion,
        landmarkCount: this.checkpoints.length,
        checkpointCount: this.checkpoints.length,
      })
      this.callbacks.onReady?.()
      this.reportSnapshot(true)
    })()
    return this.preparePromise
  }

  handleContextLost() {
    if (this.disposed || this.contextLost) return
    this.contextLost = true
    this.ready = false
    this.samplingPerformance = false
    this.performanceMonitor.suspendSampling()
    this.renderer.domElement.dataset.journeyV2Context = "lost"
    this.emit({ type: "context-lost" })
  }

  async handleContextRestored() {
    if (this.disposed) return
    this.contextLost = false
    this.renderer.domElement.dataset.journeyV2Context = "restoring"
    await this.renderer.compileAsync(this.scene, this.camera)
    if (this.disposed || this.contextLost) return
    this.requestRender()
    await this.nextPaint()
    await this.nextPaint()
    if (this.disposed || this.contextLost) return
    this.ready = true
    this.performanceMonitor.restartWarmup()
    this.renderer.domElement.dataset.journeyV2Context = "ready"
    this.renderer.domElement.dataset.journeyV2Ready = "true"
    this.renderer.domElement.dataset.journeyV2World = "ready"
    this.emit({ type: "context-restored" })
  }

  private requestCell(cellId: string) {
    if (!this.loadCell || this.loadingCells.has(cellId)) return
    const now = performance.now()
    const failure = this.cellLoadFailures.get(cellId)
    if (failure && now < failure.retryAt) {
      this.cells.markCellLoadFailed(cellId)
      return
    }
    this.cells.markCellLoadPending(cellId)
    const promise = this.loadCell(cellId)
    this.loadingCells.set(cellId, promise)
    this.syncResidencyDataset()
    void promise
      .then((asset) => {
        if (this.disposed) return
        this.cellLoadFailures.delete(cellId)
        const retryTimer = this.cellRetryTimers.get(cellId)
        if (retryTimer !== undefined) window.clearTimeout(retryTimer)
        this.cellRetryTimers.delete(cellId)
        this.registry.registerGeometries(asset.geometries)
        this.collision.addColliders(asset.colliders)
        this.surfaces.registerCell(asset)
        if (this.cells.registerCellAsset(asset)) this.requestRender()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.cells.markCellLoadFailed(cellId)
        const attempts = (failure?.attempts ?? 0) + 1
        const retryInMs = Math.min(8_000, 500 * 2 ** (attempts - 1))
        this.cellLoadFailures.set(cellId, {
          attempts,
          retryAt: performance.now() + retryInMs,
        })
        const previousTimer = this.cellRetryTimers.get(cellId)
        if (previousTimer !== undefined) window.clearTimeout(previousTimer)
        const retryTimer = window.setTimeout(() => {
          this.cellRetryTimers.delete(cellId)
          if (!this.disposed) this.requestCell(cellId)
        }, retryInMs)
        this.cellRetryTimers.set(cellId, retryTimer)
        this.emit({
          type: "cell-load-failed",
          cellId,
          message:
            error instanceof Error
              ? error.message
              : `Journey cell "${cellId}" failed to load`,
          retryInMs,
        })
      })
      .finally(() => {
        this.loadingCells.delete(cellId)
        if (!this.disposed) this.syncResidencyDataset()
      })
  }

  setCallbacks(callbacks: JourneyWorldRuntimeCallbacks) {
    this.callbacks = callbacks
  }

  setOptions(options: JourneyWorldRuntimeOptions) {
    const previous = this.options
    this.options = options

    if (previous.quality !== options.quality) {
      const quality = JOURNEY_V2_QUALITY[options.quality]
      this.cells.setQuality(options.quality)
      this.avatar.setShadows(quality.shadows)
      this.sun.castShadow = quality.shadows
      this.renderer.shadowMap.enabled = quality.shadows
      this.performanceMonitor.setQuality(options.quality)
      this.renderer.domElement.dataset.journeyV2Quality = options.quality
      const activeCellIds = this.cells.updateVisibility(
        this.playerPosition.x,
        this.playerPosition.z,
        true
      )
      if (activeCellIds) {
        this.emit({ type: "cell-visibility", activeCellIds })
      }
      this.syncResidencyDataset()
    }
    if (options.paused && !previous.paused) this.keys.clear()
    if (
      previous.destinationId !== options.destinationId ||
      previous.assistedTravel !== options.assistedTravel
    ) {
      this.syncAssistedRoute()
    }
    this.requestRender()
  }

  setViewport(width: number, height: number) {
    const nextFov = width / Math.max(height, 1) < 0.78 ? 53 : 44
    if (this.camera.fov === nextFov) return
    this.camera.fov = nextFov
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  private attachInput() {
    window.addEventListener("keydown", this.onKeyDown, { passive: false })
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("blur", this.clearInput)
    const canvas = this.renderer.domElement
    canvas.addEventListener("pointerdown", this.onPointerDown)
    canvas.addEventListener("pointermove", this.onPointerMove)
    canvas.addEventListener("pointerup", this.onPointerUp)
    canvas.addEventListener("pointercancel", this.onPointerUp)
  }

  private detachInput() {
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("blur", this.clearInput)
    const canvas = this.renderer.domElement
    canvas.removeEventListener("pointerdown", this.onPointerDown)
    canvas.removeEventListener("pointermove", this.onPointerMove)
    canvas.removeEventListener("pointerup", this.onPointerUp)
    canvas.removeEventListener("pointercancel", this.onPointerUp)
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (
      this.options.paused ||
      ignoresWorldInput(event.target) ||
      (!MOVEMENT_KEYS.has(event.code) &&
        !CAMERA_KEYS.has(event.code) &&
        !RUN_KEYS.has(event.code))
    ) {
      return
    }
    event.preventDefault()
    this.keys.add(event.code)
    this.lastInputAt = performance.now()
    this.requestRender()
  }

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
    this.lastInputAt = performance.now()
    this.requestRender()
  }

  private readonly clearInput = () => {
    this.keys.clear()
    this.dragging = false
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.options.paused || event.button !== 0) return
    this.dragging = true
    this.previousPointerX = event.clientX
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.lastInputAt = performance.now()
    this.requestRender()
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.dragging || this.options.paused) return
    const difference = event.clientX - this.previousPointerX
    this.previousPointerX = event.clientX
    this.cameraYaw -= difference * 0.006
    this.lastInputAt = performance.now()
    this.requestRender()
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    this.dragging = false
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
    }
  }

  private syncAssistedRoute() {
    const destinationId = this.options.destinationId
    const nextKey =
      destinationId && this.options.assistedTravel ? destinationId : ""
    if (nextKey === this.routeRequestKey) return

    if (this.activeRoute && this.routeRequestKey) {
      this.emit({
        type: "assisted-cancelled",
        destinationId: this.routeRequestKey,
        reason:
          destinationId !== this.routeRequestKey
            ? "destination-changed"
            : "disabled",
      })
    }
    this.activeRoute = null
    this.cells.clearRoutePrefetch()
    this.routeCursor = 0
    this.routeRequestKey = nextKey
    this.cancelledRouteKey = null
    if (!nextKey) return

    const route = this.navigation.routeToLandmark(this.playerPosition, nextKey)
    if (!route) {
      this.cancelledRouteKey = nextKey
      this.emit({ type: "assisted-unavailable", destinationId: nextKey })
      return
    }
    this.activeRoute = route
    this.prefetchActiveRoute()
  }

  private prefetchActiveRoute() {
    if (!this.activeRoute) return
    const remaining: Vec3[] = [
      [this.playerPosition.x, this.playerPosition.y, this.playerPosition.z],
      ...this.activeRoute.slice(this.routeCursor),
    ]
    this.cells.prefetchRoute(remaining)
    this.syncResidencyDataset()
  }

  private manualInput() {
    const external = this.getMovementInput()
    const x =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0) +
      (Number.isFinite(external.x) ? external.x : 0)
    const z =
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) +
      (Number.isFinite(external.z) ? external.z : 0)
    this.movementDirection.set(x, 0, z)
    const hasInput = this.movementDirection.lengthSq() > 0.0144
    if (hasInput) {
      this.movementDirection.normalize().applyAxisAngle(Y_AXIS, this.cameraYaw)
    }
    return {
      hasInput,
      run:
        Boolean(external.run) ||
        this.keys.has("ShiftLeft") ||
        this.keys.has("ShiftRight"),
    }
  }

  private assistedDirection(): boolean {
    while (this.activeRoute) {
      const waypoint = this.activeRoute[this.routeCursor]
      if (!waypoint) return false
      this.movementDirection.set(
        waypoint[0] - this.playerPosition.x,
        0,
        waypoint[2] - this.playerPosition.z
      )
      const finalWaypoint = this.routeCursor === this.activeRoute.length - 1
      const arrivalDistance = finalWaypoint ? 1.15 : 0.52
      if (
        this.movementDirection.lengthSq() >
        arrivalDistance * arrivalDistance
      ) {
        this.movementDirection.normalize()
        this.prefetchActiveRoute()
        return true
      }
      if (finalWaypoint) {
        const destinationId = this.routeRequestKey
        this.activeRoute = null
        this.routeCursor = 0
        this.cells.clearRoutePrefetch()
        if (destinationId) {
          this.emit({ type: "assisted-complete", destinationId })
        }
        return false
      }
      this.routeCursor += 1
      this.prefetchActiveRoute()
    }
    return false
  }

  private movePlayer(delta: number) {
    if (this.options.paused) {
      this.moving = false
      this.running = false
      return
    }

    if (this.keys.has("KeyJ")) {
      this.cameraYaw += delta * 1.45
      this.lastInputAt = performance.now()
    }
    if (this.keys.has("KeyL")) {
      this.cameraYaw -= delta * 1.45
      this.lastInputAt = performance.now()
    }

    const manual = this.manualInput()
    if (manual.hasInput && this.activeRoute) {
      const destinationId = this.routeRequestKey || null
      this.activeRoute = null
      this.cells.clearRoutePrefetch()
      this.cancelledRouteKey = this.routeRequestKey
      this.emit({
        type: "assisted-cancelled",
        destinationId,
        reason: "manual-input",
      })
    }
    const assisted =
      !manual.hasInput &&
      this.cancelledRouteKey !== this.routeRequestKey &&
      this.assistedDirection()
    this.moving = manual.hasInput || assisted
    this.running = manual.hasInput && manual.run
    if (!this.moving) return

    if (manual.hasInput) {
      this.cells.prefetchDirection(
        this.playerPosition.x,
        this.playerPosition.z,
        this.movementDirection.x,
        this.movementDirection.z
      )
      this.syncResidencyDataset()
    }

    this.lastInputAt = manual.hasInput ? performance.now() : this.lastInputAt
    const speed = assisted
      ? ASSISTED_SPEED
      : this.running
        ? RUN_SPEED
        : WALK_SPEED
    const distance = speed * delta
    const steps = Math.max(1, Math.ceil(distance / 0.16))
    const stepDistance = distance / steps
    this.playerXZ.set(this.playerPosition.x, this.playerPosition.z)
    const movementStartX = this.playerXZ.x
    const movementStartZ = this.playerXZ.y
    let surfaceHeight = this.playerPosition.y

    for (let step = 0; step < steps; step += 1) {
      this.movementXZ.set(
        this.movementDirection.x * stepDistance,
        this.movementDirection.z * stepDistance
      )
      this.collision.moveCircle(
        this.playerXZ,
        this.movementXZ,
        PLAYER_RADIUS,
        this.collisionTarget
      )
      if (
        !this.surfaces.hasCompiledSurfaceAt(
          this.collisionTarget.x,
          this.collisionTarget.y
        )
      ) {
        this.cells.prefetchDirection(
          this.playerXZ.x,
          this.playerXZ.y,
          this.movementDirection.x,
          this.movementDirection.z
        )
        break
      }
      const current: Vec3 = [this.playerXZ.x, surfaceHeight, this.playerXZ.y]
      const resolved = this.surfaces.resolveMovement(
        current,
        this.collisionTarget.x,
        this.collisionTarget.y
      )
      if (resolved.accepted) {
        this.playerXZ.set(resolved.x, resolved.z)
        surfaceHeight = resolved.y
        continue
      }

      // Preserve a natural slide along shorelines, steep banks and bridge
      // rails instead of stopping both axes when only one axis is blocked.
      const slideX = this.surfaces.resolveMovement(
        current,
        this.collisionTarget.x,
        this.playerXZ.y
      )
      const slideZ = this.surfaces.resolveMovement(
        current,
        this.playerXZ.x,
        this.collisionTarget.y
      )
      const xProgress = slideX.accepted
        ? Math.abs(slideX.x - this.playerXZ.x)
        : 0
      const zProgress = slideZ.accepted
        ? Math.abs(slideZ.z - this.playerXZ.y)
        : 0
      const slide = xProgress >= zProgress ? slideX : slideZ
      if (slide.accepted) {
        this.playerXZ.set(slide.x, slide.z)
        surfaceHeight = slide.y
      }
    }

    this.playerPosition.x = this.playerXZ.x
    this.playerPosition.y = surfaceHeight
    this.playerPosition.z = this.playerXZ.y
    if (
      Math.hypot(
        this.playerXZ.x - movementStartX,
        this.playerXZ.y - movementStartZ
      ) < 1e-4
    ) {
      this.moving = false
      this.running = false
    }
    this.avatar.object.position.copy(this.playerPosition)
    this.heading = Math.atan2(
      this.movementDirection.x,
      this.movementDirection.z
    )
  }

  private cameraVisibilityFraction(to: THREE.Vector3) {
    return combineCameraVisibilityFractions(
      this.collision.cameraVisibilityFraction(this.smoothedCameraTarget, to),
      this.cells.cameraVegetationVisibilityFraction(
        this.smoothedCameraTarget,
        to
      )
    )
  }

  private updateCamera(delta: number) {
    const lookAhead = this.moving ? 0.72 : 0
    this.cameraTarget.set(
      this.playerPosition.x + this.movementDirection.x * lookAhead,
      this.playerPosition.y + 1.08,
      this.playerPosition.z + this.movementDirection.z * lookAhead
    )
    const targetDamping = 1 - Math.exp(-Math.max(delta, 0.001) * 11)
    this.smoothedCameraTarget.lerp(this.cameraTarget, targetDamping)
    const cameraDistance = this.camera.fov > 50 ? 10.5 : 10.8
    this.cameraOffset
      .set(0, this.camera.fov > 50 ? 5 : 4.2, cameraDistance)
      .applyAxisAngle(Y_AXIS, this.cameraYaw)
    this.desiredCamera.copy(this.smoothedCameraTarget).add(this.cameraOffset)
    let terrainLift = 0
    for (const fraction of [0.35, 0.7, 1]) {
      const sampleX = THREE.MathUtils.lerp(
        this.smoothedCameraTarget.x,
        this.desiredCamera.x,
        fraction
      )
      const sampleZ = THREE.MathUtils.lerp(
        this.smoothedCameraTarget.z,
        this.desiredCamera.z,
        fraction
      )
      const pathHeight = THREE.MathUtils.lerp(
        this.smoothedCameraTarget.y,
        this.desiredCamera.y,
        fraction
      )
      const surface = this.surfaces.sample(sampleX, sampleZ)
      terrainLift = Math.max(terrainLift, surface.height + 1.15 - pathHeight)
    }
    if (terrainLift > 0) this.desiredCamera.y += terrainLift
    let visibleFraction = this.cameraVisibilityFraction(this.desiredCamera)
    if (visibleFraction < 0.9) {
      this.raisedCamera
        .copy(this.desiredCamera)
        .addScaledVector(Y_AXIS, 3.2 + (1 - visibleFraction) * 2.8)
      const raisedVisibleFraction = this.cameraVisibilityFraction(
        this.raisedCamera
      )
      if (raisedVisibleFraction > visibleFraction + 0.06) {
        this.desiredCamera.copy(this.raisedCamera)
        visibleFraction = raisedVisibleFraction
      }
    }
    this.desiredCamera
      .sub(this.smoothedCameraTarget)
      .multiplyScalar(visibleFraction)
      .add(this.smoothedCameraTarget)
    const movingInward =
      this.desiredCamera.distanceToSquared(this.smoothedCameraTarget) + 0.16 <
      this.camera.position.distanceToSquared(this.smoothedCameraTarget)
    const positionDamping =
      1 - Math.exp(-Math.max(delta, 0.001) * (movingInward ? 18 : 8))
    this.camera.position.lerp(this.desiredCamera, positionDamping)
    this.camera.lookAt(this.smoothedCameraTarget)

    if (this.sun.castShadow) {
      this.sun.position.set(
        this.playerPosition.x + 14,
        24,
        this.playerPosition.z + 10
      )
      this.sun.target.position.set(
        this.playerPosition.x,
        this.playerPosition.y,
        this.playerPosition.z
      )
      this.sun.target.updateMatrixWorld()
    }
  }

  private updateLandmarkProximity(fromX: number, fromZ: number) {
    let nearestId: string | null = null
    let nearestCheckpointId: string | null = null
    let nearestTitle = ""
    let nearestShortTitle = ""
    let nearbyDistance = NEARBY_DISTANCE
    let distance = Number.POSITIVE_INFINITY
    for (const checkpoint of this.checkpoints) {
      const candidateDistance = Math.hypot(
        checkpoint.position[0] - this.playerPosition.x,
        checkpoint.position[2] - this.playerPosition.z
      )
      if (candidateDistance < distance) {
        distance = candidateDistance
        nearestId = checkpoint.recordId
        nearestCheckpointId = checkpoint.checkpointId
        nearestTitle = checkpoint.title ?? ""
        nearestShortTitle = checkpoint.shortTitle ?? ""
        nearbyDistance = checkpoint.interactionRadius
      }
    }

    const nextNearbyId = distance <= nearbyDistance ? nearestId : null
    if (nextNearbyId !== this.nearbyLandmarkId) {
      if (this.nearbyLandmarkId) {
        this.emit({ type: "landmark-left", id: this.nearbyLandmarkId })
      }
      this.nearbyLandmarkId = nextNearbyId
      if (nextNearbyId) {
        this.emit({
          type: "nearby-landmark",
          id: nextNearbyId,
          checkpointId: nearestCheckpointId ?? undefined,
          recordId: nextNearbyId,
          title: nearestTitle,
          shortTitle: nearestShortTitle,
          distance,
        })
      }
    }
    this.nearestLandmarkId = nearestId
    this.nearestDistance = nearestId ? distance : null

    for (const checkpoint of this.checkpoints) {
      if (this.arrivedLandmarks.has(checkpoint.recordId)) continue
      const segmentDistance = distancePointToSegment2D(
        checkpoint.position[0],
        checkpoint.position[2],
        fromX,
        fromZ,
        this.playerPosition.x,
        this.playerPosition.z
      )
      if (
        segmentDistance >
        checkpointArrivalDistance(checkpoint.interactionRadius)
      ) {
        continue
      }
      this.arrivedLandmarks.add(checkpoint.recordId)
      this.emit({
        type: "landmark-arrival",
        id: checkpoint.recordId,
        distance: segmentDistance,
      })
    }
  }

  private reportSnapshot(force = false) {
    const interval = this.moving
      ? SNAPSHOT_INTERVAL_MOVING
      : SNAPSHOT_INTERVAL_IDLE
    if (!force && this.elapsed - this.lastSnapshotAt < interval) return
    this.lastSnapshotAt = this.elapsed
    this.callbacks.onSnapshot?.(this.getSnapshot())
  }

  update(deltaSeconds: number) {
    if (this.disposed || this.contextLost || document.hidden) return
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.075)
    this.elapsed += delta
    this.atmosphere.update(this.camera, delta, this.options.reducedMotion)
    this.cells.updateMaterials(this.elapsed, this.options.reducedMotion)
    this.groundMaterial?.update(this.options.reducedMotion ? 0 : this.elapsed)
    if (!this.ready) return

    this.previousPlayerXZ.set(this.playerPosition.x, this.playerPosition.z)
    this.movePlayer(delta)
    this.avatar.update(
      this.elapsed,
      delta,
      this.moving,
      this.running,
      this.heading,
      this.options.reducedMotion
    )
    this.updateCamera(delta)
    this.updateLandmarkProximity(
      this.previousPlayerXZ.x,
      this.previousPlayerXZ.y
    )

    const activeCellIds = this.cells.updateVisibility(
      this.playerPosition.x,
      this.playerPosition.z
    )
    if (activeCellIds) {
      this.emit({ type: "cell-visibility", activeCellIds })
    }
    this.syncResidencyDataset()
    this.reportSnapshot()
    const shouldSamplePerformance =
      !this.options.paused && this.hasActiveAnimation()
    if (shouldSamplePerformance) {
      if (this.samplingPerformance) {
        this.performanceMonitor.sample(delta)
      } else {
        // The first active frame follows the deliberately throttled idle loop.
        // Reset the window so that idle time is not mistaken for GPU work.
        this.performanceMonitor.suspendSampling()
        this.samplingPerformance = true
      }
    } else if (this.samplingPerformance) {
      this.performanceMonitor.suspendSampling()
      this.samplingPerformance = false
    }
  }

  private hasActiveAnimation() {
    return (
      this.moving ||
      Boolean(this.activeRoute) ||
      this.dragging ||
      this.keys.has("KeyJ") ||
      this.keys.has("KeyL") ||
      performance.now() - this.lastInputAt < 1_250
    )
  }

  desiredFramesPerSecond() {
    if (this.options.paused || this.contextLost || document.hidden) return 0
    if (!this.ready) return 0
    if (this.hasActiveAnimation()) {
      return 60
    }
    return this.options.reducedMotion ? 10 : 20
  }

  getSnapshot(): JourneyWorldSnapshot {
    return {
      x: this.playerPosition.x,
      y: this.playerPosition.y,
      z: this.playerPosition.z,
      heading: this.heading,
      moving: this.moving,
      nearestLandmarkId: this.nearestLandmarkId,
      nearestDistance: this.nearestDistance,
      destinationId: this.options.destinationId,
      activeCellIds: this.cells.getActiveCellIds(),
      performance: this.performanceMonitor.getLastMetrics(),
    }
  }

  resetPlayer() {
    const [x, authoredY, z] = this.manifest.world.spawn
    const surface = this.surfaces.sample(x, z)
    const y = surface.walkable ? surface.height : authoredY
    this.playerPosition.set(x, y, z)
    this.avatar.object.position.copy(this.playerPosition)
    this.activeRoute = null
    this.routeCursor = 0
    this.routeRequestKey = ""
    this.cancelledRouteKey = null
    this.arrivedLandmarks.clear()
    this.syncAssistedRoute()
    this.cells.updateVisibility(x, z, true)
    this.syncResidencyDataset()
    this.updateCamera(1)
    this.reportSnapshot(true)
    this.requestRender()
  }

  requestFrame() {
    this.requestRender()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.detachInput()
    this.cells.dispose()
    this.avatar.dispose()
    this.atmosphere.dispose()
    this.farLandscape.dispose()
    this.registry.dispose()
    this.groundGeometry?.dispose()
    this.groundMaterial?.material.dispose()
    this.loadingCells.clear()
    this.cellLoadFailures.clear()
    for (const timer of this.cellRetryTimers.values()) {
      window.clearTimeout(timer)
    }
    this.cellRetryTimers.clear()
    this.root.removeFromParent()
    this.hemisphere.removeFromParent()
    this.sun.removeFromParent()
    this.sun.target.removeFromParent()
    this.sun.shadow.map?.dispose()
    this.scene.background = this.previousBackground
    this.scene.fog = this.previousFog
    delete this.renderer.domElement.dataset.journeyV2Fps
    delete this.renderer.domElement.dataset.journeyV2FrameMs
    delete this.renderer.domElement.dataset.journeyV2DrawCalls
    delete this.renderer.domElement.dataset.journeyV2Renderer
    delete this.renderer.domElement.dataset.journeyV2Quality
    delete this.renderer.domElement.dataset.journeyV2Generation
    delete this.renderer.domElement.dataset.journeyV2Ready
    delete this.renderer.domElement.dataset.journeyV2Context
    delete this.renderer.domElement.dataset.journeyV2Density
    delete this.renderer.domElement.dataset.journeyV2ActiveCells
    delete this.renderer.domElement.dataset.journeyV2ResidentCells
    delete this.renderer.domElement.dataset.journeyV2StreamedCells
    delete this.renderer.domElement.dataset.journeyV2LoadingCells
    delete this.renderer.domElement.dataset.journeyV2PrefetchedCells
  }
}
