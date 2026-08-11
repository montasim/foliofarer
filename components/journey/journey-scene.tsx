"use client"

import * as React from "react"
import { useFrame, useThree } from "@react-three/fiber"
import {
  CapsuleCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier"
import * as THREE from "three"
import { MontasimAvatar } from "@/components/journey/montasim-avatar"
import { JourneyPerformanceMonitor } from "@/components/journey/journey-performance-monitor"
import { JourneyWorld } from "@/components/journey/journey-world"
import type {
  AssistedRouteState,
  JourneyLandmark,
  JourneyLandmarkId,
  JourneyRenderTier,
  MovementInput,
  WorldPosition,
} from "@/lib/journey/types"
import { JOURNEY_START_POSITION } from "@/lib/journey/world-layout"

const UP = new THREE.Vector3(0, 1, 0)
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
const RUN_KEYS = ["KeyW", "KeyS", "ArrowUp", "ArrowDown"] as const
const WALK_SPEED = 4.15
const RUN_SPEED = 6.35
const ASSISTED_TRAVEL_SPEED = 3.1
const RUN_HOLD_DELAY_MS = 650

interface PlayerProps {
  assistedRoute: AssistedRouteState
  paused: boolean
  reducedMotion: boolean
  movementRef: React.MutableRefObject<MovementInput>
  cameraYawRef: React.MutableRefObject<number>
  playerPositionRef: React.MutableRefObject<THREE.Vector3>
  onAssistedTravelCancel: () => void
  onAssistedWaypointReached: () => void
  onPositionChange: (x: number, y: number, z: number) => void
}

function Player({
  assistedRoute,
  paused,
  reducedMotion,
  movementRef,
  cameraYawRef,
  playerPositionRef,
  onAssistedTravelCancel,
  onAssistedWaypointReached,
  onPositionChange,
}: PlayerProps) {
  const body = React.useRef<RapierRigidBody>(null)
  const visual = React.useRef<THREE.Group>(null)
  const movingRef = React.useRef(false)
  const runningRef = React.useRef(false)
  const keys = React.useRef(new Set<string>())
  const keyHoldStartedAt = React.useRef(new Map<string, number>())
  const lastPositionReport = React.useRef(0)
  const lastReportedPosition = React.useRef(
    new THREE.Vector3(...JOURNEY_START_POSITION)
  )
  const activeWaypoint = React.useRef<WorldPosition | null>(null)
  const arrivalReported = React.useRef(false)
  const direction = React.useRef(new THREE.Vector3())

  React.useEffect(() => {
    const activeKeys = keys.current
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        paused ||
        target?.closest(
          '[data-journey-panel], [role="dialog"], input, textarea, select, [contenteditable="true"]'
        )
      )
        return
      if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault()
        if (!activeKeys.has(event.code)) {
          keyHoldStartedAt.current.set(event.code, performance.now())
        }
        activeKeys.add(event.code)
      }
    }
    const up = (event: KeyboardEvent) => {
      activeKeys.delete(event.code)
      keyHoldStartedAt.current.delete(event.code)
    }
    const clear = () => {
      activeKeys.clear()
      keyHoldStartedAt.current.clear()
    }
    window.addEventListener("keydown", down, { passive: false })
    window.addEventListener("keyup", up)
    window.addEventListener("blur", clear)
    return () => {
      clear()
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", clear)
    }
  }, [paused])

  useFrame(({ clock }, delta) => {
    const rigidBody = body.current
    if (!rigidBody) return

    const translation = rigidBody.translation()
    const current = playerPositionRef.current.set(
      translation.x,
      translation.y,
      translation.z
    )

    if (translation.y < -2) {
      rigidBody.setTranslation(
        {
          x: JOURNEY_START_POSITION[0],
          y: JOURNEY_START_POSITION[1],
          z: JOURNEY_START_POSITION[2],
        },
        true
      )
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
      return
    }

    const keyboardX =
      (keys.current.has("KeyD") || keys.current.has("ArrowRight") ? 1 : 0) -
      (keys.current.has("KeyA") || keys.current.has("ArrowLeft") ? 1 : 0)
    const keyboardZ =
      (keys.current.has("KeyS") || keys.current.has("ArrowDown") ? 1 : 0) -
      (keys.current.has("KeyW") || keys.current.has("ArrowUp") ? 1 : 0)
    const localX = keyboardX + movementRef.current.x
    const localZ = keyboardZ + movementRef.current.z
    const hasManualInput = localX * localX + localZ * localZ > 0.0144
    const hasSustainedForwardInput =
      keyboardZ !== 0 &&
      RUN_KEYS.some((code) => {
        const startedAt = keyHoldStartedAt.current.get(code)
        return (
          keys.current.has(code) &&
          startedAt !== undefined &&
          performance.now() - startedAt >= RUN_HOLD_DELAY_MS
        )
      })

    const route = assistedRoute
    const waypoint = route.waypoints[route.cursor]
    const hasAssistedRoute = waypoint !== undefined
    if (activeWaypoint.current !== waypoint) {
      activeWaypoint.current = waypoint ?? null
      arrivalReported.current = false
    }

    const movementDirection = direction.current.set(0, 0, 0)

    if (!paused && hasManualInput) {
      movementDirection
        .set(localX, 0, localZ)
        .normalize()
        .applyAxisAngle(UP, cameraYawRef.current)
      if (hasAssistedRoute) onAssistedTravelCancel()
    } else if (!paused && waypoint) {
      movementDirection.set(waypoint[0] - current.x, 0, waypoint[2] - current.z)
      const arrivalDistance =
        route.cursor === route.waypoints.length - 1 ? 2.2 : 0.8
      if (movementDirection.lengthSq() <= arrivalDistance * arrivalDistance) {
        movementDirection.set(0, 0, 0)
        if (!arrivalReported.current) {
          arrivalReported.current = true
          onAssistedWaypointReached()
        }
      } else {
        movementDirection.normalize()
      }
    }

    movingRef.current = movementDirection.lengthSq() > 0.01
    runningRef.current = hasManualInput && hasSustainedForwardInput
    const velocity = rigidBody.linvel()
    const speed =
      hasAssistedRoute && !hasManualInput
        ? ASSISTED_TRAVEL_SPEED
        : hasSustainedForwardInput
          ? RUN_SPEED
          : WALK_SPEED
    rigidBody.setLinvel(
      {
        x: paused ? 0 : movementDirection.x * speed,
        y: velocity.y,
        z: paused ? 0 : movementDirection.z * speed,
      },
      true
    )

    if (movingRef.current && visual.current) {
      const targetRotation = Math.atan2(
        movementDirection.x,
        movementDirection.z
      )
      const difference = Math.atan2(
        Math.sin(targetRotation - visual.current.rotation.y),
        Math.cos(targetRotation - visual.current.rotation.y)
      )
      visual.current.rotation.y += difference * (1 - Math.exp(-delta * 12))
    }

    if (
      clock.elapsedTime - lastPositionReport.current > 0.12 &&
      lastReportedPosition.current.distanceToSquared(current) > 0.0025
    ) {
      lastPositionReport.current = clock.elapsedTime
      lastReportedPosition.current.copy(current)
      onPositionChange(current.x, current.y, current.z)
    }
  })

  return (
    <RigidBody
      ref={body}
      position={[...JOURNEY_START_POSITION]}
      colliders={false}
      enabledRotations={[false, false, false]}
      linearDamping={8}
      friction={0}
      canSleep={false}
      ccd
    >
      <CapsuleCollider
        args={[0.48, 0.3]}
        position={[0, -0.02, 0]}
        friction={0}
      />
      <group ref={visual} position={[0, 0.12, 0]}>
        <MontasimAvatar
          movingRef={movingRef}
          runningRef={runningRef}
          reducedMotion={reducedMotion}
        />
      </group>
    </RigidBody>
  )
}

function FollowCamera({
  playerPositionRef,
  cameraYawRef,
  reducedMotion,
  paused,
}: {
  playerPositionRef: React.MutableRefObject<THREE.Vector3>
  cameraYawRef: React.MutableRefObject<number>
  reducedMotion: boolean
  paused: boolean
}) {
  const { camera, gl, size } = useThree()
  const cameraRef = React.useRef(camera)
  const dragging = React.useRef(false)
  const previousX = React.useRef(0)
  const offset = React.useRef(new THREE.Vector3())
  const desired = React.useRef(new THREE.Vector3())
  const smoothedTarget = React.useRef(
    new THREE.Vector3(...JOURNEY_START_POSITION)
  )
  const turnKeys = React.useRef(new Set<string>())

  React.useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  React.useEffect(() => {
    const perspectiveCamera = cameraRef.current as THREE.PerspectiveCamera
    perspectiveCamera.fov = size.width / size.height < 0.78 ? 53 : 44
    perspectiveCamera.updateProjectionMatrix()
  }, [size.height, size.width])

  React.useEffect(() => {
    const element = gl.domElement
    const pointerDown = (event: PointerEvent) => {
      dragging.current = true
      previousX.current = event.clientX
      element.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current) return
      const difference = event.clientX - previousX.current
      previousX.current = event.clientX
      cameraYawRef.current -= difference * 0.006
    }
    const pointerUp = (event: PointerEvent) => {
      dragging.current = false
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId)
    }
    element.addEventListener("pointerdown", pointerDown)
    element.addEventListener("pointermove", pointerMove)
    element.addEventListener("pointerup", pointerUp)
    element.addEventListener("pointercancel", pointerUp)
    return () => {
      element.removeEventListener("pointerdown", pointerDown)
      element.removeEventListener("pointermove", pointerMove)
      element.removeEventListener("pointerup", pointerUp)
      element.removeEventListener("pointercancel", pointerUp)
    }
  }, [cameraYawRef, gl])

  React.useEffect(() => {
    const activeTurnKeys = turnKeys.current
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        paused ||
        target?.closest(
          '[data-journey-panel], [role="dialog"], input, textarea, select, [contenteditable="true"]'
        )
      )
        return
      if (event.code !== "KeyJ" && event.code !== "KeyL") return
      event.preventDefault()
      activeTurnKeys.add(event.code)
    }
    const up = (event: KeyboardEvent) => activeTurnKeys.delete(event.code)
    const clear = () => activeTurnKeys.clear()
    window.addEventListener("keydown", down, { passive: false })
    window.addEventListener("keyup", up)
    window.addEventListener("blur", clear)
    return () => {
      activeTurnKeys.clear()
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", clear)
    }
  }, [paused])

  useFrame((_, delta) => {
    if (!paused) {
      const turnDirection =
        (turnKeys.current.has("KeyJ") ? 1 : 0) -
        (turnKeys.current.has("KeyL") ? 1 : 0)
      cameraYawRef.current += turnDirection * delta * 1.45
    }
    const player = playerPositionRef.current
    const portrait = size.width / size.height < 0.78
    const target = smoothedTarget.current
    if (target.distanceToSquared(player) > 64) {
      target.copy(player)
    } else {
      target.lerp(player, 1 - Math.exp(-delta * 10))
    }
    offset.current
      .set(0, portrait ? 12.96 : 10.56, portrait ? 19.44 : 15.84)
      .applyAxisAngle(UP, cameraYawRef.current)
    desired.current.copy(target).add(offset.current)
    const activeCamera = cameraRef.current
    const damping = reducedMotion ? 1 : 1 - Math.exp(-delta * 6)
    activeCamera.position.lerp(desired.current, damping)
    activeCamera.lookAt(target.x, target.y + 0.65, target.z)
  })

  return null
}

interface JourneySceneProps extends PlayerProps {
  landmarks: readonly JourneyLandmark[]
  activeLandmark: JourneyLandmark
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  renderTier: JourneyRenderTier
  performanceMonitoring: boolean
  onFrameTime: (p95FrameTimeMs: number) => void
  onRenderTierChange: (
    tier: JourneyRenderTier,
    direction: "upgrade" | "downgrade",
    p95FrameTimeMs: number
  ) => void
  onSceneReady: () => void
  reducedMotion: boolean
}

function SceneReadySignal({ onReady }: { onReady: () => void }) {
  const renderedFrames = React.useRef(0)
  const reported = React.useRef(false)

  useFrame(() => {
    if (reported.current) return
    renderedFrames.current += 1
    if (renderedFrames.current < 2) return
    reported.current = true
    onReady()
  })

  return null
}

function JourneySceneComponent(props: JourneySceneProps) {
  return (
    <>
      <JourneyWorld
        landmarks={props.landmarks}
        activeLandmark={props.activeLandmark}
        discoveredIds={props.discoveredIds}
        renderTier={props.renderTier}
        reducedMotion={props.reducedMotion}
      />
      <Player
        assistedRoute={props.assistedRoute}
        paused={props.paused}
        reducedMotion={props.reducedMotion}
        movementRef={props.movementRef}
        cameraYawRef={props.cameraYawRef}
        playerPositionRef={props.playerPositionRef}
        onAssistedTravelCancel={props.onAssistedTravelCancel}
        onAssistedWaypointReached={props.onAssistedWaypointReached}
        onPositionChange={props.onPositionChange}
      />
      <FollowCamera
        playerPositionRef={props.playerPositionRef}
        cameraYawRef={props.cameraYawRef}
        reducedMotion={props.reducedMotion}
        paused={props.paused}
      />
      <JourneyPerformanceMonitor
        enabled={props.performanceMonitoring}
        tier={props.renderTier}
        onFrameTime={props.onFrameTime}
        onTierChange={props.onRenderTierChange}
      />
      <SceneReadySignal onReady={props.onSceneReady} />
    </>
  )
}

export const JourneyScene = React.memo(JourneySceneComponent)
