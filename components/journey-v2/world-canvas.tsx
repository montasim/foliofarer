"use client"

import * as React from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  JOURNEY_V2_QUALITY,
  type JourneyV2Quality,
} from "@/lib/journey-v2/design"
import type {
  JourneyWorldMovementInput,
  JourneyWorldRuntimeCallbacks,
  JourneyWorldRuntimeEvent,
  JourneyWorldSnapshot,
  JourneyWorldUnavailableReason,
} from "@/lib/journey-v2/runtime/types"
import { supportsJourneyWebGL } from "@/lib/journey-v2/runtime/webgl-support"
import { JourneyWorldRuntime } from "@/lib/journey-v2/runtime/world-runtime"
import {
  DEFAULT_WORLD_URL,
  loadJourneyWorldBootstrap,
} from "@/lib/journey-v2/runtime/world-loader"

const EMPTY_WAYFINDING_LABELS: Readonly<Record<string, string>> = Object.freeze(
  {}
)

export interface WorldCanvasProps {
  enabled?: boolean
  paused: boolean
  reducedMotion: boolean
  quality?: JourneyV2Quality
  destinationId?: string | null
  assistedTravel?: boolean
  wayfindingLabels?: Readonly<Record<string, string>>
  movementRef?: React.RefObject<JourneyWorldMovementInput>
  worldUrl?: string
  className?: string
  onReady?: () => void
  onEvent?: (event: JourneyWorldRuntimeEvent) => void
  onSnapshot?: (snapshot: JourneyWorldSnapshot) => void
  onUnavailable?: (reason: JourneyWorldUnavailableReason) => void
}

export interface WorldCanvasHandle {
  getSnapshot: () => JourneyWorldSnapshot | null
  resetPlayer: () => void
  requestRender: () => void
}

interface RuntimeBridgeProps {
  paused: boolean
  reducedMotion: boolean
  quality: JourneyV2Quality
  destinationId: string | null
  assistedTravel: boolean
  wayfindingLabels: Readonly<Record<string, string>>
  movementRef?: React.RefObject<JourneyWorldMovementInput>
  worldUrl: string
  runtimeRef: React.MutableRefObject<JourneyWorldRuntime | null>
  callbacks: JourneyWorldRuntimeCallbacks
  onUnavailable?: (reason: JourneyWorldUnavailableReason) => void
}

function RuntimeBridge({
  paused,
  reducedMotion,
  quality,
  destinationId,
  assistedTravel,
  wayfindingLabels,
  movementRef,
  worldUrl,
  runtimeRef,
  callbacks,
  onUnavailable,
}: RuntimeBridgeProps) {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const renderer = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const setDpr = useThree((state) => state.setDpr)
  const size = useThree((state) => state.size)
  const callbacksRef = React.useRef(callbacks)
  const movementInputRef = React.useRef(movementRef)
  const unavailableRef = React.useRef(onUnavailable)
  const optionsRef = React.useRef({
    paused,
    reducedMotion,
    quality,
    destinationId,
    assistedTravel,
  })

  React.useEffect(() => {
    callbacksRef.current = callbacks
    movementInputRef.current = movementRef
    unavailableRef.current = onUnavailable
    optionsRef.current = {
      paused,
      reducedMotion,
      quality,
      destinationId,
      assistedTravel,
    }
  }, [
    assistedTravel,
    callbacks,
    destinationId,
    movementRef,
    onUnavailable,
    paused,
    quality,
    reducedMotion,
  ])

  React.useEffect(() => {
    const abortController = new AbortController()
    let disposed = false
    let ownedRuntime: JourneyWorldRuntime | null = null

    void loadJourneyWorldBootstrap(
      worldUrl,
      optionsRef.current.quality,
      abortController.signal
    )
      .then(async (bootstrap) => {
        if (disposed) return
        const runtime = new JourneyWorldRuntime({
          scene,
          camera,
          renderer,
          manifest: bootstrap.manifest,
          options: optionsRef.current,
          callbacks: {
            onReady: () => callbacksRef.current.onReady?.(),
            onEvent: (event) => callbacksRef.current.onEvent?.(event),
            onSnapshot: (snapshot) =>
              callbacksRef.current.onSnapshot?.(snapshot),
          },
          getMovementInput: () =>
            movementInputRef.current?.current ?? { x: 0, z: 0 },
          setDpr,
          requestRender: invalidate,
          wayfindingLabels,
          loadedCellIds: bootstrap.loadedCellIds,
          loadCell: bootstrap.loadCell,
        })
        ownedRuntime = runtime
        runtimeRef.current = runtime
        runtime.setViewport(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight
        )
        invalidate()
        await runtime.prepare()
      })
      .catch((error: unknown) => {
        if (disposed || abortController.signal.aborted) return
        const message =
          error instanceof Error
            ? error.message
            : "Journey world initialization failed"
        console.error("[Journey] 3D world initialization failed:", error)
        callbacksRef.current.onEvent?.({ type: "error", message })
        unavailableRef.current?.("initialization-failed")
      })

    return () => {
      disposed = true
      abortController.abort()
      ownedRuntime?.dispose()
      if (runtimeRef.current === ownedRuntime) runtimeRef.current = null
    }
  }, [
    camera,
    invalidate,
    renderer,
    runtimeRef,
    scene,
    setDpr,
    wayfindingLabels,
    worldUrl,
  ])

  React.useEffect(() => {
    runtimeRef.current?.setCallbacks({
      onReady: () => callbacksRef.current.onReady?.(),
      onEvent: (event) => callbacksRef.current.onEvent?.(event),
      onSnapshot: (snapshot) => callbacksRef.current.onSnapshot?.(snapshot),
    })
  }, [callbacks, runtimeRef])

  React.useEffect(() => {
    runtimeRef.current?.setOptions({
      paused,
      reducedMotion,
      quality,
      destinationId,
      assistedTravel,
    })
    invalidate()
  }, [
    assistedTravel,
    destinationId,
    invalidate,
    paused,
    quality,
    reducedMotion,
    runtimeRef,
  ])

  React.useEffect(() => {
    runtimeRef.current?.setViewport(size.width, size.height)
  }, [runtimeRef, size.height, size.width])

  React.useEffect(() => {
    let animationFrame = 0
    let lastRenderAt = 0
    const schedule = (now: number) => {
      const runtime = runtimeRef.current
      const desiredFps = runtime?.desiredFramesPerSecond() ?? 60
      if (desiredFps > 0 && now - lastRenderAt >= 1_000 / desiredFps - 0.75) {
        lastRenderAt = now
        invalidate()
      }
      animationFrame = window.requestAnimationFrame(schedule)
    }
    animationFrame = window.requestAnimationFrame(schedule)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [invalidate, runtimeRef])

  React.useEffect(() => {
    const canvas = renderer.domElement
    let recoveryTimer = 0
    const contextLost = (event: Event) => {
      event.preventDefault()
      const runtime = runtimeRef.current
      if (runtime) runtime.handleContextLost()
      else callbacksRef.current.onEvent?.({ type: "context-lost" })
      window.clearTimeout(recoveryTimer)
      recoveryTimer = window.setTimeout(() => {
        unavailableRef.current?.("context-lost")
      }, 3_000)
    }
    const contextRestored = () => {
      window.clearTimeout(recoveryTimer)
      const runtime = runtimeRef.current
      if (!runtime) {
        callbacksRef.current.onEvent?.({ type: "context-restored" })
        invalidate()
        return
      }
      recoveryTimer = window.setTimeout(() => {
        unavailableRef.current?.("context-lost")
      }, 3_000)
      void runtime
        .handleContextRestored()
        .then(() => window.clearTimeout(recoveryTimer))
        .catch((error: unknown) => {
          window.clearTimeout(recoveryTimer)
          callbacksRef.current.onEvent?.({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Journey renderer could not recover its WebGL context",
          })
          unavailableRef.current?.("context-lost")
        })
    }
    canvas.addEventListener("webglcontextlost", contextLost)
    canvas.addEventListener("webglcontextrestored", contextRestored)
    return () => {
      window.clearTimeout(recoveryTimer)
      canvas.removeEventListener("webglcontextlost", contextLost)
      canvas.removeEventListener("webglcontextrestored", contextRestored)
    }
  }, [invalidate, renderer, runtimeRef])

  useFrame((_, delta) => {
    runtimeRef.current?.update(delta)
  })

  return null
}

class WorldCanvasErrorBoundary extends React.Component<
  {
    children: React.ReactNode
    onUnavailable?: (reason: JourneyWorldUnavailableReason) => void
  },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error("[Journey] WebGL canvas failed to mount:", error)
    this.props.onUnavailable?.("initialization-failed")
  }

  render() {
    if (this.state.failed) {
      return <div aria-hidden data-journey-v2-world="unavailable" />
    }
    return this.props.children
  }
}

export const WorldCanvas = React.forwardRef<
  WorldCanvasHandle,
  WorldCanvasProps
>(function WorldCanvas(
  {
    enabled = true,
    paused,
    reducedMotion,
    quality = "balanced",
    destinationId = null,
    assistedTravel = false,
    wayfindingLabels = EMPTY_WAYFINDING_LABELS,
    movementRef,
    worldUrl = DEFAULT_WORLD_URL,
    className,
    onReady,
    onEvent,
    onSnapshot,
    onUnavailable,
  },
  forwardedRef
) {
  const runtimeRef = React.useRef<JourneyWorldRuntime | null>(null)
  const [webglAvailable] = React.useState(supportsJourneyWebGL)
  const unavailableReported = React.useRef(false)
  const qualityConfig = JOURNEY_V2_QUALITY[quality]
  const canvasDpr = React.useMemo(
    () =>
      [qualityConfig.minimumDpr, qualityConfig.maximumDpr] as [number, number],
    [qualityConfig.maximumDpr, qualityConfig.minimumDpr]
  )

  React.useImperativeHandle(
    forwardedRef,
    () => ({
      getSnapshot: () => runtimeRef.current?.getSnapshot() ?? null,
      resetPlayer: () => runtimeRef.current?.resetPlayer(),
      requestRender: () => runtimeRef.current?.requestFrame(),
    }),
    []
  )

  React.useEffect(() => {
    if (enabled && !webglAvailable && !unavailableReported.current) {
      unavailableReported.current = true
      onUnavailable?.("webgl-unavailable")
    }
  }, [enabled, onUnavailable, webglAvailable])

  if (!enabled) return null
  if (!webglAvailable) {
    return <div aria-hidden data-journey-v2-world="unavailable" />
  }

  return (
    <WorldCanvasErrorBoundary onUnavailable={onUnavailable}>
      <Canvas
        aria-hidden
        className={className}
        data-journey-v2-world="loading"
        data-journey-v2-quality={quality}
        dpr={canvasDpr}
        frameloop="demand"
        shadows={qualityConfig.shadows}
        camera={{
          fov: 44,
          near: 0.1,
          far: 145,
          position: [8, 7.5, 11],
        }}
        gl={{
          alpha: false,
          antialias: quality === "high",
          depth: true,
          stencil: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 0.96
        }}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <RuntimeBridge
          paused={paused}
          reducedMotion={reducedMotion}
          quality={quality}
          destinationId={destinationId}
          assistedTravel={assistedTravel}
          wayfindingLabels={wayfindingLabels}
          movementRef={movementRef}
          worldUrl={worldUrl}
          runtimeRef={runtimeRef}
          callbacks={{ onReady, onEvent, onSnapshot }}
          onUnavailable={onUnavailable}
        />
      </Canvas>
    </WorldCanvasErrorBoundary>
  )
})

WorldCanvas.displayName = "WorldCanvas"

export type {
  JourneyWorldMovementInput,
  JourneyWorldRuntimeEvent,
  JourneyWorldSnapshot,
  JourneyWorldUnavailableReason,
} from "@/lib/journey-v2/runtime/types"

export default WorldCanvas
