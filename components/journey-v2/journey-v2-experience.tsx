"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  IconArrowLeft,
  IconBook2,
  IconDeviceDesktopExclamation,
  IconPlayerPause,
  IconPlayerPlay,
  IconRubberStamp,
} from "@tabler/icons-react"
import { MobileJoystick } from "@/components/journey/mobile-joystick"
import { JourneyV2Atlas } from "@/components/journey-v2/journey-v2-atlas"
import { JourneyV2MiniMap } from "@/components/journey-v2/journey-v2-mini-map"
import { JourneyV2Passport } from "@/components/journey-v2/journey-v2-passport"
import { JourneyV2StoryDialog } from "@/components/journey-v2/journey-v2-story-dialog"
import { JourneyV2WorldAtlas } from "@/components/journey-v2/journey-v2-world-atlas"
import { useJourneyPassport } from "@/hooks/use-journey-passport"
import { trackJourneyEvent } from "@/lib/journey/analytics"
import {
  getSuggestedJourneyLandmark,
  JOURNEY_LANDMARK_BY_ID,
  JOURNEY_LANDMARKS_BY_ROUTE,
} from "@/lib/journey/manifest"
import type {
  JourneyContactAction,
  JourneyLandmark,
  JourneyLandmarkId,
  MovementInput,
} from "@/lib/journey/types"
import type { JourneyV2Quality } from "@/lib/journey-v2/design"
import type {
  JourneyWorldRuntimeEvent,
  JourneyWorldSnapshot,
} from "@/lib/journey-v2/runtime/types"
import {
  EMPTY_JOURNEY_CHECKPOINT_UI_STATE,
  reduceJourneyCheckpointEvent,
  resolveCanonicalJourneyLandmarkId,
} from "@/lib/journey-v2/ui/checkpoint-events"
import { useJourneyV2Environment } from "@/lib/journey-v2/ui/use-journey-v2-accessibility"
import { PORTFOLIO_URL } from "@/lib/portfolio-url"

type JourneyV2Mode = "booting" | "map" | "world"
type JourneyV2Panel = "map" | "passport" | null

const CANONICAL_JOURNEY_LANDMARK_IDS = new Set(
  JOURNEY_LANDMARKS_BY_ROUTE.map((landmark) => landmark.id)
)
const JOURNEY_WAYFINDING_LABELS = Object.freeze(
  Object.fromEntries(
    JOURNEY_LANDMARKS_BY_ROUTE.map((landmark) => [
      landmark.id,
      landmark.shortTitle,
    ])
  ) as Record<string, string>
)

interface WorldCanvasProps {
  paused: boolean
  reducedMotion: boolean
  quality: JourneyV2Quality
  movementRef?: React.MutableRefObject<MovementInput>
  destinationId?: JourneyLandmarkId | null
  assistedTravel?: boolean
  wayfindingLabels?: Readonly<Record<string, string>>
  onReady?: () => void
  onEvent?: (event: JourneyWorldRuntimeEvent) => void
  onSnapshot?: (snapshot: JourneyWorldSnapshot) => void
  onUnavailable?: (
    reason: "webgl-unavailable" | "initialization-failed" | "context-lost"
  ) => void
  className?: string
}

const WorldCanvas = dynamic<WorldCanvasProps>(
  () =>
    import("@/components/journey-v2/world-canvas").then(
      (module) => module.WorldCanvas as React.ComponentType<WorldCanvasProps>
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="absolute inset-0 bg-[var(--journey-sky)]"
        aria-hidden="true"
      />
    ),
  }
)

function JourneyLoadingStatus({
  label,
  centered = false,
}: {
  label: string
  centered?: boolean
}) {
  return (
    <div
      className={
        centered
          ? "absolute inset-0 z-10 grid place-items-center"
          : "pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-20"
      }
    >
      <div role="status" aria-live="polite" className="journey-loading-note">
        <span
          aria-hidden="true"
          className="journey-loader size-3.5 shrink-0 rounded-full border-2 border-[color:var(--journey-ink-soft)] border-t-[color:var(--journey-route)]"
        />
        {label}
      </div>
    </div>
  )
}

function JourneyWorldLoader({ ready }: { ready: boolean }) {
  return (
    <section
      className="journey-world-loader"
      data-visible={!ready}
      aria-hidden={ready || undefined}
      role={ready ? undefined : "status"}
      aria-live={ready ? undefined : "polite"}
      aria-label={ready ? undefined : "Preparing the first journey district"}
    >
      <div className="journey-world-loader-card">
        <span className="journey-world-loader-spinner" aria-hidden="true">
          <span />
        </span>
        <span className="journey-world-loader-copy">
          <span className="journey-world-loader-kicker">
            Loading the 3D journey
          </span>
          <strong>Preparing Town Square</strong>
          <span>World data is loading behind this screen.</span>
        </span>
      </div>
    </section>
  )
}

function WorldChrome({
  landmarks,
  destinationId,
  discoveredIds,
  discoveredCount,
  totalLandmarks,
  playerPosition,
  atlasOpen,
  passportOpen,
  storyOpen,
  onMapOpen,
  onPassportOpen,
}: {
  landmarks: readonly JourneyLandmark[]
  destinationId: JourneyLandmarkId
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  discoveredCount: number
  totalLandmarks: number
  playerPosition: { x: number; z: number } | null
  atlasOpen: boolean
  passportOpen: boolean
  storyOpen: boolean
  onMapOpen: () => void
  onPassportOpen: () => void
}) {
  return (
    <nav
      className="journey-world-instruments"
      aria-label="Journey tools"
      inert={storyOpen ? true : undefined}
      data-story-open={storyOpen}
    >
      <div className="journey-world-left-tools">
        <Link
          href={PORTFOLIO_URL}
          className="journey-world-back"
          aria-label="Return to standard portfolio"
        >
          <IconArrowLeft aria-hidden="true" size={16} />
          <span>Portfolio</span>
        </Link>
        <button
          type="button"
          className="journey-tool-button journey-world-passport-trigger"
          onClick={onPassportOpen}
          aria-label={`Open Passport. ${discoveredCount} of ${totalLandmarks} places stamped`}
          aria-keyshortcuts="P"
          aria-expanded={passportOpen}
          aria-controls="journey-v2-passport-panel"
        >
          <IconRubberStamp aria-hidden="true" size={18} />
          <span>Passport</span>
          <span
            className="font-mono text-[9px] text-[#4f6865]"
            aria-hidden="true"
          >
            {String(discoveredCount).padStart(2, "0")}/
            {String(totalLandmarks).padStart(2, "0")}
          </span>
        </button>
      </div>

      <div className="journey-world-mini-map" data-atlas-open={atlasOpen}>
        <JourneyV2MiniMap
          landmarks={landmarks}
          destinationId={destinationId}
          discoveredIds={discoveredIds}
          playerPosition={playerPosition}
          expanded={atlasOpen}
          onOpen={onMapOpen}
        />
      </div>
    </nav>
  )
}

function WorldPlaceCard({
  nearbyLandmark,
  coarsePointer,
  onReadNearby,
}: {
  nearbyLandmark: JourneyLandmark | null
  coarsePointer: boolean
  onReadNearby: () => void
}) {
  if (!nearbyLandmark) return null

  return (
    <section
      data-journey-place-card
      data-landmark-id={nearbyLandmark.id}
      className={`journey-place-card ${
        coarsePointer ? "journey-place-card--touch" : ""
      }`}
      aria-live="polite"
      aria-atomic="true"
      aria-labelledby="journey-v2-place-card-title"
    >
      <span className="journey-arrival-seal" aria-hidden="true">
        <IconRubberStamp size={15} />
        <span>Arrived</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="journey-kicker">Place reached</p>
        <h2
          id="journey-v2-place-card-title"
          className="mt-1 truncate font-[family-name:var(--font-journey-display)] text-2xl leading-none font-semibold"
        >
          {nearbyLandmark.shortTitle}
        </h2>
        <p className="mt-1 line-clamp-1 text-xs text-[var(--journey-copy)]">
          {nearbyLandmark.story.title}
        </p>
      </div>
      <button
        type="button"
        onClick={onReadNearby}
        className="journey-place-card-action"
      >
        <IconBook2 aria-hidden="true" size={16} />
        Open place card
        <span className="hidden font-mono text-[8px] tracking-[0.1em] uppercase sm:inline">
          · E
        </span>
      </button>
    </section>
  )
}

function WorldRouteControl({
  destination,
  coarsePointer,
  reducedMotion,
  assistedTravel,
  onToggle,
}: {
  destination: JourneyLandmark
  coarsePointer: boolean
  reducedMotion: boolean
  assistedTravel: boolean
  onToggle: () => void
}) {
  return (
    <div
      data-route-destination-id={destination.id}
      className={`journey-route-control ${
        coarsePointer ? "journey-route-control--touch" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={reducedMotion}
        aria-label={`${assistedTravel ? "Stop" : "Follow"} route to ${
          destination.shortTitle
        }`}
        aria-pressed={assistedTravel}
        aria-describedby={
          reducedMotion ? "journey-v2-assisted-motion-note" : undefined
        }
        className="journey-route-chip"
      >
        {assistedTravel ? (
          <IconPlayerPause aria-hidden="true" size={16} />
        ) : (
          <IconPlayerPlay aria-hidden="true" size={16} />
        )}
        <span>{assistedTravel ? "Stop route" : "Follow route"}</span>
      </button>
      {reducedMotion && (
        <span id="journey-v2-assisted-motion-note" className="sr-only">
          Assisted travel is disabled because reduced motion is enabled. Manual
          movement and the Atlas remain available.
        </span>
      )}
    </div>
  )
}

export default function JourneyV2Experience() {
  const rootRef = React.useRef<HTMLElement>(null)
  const movementRef = React.useRef<MovementInput>({ x: 0, z: 0 })
  const fallbackHandledRef = React.useRef(false)
  const startupAttemptedRef = React.useRef(false)
  const worldStartTrackedRef = React.useRef(false)
  const checkpointStateRef = React.useRef(EMPTY_JOURNEY_CHECKPOINT_UI_STATE)
  const environment = useJourneyV2Environment()
  const { passport, discoveredIds, discover, completeJourney } =
    useJourneyPassport()

  const [mode, setMode] = React.useState<JourneyV2Mode>("booting")
  const [openPanel, setOpenPanel] = React.useState<JourneyV2Panel>(null)
  const [sceneReady, setSceneReady] = React.useState(false)
  const quality = environment.quality
  const [assistedTravel, setAssistedTravel] = React.useState(false)
  const [storyLandmark, setStoryLandmark] =
    React.useState<JourneyLandmark | null>(null)
  const [nearbyLandmarkId, setNearbyLandmarkId] =
    React.useState<JourneyLandmarkId | null>(null)
  const [nearestLandmarkId, setNearestLandmarkId] =
    React.useState<JourneyLandmarkId | null>(null)
  const [playerPosition, setPlayerPosition] = React.useState<{
    x: number
    z: number
  } | null>(null)
  const [storyReturnPanel, setStoryReturnPanel] =
    React.useState<JourneyV2Panel>(null)
  const [fallbackMessage, setFallbackMessage] = React.useState<string | null>(
    null
  )
  const [destinationId, setDestinationId] = React.useState<JourneyLandmarkId>(
    () => {
      const restoredDiscoveries = new Set(passport.discoveredLandmarkIds)
      return getSuggestedJourneyLandmark(
        restoredDiscoveries,
        JOURNEY_LANDMARKS_BY_ROUTE[0]
      ).id
    }
  )

  const destination =
    JOURNEY_LANDMARK_BY_ID[destinationId] ?? JOURNEY_LANDMARKS_BY_ROUTE[0]
  const nearbyLandmark = nearbyLandmarkId
    ? JOURNEY_LANDMARK_BY_ID[nearbyLandmarkId]
    : null
  const nearestLandmark = nearestLandmarkId
    ? JOURNEY_LANDMARK_BY_ID[nearestLandmarkId]
    : null
  const discoveredCount = JOURNEY_LANDMARKS_BY_ROUTE.filter((landmark) =>
    discoveredIds.has(landmark.id)
  ).length
  const worldPaused = Boolean(openPanel || storyLandmark)

  const openStory = React.useCallback(
    (landmark: JourneyLandmark) => {
      movementRef.current = { x: 0, z: 0 }
      setAssistedTravel(false)
      setStoryReturnPanel(mode === "world" ? openPanel : null)
      setOpenPanel(null)
      setStoryLandmark(landmark)
    },
    [mode, openPanel]
  )

  const closeStory = React.useCallback(() => {
    setStoryLandmark(null)
    if (mode === "world" && storyReturnPanel) {
      setOpenPanel(storyReturnPanel)
    }
    setStoryReturnPanel(null)
  }, [mode, storyReturnPanel])

  const enterWorld = React.useCallback(() => {
    if (environment.checked && !environment.webglAvailable) {
      setFallbackMessage(
        "3D could not start in this browser. The complete Atlas remains available."
      )
      setMode("map")
      return
    }
    fallbackHandledRef.current = false
    if (rootRef.current) delete rootRef.current.dataset.worldError
    setFallbackMessage(null)
    setOpenPanel(null)
    setSceneReady(false)
    setMode("world")
  }, [environment.checked, environment.webglAvailable])

  const exploreMapFirst = React.useCallback(() => {
    movementRef.current = { x: 0, z: 0 }
    checkpointStateRef.current = EMPTY_JOURNEY_CHECKPOINT_UI_STATE
    setAssistedTravel(false)
    setSceneReady(false)
    setNearbyLandmarkId(null)
    setOpenPanel(null)
    setMode("map")
  }, [])

  const handleUnavailable = React.useCallback(
    (
      reason: "webgl-unavailable" | "initialization-failed" | "context-lost"
    ) => {
      if (fallbackHandledRef.current) return
      fallbackHandledRef.current = true
      movementRef.current = { x: 0, z: 0 }
      checkpointStateRef.current = EMPTY_JOURNEY_CHECKPOINT_UI_STATE
      setAssistedTravel(false)
      setSceneReady(false)
      setNearbyLandmarkId(null)
      setOpenPanel(null)
      setFallbackMessage(
        reason === "webgl-unavailable"
          ? "3D rendering is unavailable here. No professional evidence was lost; the complete Atlas remains open."
          : reason === "context-lost"
            ? "The browser paused the 3D display. You are back in the complete Atlas and can continue without the world."
            : "The 3D world could not finish starting. Continue through the complete Atlas without the renderer."
      )
      setMode("map")
      trackJourneyEvent("journey_webgl_unavailable", { version: "v2", reason })
    },
    []
  )

  const handleSnapshot = React.useCallback((snapshot: JourneyWorldSnapshot) => {
    const root = rootRef.current
    if (!root) return
    root.dataset.playerX = snapshot.x.toFixed(2)
    root.dataset.playerZ = snapshot.z.toFixed(2)
    const nearestLandmarkId = resolveCanonicalJourneyLandmarkId(
      CANONICAL_JOURNEY_LANDMARK_IDS,
      snapshot.nearestLandmarkId
    )
    setNearestLandmarkId((current) =>
      current === nearestLandmarkId ? current : nearestLandmarkId
    )
    setPlayerPosition((current) => {
      if (
        current &&
        Math.abs(current.x - snapshot.x) < 0.01 &&
        Math.abs(current.z - snapshot.z) < 0.01
      ) {
        return current
      }
      return { x: snapshot.x, z: snapshot.z }
    })
  }, [])

  const handleWorldEvent = React.useCallback(
    (event: JourneyWorldRuntimeEvent) => {
      const root = rootRef.current
      if (event.type === "ready") {
        setSceneReady(true)
        return
      }
      if (
        event.type === "nearby-landmark" ||
        event.type === "landmark-left" ||
        event.type === "landmark-arrival"
      ) {
        const transition = reduceJourneyCheckpointEvent(
          checkpointStateRef.current,
          event,
          CANONICAL_JOURNEY_LANDMARK_IDS
        )
        checkpointStateRef.current = transition.state
        setNearbyLandmarkId(transition.state.nearbyLandmarkId)
        if (transition.arrivedLandmarkId) {
          const landmark = JOURNEY_LANDMARK_BY_ID[transition.arrivedLandmarkId]
          discover(transition.arrivedLandmarkId)
          trackJourneyEvent("journey_landmark_encountered", {
            version: "v2",
            landmark_id: transition.arrivedLandmarkId,
            district: landmark.district,
          })
        }
        return
      }
      if (
        event.type === "assisted-complete" ||
        event.type === "assisted-cancelled" ||
        event.type === "assisted-unavailable"
      ) {
        setAssistedTravel(false)
        return
      }
      if (event.type === "performance" && root) {
        root.dataset.drawCalls = String(event.metrics.drawCalls)
        root.dataset.frameTime = event.metrics.p95FrameMs.toFixed(2)
        return
      }
      if (event.type === "context-lost") {
        setSceneReady(false)
        return
      }
      if (event.type === "context-restored") {
        setSceneReady(true)
        return
      }
      if (event.type === "error") {
        if (root) root.dataset.worldError = event.message
        handleUnavailable("initialization-failed")
      }
    },
    [discover, handleUnavailable]
  )

  const changeDestination = React.useCallback((id: JourneyLandmarkId) => {
    if (!JOURNEY_LANDMARK_BY_ID[id]) return
    setAssistedTravel(false)
    setDestinationId(id)
    trackJourneyEvent("journey_destination_changed", {
      version: "v2",
      landmark_id: id,
    })
  }, [])

  const recordContactAction = React.useCallback(
    (action: JourneyContactAction) => {
      trackJourneyEvent("journey_contact_action", {
        version: "v2",
        action: action.kind.toLowerCase(),
      })
    },
    []
  )

  const markJourneyComplete = React.useCallback(() => {
    completeJourney()
    trackJourneyEvent("journey_completed", {
      version: "v2",
      discovered_landmarks: discoveredIds.size,
    })
  }, [completeJourney, discoveredIds.size])

  React.useEffect(() => {
    document.body.classList.add("journey-active")
    return () => document.body.classList.remove("journey-active")
  }, [])

  React.useEffect(() => {
    if (mode !== "world") {
      worldStartTrackedRef.current = false
      return
    }
    if (worldStartTrackedRef.current) return
    worldStartTrackedRef.current = true
    trackJourneyEvent("journey_started", {
      input: environment.coarsePointer ? "touch" : "keyboard",
      version: "v2",
    })
  }, [environment.coarsePointer, mode])

  React.useEffect(() => {
    if (
      mode !== "booting" ||
      startupAttemptedRef.current ||
      !environment.checked
    ) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      startupAttemptedRef.current = true
      if (!environment.webglAvailable) {
        handleUnavailable("webgl-unavailable")
        return
      }

      enterWorld()
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    environment.checked,
    environment.webglAvailable,
    enterWorld,
    handleUnavailable,
    mode,
  ])

  React.useEffect(() => {
    if (mode !== "world") return
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest(
          '[data-journey-panel], input, textarea, select, [contenteditable="true"]'
        )
      ) {
        return
      }
      if (event.code === "KeyE" && nearbyLandmark && !worldPaused) {
        event.preventDefault()
        openStory(nearbyLandmark)
      }
      if (event.code === "KeyM" && !worldPaused) {
        event.preventDefault()
        setOpenPanel("map")
      }
      if (event.code === "KeyP" && !worldPaused) {
        event.preventDefault()
        setOpenPanel("passport")
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [mode, nearbyLandmark, openStory, worldPaused])

  return (
    <main
      ref={rootRef}
      data-journey-v2
      data-journey-mode={mode}
      data-scene-ready={sceneReady}
      data-render-tier={quality}
      data-world-paused={worldPaused}
      data-destination-id={destination.id}
      data-assisted-travel={assistedTravel}
      data-nearby-landmark-id={nearbyLandmark?.id ?? ""}
      data-player-x="0.00"
      data-player-z="0.00"
      aria-busy={mode === "booting" || (mode === "world" && !sceneReady)}
      className="journey-shell journey-v2-shell fixed inset-0 z-[100] overflow-hidden bg-[var(--journey-sky)] text-[var(--journey-ink)]"
    >
      {mode === "booting" && (
        <JourneyLoadingStatus label="Opening the journey world" centered />
      )}

      {mode === "map" && (
        <JourneyV2Atlas
          landmarks={JOURNEY_LANDMARKS_BY_ROUTE}
          destinationId={destinationId}
          discoveredIds={discoveredIds}
          presentation="page"
          worldAvailable={environment.webglAvailable}
          onDestinationChange={changeDestination}
          onStoryOpen={openStory}
          onPassportOpen={() => setOpenPanel("passport")}
          onEnterWorld={enterWorld}
        />
      )}

      {mode === "world" && (
        <>
          <h1 className="sr-only">
            Montasim&apos;s interactive professional journey
          </h1>
          <p className="sr-only">
            Use W, A, S, and D or the arrow keys to move. Hold Shift to run.
            Press E near a landmark to read its place card. Press M for the
            Atlas or P for the Passport. Every chapter is available directly
            from the Atlas without walking.
          </p>
          <WorldCanvas
            className="absolute inset-0"
            paused={worldPaused}
            reducedMotion={environment.reducedMotion}
            quality={quality}
            movementRef={movementRef}
            destinationId={destination.id}
            assistedTravel={assistedTravel}
            wayfindingLabels={JOURNEY_WAYFINDING_LABELS}
            onReady={() => setSceneReady(true)}
            onEvent={handleWorldEvent}
            onSnapshot={handleSnapshot}
            onUnavailable={handleUnavailable}
          />

          <JourneyWorldLoader ready={sceneReady} />

          <WorldChrome
            landmarks={JOURNEY_LANDMARKS_BY_ROUTE}
            destinationId={destinationId}
            discoveredIds={discoveredIds}
            discoveredCount={discoveredCount}
            totalLandmarks={JOURNEY_LANDMARKS_BY_ROUTE.length}
            playerPosition={playerPosition}
            atlasOpen={openPanel === "map"}
            passportOpen={openPanel === "passport"}
            storyOpen={Boolean(storyLandmark)}
            onMapOpen={() =>
              setOpenPanel((current) => (current === "map" ? null : "map"))
            }
            onPassportOpen={() =>
              setOpenPanel((current) =>
                current === "passport" ? null : "passport"
              )
            }
          />

          {sceneReady && environment.coarsePointer && !worldPaused && (
            <MobileJoystick movementRef={movementRef} />
          )}

          {sceneReady && (
            <>
              <WorldPlaceCard
                nearbyLandmark={nearbyLandmark}
                coarsePointer={environment.coarsePointer}
                onReadNearby={() => nearbyLandmark && openStory(nearbyLandmark)}
              />

              <WorldRouteControl
                destination={destination}
                coarsePointer={environment.coarsePointer}
                reducedMotion={environment.reducedMotion}
                assistedTravel={assistedTravel}
                onToggle={() =>
                  setAssistedTravel((current) =>
                    environment.reducedMotion ? false : !current
                  )
                }
              />
            </>
          )}
        </>
      )}

      {fallbackMessage && mode === "map" && (
        <div
          role="status"
          className="absolute right-4 bottom-4 left-4 z-20 mx-auto flex max-w-2xl items-start gap-3 border border-l-4 border-[#143d42]/30 border-l-[#c76343] bg-[#f9f2e4] p-3 text-xs leading-5 text-[#4f6865] shadow-[5px_6px_0_rgba(20,61,66,0.18)]"
        >
          <IconDeviceDesktopExclamation
            aria-hidden="true"
            className="mt-0.5 shrink-0"
            size={18}
          />
          <span className="flex-1">{fallbackMessage}</span>
          <button
            type="button"
            onClick={() => setFallbackMessage(null)}
            className="min-h-8 shrink-0 font-semibold underline decoration-[#c76343] underline-offset-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {openPanel === "map" && mode === "world" && (
        <JourneyV2WorldAtlas
          landmarks={JOURNEY_LANDMARKS_BY_ROUTE}
          destinationId={destinationId}
          discoveredIds={discoveredIds}
          onClose={() => setOpenPanel(null)}
          onDestinationChange={changeDestination}
          onStoryOpen={openStory}
          onOpenCompleteAtlas={exploreMapFirst}
        />
      )}

      {openPanel === "passport" && (
        <JourneyV2Passport
          landmarks={JOURNEY_LANDMARKS_BY_ROUTE}
          discoveredIds={discoveredIds}
          journeyCompleted={passport.journeyCompleted}
          presentation={mode === "world" ? "dock" : "dialog"}
          onClose={() => setOpenPanel(null)}
          onStoryOpen={openStory}
        />
      )}

      {storyLandmark && (
        <JourneyV2StoryDialog
          landmark={storyLandmark}
          journeyCompleted={passport.journeyCompleted}
          presentation={mode === "world" ? "field-sheet" : "dialog"}
          returnLabel={
            mode === "world" ? "Continue journey" : "Return to Atlas"
          }
          onClose={closeStory}
          onSetDestination={(landmark) => {
            changeDestination(landmark.id)
            setStoryLandmark(null)
            setStoryReturnPanel(null)
          }}
          onContactAction={recordContactAction}
          onCompleteJourney={markJourneyComplete}
        />
      )}

      <div className="sr-only" aria-live="polite">
        {nearbyLandmark
          ? `${nearbyLandmark.shortTitle} is nearby.`
          : nearestLandmark
            ? `Nearest landmark: ${nearestLandmark.shortTitle}. Current destination: ${destination.shortTitle}.`
            : `Current destination: ${destination.shortTitle}.`}
        {passport.journeyCompleted ? " Guided chronology complete." : ""}
      </div>
    </main>
  )
}
