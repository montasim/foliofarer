"use client"

import * as React from "react"
import Link from "next/link"
import { Canvas } from "@react-three/fiber"
import { Physics } from "@react-three/rapier"
import * as THREE from "three"
import {
  IconArrowLeft,
  IconDeviceDesktopExclamation,
} from "@tabler/icons-react"
import { JourneyHud } from "@/components/journey/journey-hud"
import { JourneyScene } from "@/components/journey/journey-scene"
import { useJourneyPassport } from "@/hooks/use-journey-passport"
import { trackJourneyEvent } from "@/lib/journey/analytics"
import {
  frameTimeBucket,
  JOURNEY_RENDER_CONFIG,
  JOURNEY_START_MARK_KEY,
  playableDurationBucket,
} from "@/lib/journey/performance"
import {
  getNextJourneyLandmark,
  getSuggestedJourneyLandmark,
  JOURNEY_LANDMARK_BY_ID,
  JOURNEY_LANDMARKS,
} from "@/lib/journey/manifest"
import { JOURNEY_START_POSITION } from "@/lib/journey/world-layout"
import { buildAssistedRoute } from "@/lib/journey/navigation"
import { PORTFOLIO_URL } from "@/lib/portfolio-url"
import type {
  AssistedRouteState,
  JourneyContactAction,
  JourneyLandmark,
  JourneyLandmarkId,
  JourneyRenderTier,
  MovementInput,
} from "@/lib/journey/types"

const ONBOARDING_KEY = "montasim-journey-onboarding-v1"

declare global {
  interface Window {
    __JOURNEY_RENDER_TIER_OVERRIDE__?: JourneyRenderTier
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas")
    return Boolean(
      (window.WebGL2RenderingContext &&
        canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true })) ||
      (window.WebGLRenderingContext &&
        canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }))
    )
  } catch {
    return false
  }
}

function getClientEnvironment() {
  if (typeof window === "undefined") {
    return {
      webglAvailable: false,
      isTouch: false,
      initialRenderTier: "high" as JourneyRenderTier,
      reducedMotion: false,
      showOnboarding: false,
      journeyStartedAt: 0,
    }
  }

  const isTouch =
    window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches
  const deviceMemory =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  let journeyStartedAt = 0
  let showOnboarding = true
  try {
    const markedAt = Number(
      window.sessionStorage.getItem(JOURNEY_START_MARK_KEY)
    )
    if (Number.isFinite(markedAt) && markedAt >= 0) journeyStartedAt = markedAt
    window.sessionStorage.removeItem(JOURNEY_START_MARK_KEY)
  } catch {
    // Direct navigation timing begins at the current document's time origin.
  }
  try {
    showOnboarding = window.localStorage.getItem(ONBOARDING_KEY) !== "complete"
  } catch {
    // Private browsing may keep onboarding state session-only.
  }

  const initialRenderTier =
    window.__JOURNEY_RENDER_TIER_OVERRIDE__ ??
    (isTouch || navigator.hardwareConcurrency <= 4 || deviceMemory <= 4
      ? "low"
      : "high")

  return {
    webglAvailable: supportsWebGL(),
    isTouch,
    initialRenderTier,
    reducedMotion,
    showOnboarding,
    journeyStartedAt,
  }
}

function JourneyFallback() {
  return (
    <main className="journey-shell fixed inset-0 z-[100] flex items-center justify-center bg-[#bcd3d6] p-5 text-[#173a38]">
      <div className="journey-story-sheet w-full max-w-md p-6 text-center sm:p-8">
        <IconDeviceDesktopExclamation className="mx-auto" size={34} />
        <h1 className="mt-4 font-[family-name:var(--font-journey-display)] text-4xl leading-none font-semibold">
          The 3D journey is unavailable here.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#48615d]">
          This browser could not start WebGL reliably. The standard portfolio
          contains the same professional history in an accessible format.
        </p>
        <Link
          href={PORTFOLIO_URL}
          className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#244b40] px-5 text-sm font-medium text-white transition-colors hover:bg-[#17352f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6f8879]"
        >
          <IconArrowLeft size={17} /> Browse standard portfolio
        </Link>
      </div>
    </main>
  )
}

function JourneyLoading() {
  return (
    <div
      className="journey-shell fixed inset-0 z-[100] flex items-center justify-center bg-[#bcd3d6] text-[#173a38]"
      role="status"
      aria-live="polite"
      aria-label="Drawing the town and preparing your route"
    >
      <div className="text-center">
        <div
          aria-hidden="true"
          className="journey-loader mx-auto size-10 rounded-full border-2 border-[#173a38]/20 border-t-[#c45f3f]"
        />
        <p className="mt-4 font-[family-name:var(--font-journey-display)] text-lg font-semibold tracking-[0.08em] uppercase">
          Drawing the town
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-[#294945] uppercase">
          Preparing your route
        </p>
      </div>
    </div>
  )
}

const JOURNEY_CAMERA = {
  fov: 44,
  near: 0.1,
  far: 110,
  position: [0, 11.04, 19.2] as [number, number, number],
}

interface JourneyCanvasProps {
  activeLandmark: JourneyLandmark
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  assistedRoute: AssistedRouteState
  paused: boolean
  movementRef: React.MutableRefObject<MovementInput>
  cameraYawRef: React.MutableRefObject<number>
  playerPositionRef: React.MutableRefObject<THREE.Vector3>
  renderTier: JourneyRenderTier
  initialAntialias: boolean
  reducedMotion: boolean
  performanceMonitoring: boolean
  onSceneReady: () => void
  onAssistedTravelCancel: () => void
  onAssistedWaypointReached: () => void
  onPositionChange: (x: number, y: number, z: number) => void
  onFrameTime: (p95FrameTimeMs: number) => void
  onRenderTierChange: (
    tier: JourneyRenderTier,
    direction: "upgrade" | "downgrade",
    p95FrameTimeMs: number
  ) => void
}

const JourneyCanvas = React.memo(function JourneyCanvas({
  activeLandmark,
  discoveredIds,
  assistedRoute,
  paused,
  movementRef,
  cameraYawRef,
  playerPositionRef,
  renderTier,
  initialAntialias,
  reducedMotion,
  performanceMonitoring,
  onSceneReady,
  onAssistedTravelCancel,
  onAssistedWaypointReached,
  onPositionChange,
  onFrameTime,
  onRenderTierChange,
}: JourneyCanvasProps) {
  const renderConfig = JOURNEY_RENDER_CONFIG[renderTier]
  const gl = React.useMemo(
    () => ({
      antialias: initialAntialias,
      alpha: false,
      powerPreference: "high-performance" as const,
    }),
    [initialAntialias]
  )

  return (
    <Canvas
      aria-hidden="true"
      shadows={renderConfig.shadows}
      dpr={renderConfig.dpr}
      camera={JOURNEY_CAMERA}
      gl={gl}
    >
      <React.Suspense fallback={null}>
        <Physics gravity={[0, -18, 0]}>
          <JourneyScene
            landmarks={JOURNEY_LANDMARKS}
            activeLandmark={activeLandmark}
            discoveredIds={discoveredIds}
            assistedRoute={assistedRoute}
            paused={paused}
            movementRef={movementRef}
            cameraYawRef={cameraYawRef}
            playerPositionRef={playerPositionRef}
            onAssistedTravelCancel={onAssistedTravelCancel}
            onAssistedWaypointReached={onAssistedWaypointReached}
            onPositionChange={onPositionChange}
            renderTier={renderTier}
            performanceMonitoring={performanceMonitoring}
            onFrameTime={onFrameTime}
            onRenderTierChange={onRenderTierChange}
            onSceneReady={onSceneReady}
            reducedMotion={reducedMotion}
          />
        </Physics>
      </React.Suspense>
    </Canvas>
  )
})

export default function JourneyExperience() {
  const [environment] = React.useState(getClientEnvironment)
  const { webglAvailable, isTouch, initialRenderTier, reducedMotion } =
    environment
  const [renderTier, setRenderTier] =
    React.useState<JourneyRenderTier>(initialRenderTier)
  const { passport, discoveredIds, discover, completeJourney } =
    useJourneyPassport()
  const [sceneReady, setSceneReady] = React.useState(false)
  const [showOnboarding, setShowOnboarding] = React.useState(
    environment.showOnboarding
  )
  const [activeLandmarkId, setActiveLandmarkId] =
    React.useState<JourneyLandmarkId>(() => {
      if (passport.journeyCompleted) return "contact-pavilion"
      const initialDiscoveredIds = new Set(passport.discoveredLandmarkIds)
      const next = getSuggestedJourneyLandmark(
        initialDiscoveredIds,
        JOURNEY_LANDMARKS[0]
      )
      return next?.id ?? "town-square"
    })
  const [storyLandmark, setStoryLandmark] =
    React.useState<JourneyLandmark | null>(null)
  const [assistedRoute, setAssistedRoute] = React.useState<AssistedRouteState>({
    waypoints: [],
    cursor: 0,
  })
  const assistedRouteRef = React.useRef<AssistedRouteState>(assistedRoute)
  const [assistedTravel, setAssistedTravel] = React.useState(false)
  const [playerPosition, setPlayerPosition] = React.useState<{
    x: number
    y: number
    z: number
  }>({
    x: JOURNEY_START_POSITION[0],
    y: JOURNEY_START_POSITION[1],
    z: JOURNEY_START_POSITION[2],
  })
  const movementRef = React.useRef<MovementInput>({ x: 0, z: 0 })
  const cameraYawRef = React.useRef(0)
  const playerPositionRef = React.useRef(
    new THREE.Vector3(...JOURNEY_START_POSITION)
  )
  const readyTimeout = React.useRef<number | null>(null)
  const journeyStartedAt = React.useRef(environment.journeyStartedAt)
  const performanceReported = React.useRef(false)
  const performanceMetrics = React.useRef({
    initialTier: initialRenderTier,
    finalTier: initialRenderTier,
    p95FrameTimeMs: 0,
    firstPlayableMs: 0,
    downgradeCount: 0,
  })

  const activeLandmark = JOURNEY_LANDMARK_BY_ID[activeLandmarkId]
  const suggestedLandmark = passport.journeyCompleted
    ? null
    : getSuggestedJourneyLandmark(discoveredIds, activeLandmark)
  const distance = Math.hypot(
    activeLandmark.position[0] - playerPosition.x,
    activeLandmark.position[2] - playerPosition.z
  )
  const nearbyLandmark =
    JOURNEY_LANDMARKS.find((landmark) => {
      const dx = landmark.position[0] - playerPosition.x
      const dz = landmark.position[2] - playerPosition.z
      const threshold = landmark.id === "town-square" ? 3.1 : 2.25
      return dx * dx + dz * dz <= threshold * threshold
    }) ?? null

  const replaceAssistedRoute = React.useCallback(
    (route: AssistedRouteState) => {
      assistedRouteRef.current = route
      setAssistedRoute(route)
    },
    []
  )

  const cancelAssistedTravel = React.useCallback(() => {
    replaceAssistedRoute({ waypoints: [], cursor: 0 })
    setAssistedTravel(false)
  }, [replaceAssistedRoute])

  const reachAssistedWaypoint = React.useCallback(() => {
    const route = assistedRouteRef.current
    const cursor = route.cursor + 1
    if (cursor >= route.waypoints.length) {
      replaceAssistedRoute({ waypoints: [], cursor: 0 })
      setAssistedTravel(false)
      return
    }
    route.cursor = cursor
  }, [replaceAssistedRoute])

  const updatePlayerPosition = React.useCallback(
    (x: number, y: number, z: number) => {
      setPlayerPosition((current) =>
        current.x === x && current.y === y && current.z === z
          ? current
          : { x, y, z }
      )
    },
    []
  )

  const recordFrameTime = React.useCallback((p95FrameTimeMs: number) => {
    performanceMetrics.current.p95FrameTimeMs = p95FrameTimeMs
  }, [])

  const changeRenderTier = React.useCallback(
    (
      tier: JourneyRenderTier,
      direction: "upgrade" | "downgrade",
      p95FrameTimeMs: number
    ) => {
      performanceMetrics.current.finalTier = tier
      performanceMetrics.current.p95FrameTimeMs = p95FrameTimeMs
      if (direction === "downgrade") {
        performanceMetrics.current.downgradeCount += 1
      }
      setRenderTier(tier)
    },
    []
  )

  const reportPerformance = React.useCallback(() => {
    const metrics = performanceMetrics.current
    if (performanceReported.current || metrics.firstPlayableMs === 0) return
    performanceReported.current = true
    trackJourneyEvent("journey_performance_summary", {
      initial_tier: metrics.initialTier,
      final_tier: metrics.finalTier,
      first_playable: playableDurationBucket(metrics.firstPlayableMs),
      p95_frame_time: frameTimeBucket(metrics.p95FrameTimeMs),
      quality_downgrades: metrics.downgradeCount,
    })
  }, [])

  const markSceneReady = React.useCallback(() => {
    if (readyTimeout.current !== null) return
    const ready = () => {
      performanceMetrics.current.firstPlayableMs =
        performance.now() - journeyStartedAt.current
      setSceneReady(true)
    }
    readyTimeout.current = window.setTimeout(ready, reducedMotion ? 0 : 350)
  }, [reducedMotion])

  React.useEffect(() => {
    document.body.classList.add("journey-active")
    window.addEventListener("pagehide", reportPerformance)
    return () => {
      document.body.classList.remove("journey-active")
      window.removeEventListener("pagehide", reportPerformance)
      if (readyTimeout.current !== null) {
        window.clearTimeout(readyTimeout.current)
      }
      reportPerformance()
    }
  }, [reportPerformance])

  React.useEffect(() => {
    if (!webglAvailable) trackJourneyEvent("journey_webgl_unavailable")
    trackJourneyEvent("journey_started", {
      input: isTouch ? "touch" : "keyboard",
    })
  }, [isTouch, webglAvailable])

  const openStory = React.useCallback(
    (landmark: JourneyLandmark) => {
      movementRef.current = { x: 0, z: 0 }
      cancelAssistedTravel()
      setStoryLandmark(landmark)
      discover(landmark.id)
      trackJourneyEvent("journey_landmark_encountered", {
        landmark_id: landmark.id,
        district: landmark.district,
      })
    },
    [cancelAssistedTravel, discover]
  )

  const closeStory = React.useCallback(() => {
    if (storyLandmark && !passport.journeyCompleted) {
      const completedIds = new Set(discoveredIds)
      completedIds.add(storyLandmark.id)
      setActiveLandmarkId(
        getNextJourneyLandmark(storyLandmark.id, completedIds).id
      )
    }
    setStoryLandmark(null)
  }, [discoveredIds, passport.journeyCompleted, storyLandmark])

  const endGuidedJourney = React.useCallback(() => {
    cancelAssistedTravel()
    completeJourney()
    trackJourneyEvent("journey_completed", {
      discovered_landmarks: discoveredIds.size,
    })
  }, [cancelAssistedTravel, completeJourney, discoveredIds.size])

  const recordContactAction = React.useCallback(
    (action: JourneyContactAction) => {
      trackJourneyEvent("journey_contact_action", {
        action: action.kind.toLocaleLowerCase(),
      })
    },
    []
  )

  const changeDestination = React.useCallback(
    (id: JourneyLandmarkId) => {
      setActiveLandmarkId(id)
      cancelAssistedTravel()
      trackJourneyEvent("journey_destination_changed", {
        landmark_id: id,
      })
    },
    [cancelAssistedTravel]
  )

  const toggleAssistedTravel = React.useCallback(() => {
    if (assistedTravel) {
      cancelAssistedTravel()
      return
    }
    const route = buildAssistedRoute(
      playerPositionRef.current,
      activeLandmark.id
    )
    replaceAssistedRoute({ waypoints: route, cursor: 0 })
    setAssistedTravel(route.length > 0)
    trackJourneyEvent("journey_assisted_travel_started", {
      landmark_id: activeLandmark.id,
      waypoint_count: route.length,
    })
  }, [
    activeLandmark.id,
    assistedTravel,
    cancelAssistedTravel,
    replaceAssistedRoute,
  ])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest(
          '[data-journey-panel], [role="dialog"], input, textarea, select, [contenteditable="true"]'
        )
      ) {
        return
      }
      if (
        event.code === "KeyE" &&
        nearbyLandmark &&
        !storyLandmark &&
        !showOnboarding
      ) {
        event.preventDefault()
        openStory(nearbyLandmark)
      }
      if (event.code === "Escape" && storyLandmark) {
        event.preventDefault()
        closeStory()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeStory, nearbyLandmark, openStory, showOnboarding, storyLandmark])

  if (!webglAvailable) return <JourneyFallback />

  return (
    <main
      data-scene-ready={sceneReady}
      data-render-tier={renderTier}
      data-player-x={playerPosition.x.toFixed(2)}
      data-player-y={playerPosition.y.toFixed(2)}
      data-player-z={playerPosition.z.toFixed(2)}
      className="journey-shell fixed inset-0 z-[100] overflow-hidden bg-[#bcd3d6] text-[#173a38]"
    >
      {!showOnboarding && (
        <>
          <h1 className="sr-only">
            Montasim&apos;s interactive portfolio journey
          </h1>
          <p className="sr-only">
            Use W, A, S, and D or the arrow keys to move. Hold W or S to run.
            Use J and L to turn the camera. Press E near a landmark to explore
            its story. The Journey Map and Passport provide keyboard-accessible
            alternatives to moving through the 3D town.
          </p>
        </>
      )}
      <JourneyCanvas
        activeLandmark={activeLandmark}
        discoveredIds={discoveredIds}
        assistedRoute={assistedRoute}
        paused={Boolean(storyLandmark) || showOnboarding}
        movementRef={movementRef}
        cameraYawRef={cameraYawRef}
        playerPositionRef={playerPositionRef}
        renderTier={renderTier}
        initialAntialias={initialRenderTier !== "low"}
        reducedMotion={reducedMotion}
        performanceMonitoring={sceneReady}
        onSceneReady={markSceneReady}
        onAssistedTravelCancel={cancelAssistedTravel}
        onAssistedWaypointReached={reachAssistedWaypoint}
        onPositionChange={updatePlayerPosition}
        onFrameTime={recordFrameTime}
        onRenderTierChange={changeRenderTier}
      />

      {sceneReady && (
        <JourneyHud
          landmarks={JOURNEY_LANDMARKS}
          activeLandmark={activeLandmark}
          suggestedLandmark={suggestedLandmark}
          discoveredIds={discoveredIds}
          journeyCompleted={passport.journeyCompleted}
          playerPosition={playerPosition}
          distance={distance}
          nearbyLandmark={nearbyLandmark}
          storyLandmark={storyLandmark}
          assistedTravel={assistedTravel}
          showOnboarding={showOnboarding}
          isTouch={isTouch}
          reducedMotion={reducedMotion}
          movementRef={movementRef}
          onDestinationChange={changeDestination}
          onAssistedTravelToggle={toggleAssistedTravel}
          onInteract={() => nearbyLandmark && openStory(nearbyLandmark)}
          onStoryOpen={openStory}
          onStoryClose={closeStory}
          onContactAction={recordContactAction}
          onCompleteJourney={endGuidedJourney}
          onOnboardingComplete={() => {
            try {
              window.localStorage.setItem(ONBOARDING_KEY, "complete")
            } catch {
              // Completion remains available for the current mount.
            }
            setShowOnboarding(false)
          }}
        />
      )}

      {!sceneReady && <JourneyLoading />}
    </main>
  )
}
