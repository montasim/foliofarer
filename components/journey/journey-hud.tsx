"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconBook2,
  IconBrandLinkedin,
  IconCertificate,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconFileText,
  IconLink,
  IconMap2,
  IconMail,
  IconPlayerPause,
  IconRoute,
  IconSearch,
  IconSparkles,
  IconWalk,
  IconX,
} from "@tabler/icons-react"
import { MobileJoystick } from "@/components/journey/mobile-joystick"
import type {
  JourneyContactAction,
  JourneyLandmark,
  JourneyLandmarkId,
  MovementInput,
  WorldPosition,
} from "@/lib/journey/types"
import {
  buildAssistedRoute,
  JOURNEY_MAP_BOUNDS,
} from "@/lib/journey/navigation"
import {
  JOURNEY_ENTRANCE_LAYOUTS,
  JOURNEY_ROAD_CENTERLINE,
} from "@/lib/journey/world-layout"
import { PORTFOLIO_URL } from "@/lib/portfolio-url"

interface MapPosition {
  x: number
  z: number
}

type OpenPanel = "map" | "passport" | null

function toMapPoint(position: WorldPosition | MapPosition) {
  const x = "length" in position ? position[0] : position.x
  const z = "length" in position ? position[2] : position.z
  const normalizedX = Math.max(
    0,
    Math.min(
      1,
      (x - JOURNEY_MAP_BOUNDS.minX) /
        (JOURNEY_MAP_BOUNDS.maxX - JOURNEY_MAP_BOUNDS.minX)
    )
  )
  const normalizedY = Math.max(
    0,
    Math.min(
      1,
      (JOURNEY_MAP_BOUNDS.maxZ - z) /
        (JOURNEY_MAP_BOUNDS.maxZ - JOURNEY_MAP_BOUNDS.minZ)
    )
  )
  return {
    // The left gutter belongs to Start/End labels; the remaining inset keeps
    // marker rings and the route clear of every map edge.
    x: 12 + normalizedX * 82,
    y: 8 + normalizedY * 84,
  }
}

function toMapPosition(position: WorldPosition | MapPosition) {
  const point = toMapPoint(position)
  return { left: `${point.x}%`, top: `${point.y}%` }
}

function buildMapPath(points: readonly (WorldPosition | MapPosition)[]) {
  if (points.length === 0) return ""
  return points
    .map((position, index) => {
      const point = toMapPoint(position)
      return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
    })
    .join(" ")
}

const townMapPath = buildMapPath(JOURNEY_ROAD_CENTERLINE)

function journeyDistanceLabel(distance: number) {
  if (distance < 4.5) return "You are here"
  if (distance < 12) return "Nearby"
  if (distance < 25) return "A short walk"
  return "Further along the journey"
}

function renderEmphasis(text: string) {
  return text.split("**").map((part, index) =>
    index % 2 === 1 ? (
      <strong key={`${part}-${index}`} className="font-semibold text-[#244743]">
        {part}
      </strong>
    ) : (
      part
    )
  )
}

function useDialogFocusTrap(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onClose?: () => void
) {
  const onCloseRef = React.useRef(onClose)
  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open || !ref.current) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener("keydown", onKeyDown)
    return () => {
      dialog.removeEventListener("keydown", onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [open, ref])
}

function JourneyMap({
  landmarks,
  activeLandmarkId,
  suggestedLandmarkId,
  discoveredIds,
  journeyCompleted,
  assistedTravel,
  reducedMotion,
  playerPosition,
  open,
  onOpenChange,
  onSelect,
  onAssistedTravelToggle,
}: {
  landmarks: readonly JourneyLandmark[]
  activeLandmarkId: JourneyLandmarkId
  suggestedLandmarkId: JourneyLandmarkId | null
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  journeyCompleted: boolean
  assistedTravel: boolean
  reducedMotion: boolean
  playerPosition: MapPosition
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: JourneyLandmarkId) => void
  onAssistedTravelToggle: () => void
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const destinationTriggerRef = React.useRef<HTMLButtonElement>(null)
  const destinationOptionRefs = React.useRef<(HTMLButtonElement | null)[]>([])
  const [destinationMenuOpen, setDestinationMenuOpen] = React.useState(false)
  const wasOpen = React.useRef(open)
  React.useEffect(() => {
    if (open && !wasOpen.current) closeRef.current?.focus()
    if (!open && wasOpen.current) {
      triggerRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  const route = React.useMemo(
    () => buildAssistedRoute(playerPosition, activeLandmarkId),
    [activeLandmarkId, playerPosition]
  )
  const routePath =
    route.length > 0 ? buildMapPath([playerPosition, ...route]) : ""
  const activeMapLandmark =
    landmarks.find((landmark) => landmark.id === activeLandmarkId) ??
    landmarks[0]
  const focusDestinationOption = (index: number) => {
    window.requestAnimationFrame(() => {
      destinationOptionRefs.current[index]?.focus()
    })
  }
  const openDestinationMenu = (focusOption: boolean) => {
    setDestinationMenuOpen(true)
    if (!focusOption) return
    const activeIndex = Math.max(
      0,
      landmarks.findIndex((landmark) => landmark.id === activeMapLandmark.id)
    )
    focusDestinationOption(activeIndex)
  }
  const onDestinationOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null
    if (event.key === "ArrowDown") nextIndex = (index + 1) % landmarks.length
    if (event.key === "ArrowUp")
      nextIndex = (index - 1 + landmarks.length) % landmarks.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = landmarks.length - 1
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setDestinationMenuOpen(false)
      destinationTriggerRef.current?.focus()
      return
    }
    if (nextIndex === null) return
    event.preventDefault()
    focusDestinationOption(nextIndex)
  }
  return (
    <div
      data-journey-ui
      className="absolute top-4 right-4 z-30 sm:top-5 sm:right-5"
    >
      {!open && (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded="false"
          aria-controls="journey-map-panel"
          aria-label="Expand Journey map"
          onClick={() => {
            setDestinationMenuOpen(false)
            onOpenChange(true)
          }}
          className="journey-mini-map ml-auto"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="journey-kicker">Journey map</span>
            <IconMap2 size={16} aria-hidden="true" />
          </span>
          <span className="journey-mini-map-plot relative mt-1.5 overflow-hidden border border-[#173a38]/25 bg-[#bdd2cf] sm:mt-2">
            <span className="absolute top-2 left-2 z-10 bg-[#bdd2cf] py-0.5 pr-2 font-mono text-[9px] leading-none tracking-[0.14em] text-[#294945] uppercase">
              Start
            </span>
            <span className="absolute bottom-2 left-2 z-10 bg-[#bdd2cf] py-0.5 pr-2 font-mono text-[9px] leading-none tracking-[0.14em] text-[#294945] uppercase">
              End
            </span>
            <svg
              aria-hidden="true"
              className="absolute inset-0 size-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                d={townMapPath}
                fill="none"
                stroke="#d8d3c0"
                strokeWidth="11"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={townMapPath}
                fill="none"
                stroke="#465754"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={townMapPath}
                fill="none"
                stroke="#eee7cf"
                strokeWidth="1"
                strokeDasharray="2 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {routePath && (
                <path
                  data-journey-route-guide
                  d={routePath}
                  fill="none"
                  stroke="#c45f3f"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {landmarks.map((landmark) => {
              const active = landmark.id === activeLandmarkId
              const suggested =
                !journeyCompleted && landmark.id === suggestedLandmarkId
              const discovered = discoveredIds.has(landmark.id)
              return (
                <span
                  key={landmark.id}
                  aria-hidden="true"
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#f4edcf] shadow-sm ${active ? "size-3.5 bg-[#c45f3f]" : discovered ? "size-3 bg-[#386b58]" : "size-3 bg-[#f4edcf] ring-1 ring-[#386b58]"} ${suggested && !active ? "ring-2 ring-[#c69138] ring-offset-1 ring-offset-[#bdd2cf]" : ""}`}
                  style={toMapPosition(landmark.position)}
                />
              )
            })}
            <span
              aria-hidden="true"
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#f4edcf] bg-[#173a38] shadow-sm"
              style={toMapPosition(playerPosition)}
            />
          </span>
          <span className="mt-1 flex items-center justify-between font-mono text-[8px] tracking-[0.08em] text-[#48615d] uppercase sm:mt-1.5 sm:text-[9px]">
            <span>You</span>
            <span>Open atlas</span>
          </span>
        </button>
      )}
      {open && (
        <section
          data-journey-panel
          id="journey-map-panel"
          role="region"
          aria-label="Journey map"
          className="journey-atlas-panel max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[21rem] overflow-y-auto p-3 sm:w-80 sm:p-4"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#173a38]/18 pb-3">
            <div>
              <h2 className="journey-kicker">Journey map</h2>
              <p className="mt-1 text-xs leading-5 text-[#48615d]">
                Select a marker, then start walking.
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => onOpenChange(false)}
              className="journey-icon-button"
              aria-label="Close journey map"
            >
              <IconX size={16} />
            </button>
          </div>

          <div className="relative mt-3 h-56 overflow-hidden border border-[#173a38]/25 bg-[#bdd2cf]">
            <span className="absolute top-2 left-2 z-10 bg-[#bdd2cf] py-0.5 pr-2 font-mono text-[9px] leading-none tracking-[0.14em] text-[#294945] uppercase">
              Start
            </span>
            <span className="absolute bottom-2 left-2 z-10 bg-[#bdd2cf] py-0.5 pr-2 font-mono text-[9px] leading-none tracking-[0.14em] text-[#294945] uppercase">
              End
            </span>
            <svg
              aria-hidden="true"
              className="absolute inset-0 size-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                d={townMapPath}
                fill="none"
                stroke="#d8d3c0"
                strokeWidth="11"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={townMapPath}
                fill="none"
                stroke="#465754"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={townMapPath}
                fill="none"
                stroke="#eee7cf"
                strokeWidth="1"
                strokeDasharray="2 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {JOURNEY_ENTRANCE_LAYOUTS.map((layout, index) => {
                const sidewalk = toMapPoint(layout.sidewalkAnchorPosition)
                const checkpoint = toMapPoint(layout.checkpointPosition)
                return (
                  <line
                    key={index}
                    x1={sidewalk.x}
                    y1={sidewalk.y}
                    x2={checkpoint.x}
                    y2={checkpoint.y}
                    stroke="#d8d3c0"
                    strokeWidth="4"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}
              {routePath && (
                <path
                  data-journey-route-guide
                  d={routePath}
                  fill="none"
                  stroke="#c45f3f"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {landmarks.map((landmark) => {
              const active = landmark.id === activeLandmarkId
              const suggested =
                !journeyCompleted && landmark.id === suggestedLandmarkId
              const discovered = discoveredIds.has(landmark.id)
              return (
                <button
                  type="button"
                  key={landmark.id}
                  aria-label={`Select ${landmark.shortTitle} on map${active ? ", active destination" : ""}${suggested ? ", suggested next" : ""}${discovered ? ", discovered" : ""}`}
                  aria-current={active ? "location" : undefined}
                  title={landmark.shortTitle}
                  className={`group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#173a38] ${active ? "z-20" : "z-10 hover:z-30 focus-visible:z-30"}`}
                  style={toMapPosition(landmark.position)}
                  onClick={() => onSelect(landmark.id)}
                >
                  <span className="pointer-events-none absolute bottom-[calc(100%-0.2rem)] left-1/2 hidden -translate-x-1/2 border border-[#173a38]/25 bg-[#f4edcf] px-1.5 py-1 font-mono text-[9px] leading-none whitespace-nowrap text-[#173a38] shadow-sm group-hover:block group-focus-visible:block">
                    {landmark.shortTitle}
                  </span>
                  <span
                    className={`block rounded-full border-2 shadow-sm ${
                      active
                        ? "size-4 border-[#f4edcf] bg-[#c45f3f]"
                        : discovered
                          ? "size-3.5 border-[#f4edcf] bg-[#386b58]"
                          : "size-3.5 border-[#386b58] bg-[#f4edcf]"
                    } ${suggested && !active ? "ring-2 ring-[#c69138] ring-offset-2 ring-offset-[#bdd2cf]" : ""}`}
                  />
                </button>
              )
            })}
            <span
              aria-hidden="true"
              className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-[#f4edcf] bg-[#173a38] shadow-sm"
              style={toMapPosition(playerPosition)}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-[#425b56]">
            <span className="flex items-center gap-1.5">
              <i className="size-2.5 rounded-full bg-[#c45f3f]" /> Destination
            </span>
            <span className="flex items-center gap-1.5">
              <i className="size-2.5 rounded-full bg-[#386b58]" /> Discovered
            </span>
            {journeyCompleted ? (
              <span className="flex items-center gap-1.5 text-[#285347]">
                <IconCheck size={13} /> Journey complete
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <i className="size-2.5 rounded-full ring-2 ring-[#c69138]" />{" "}
                Suggested
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <i className="size-2.5 rotate-45 bg-[#173a38]" /> You
            </span>
          </div>

          {activeMapLandmark && (
            <div className="mt-3 border-t border-[#173a38]/18 pt-3">
              <span
                id="journey-map-destination-label"
                className="journey-kicker"
              >
                Walking destination
              </span>
              <div className="mt-1.5 flex gap-2">
                <div
                  className="relative min-w-0 flex-1"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setDestinationMenuOpen(false)
                    }
                  }}
                >
                  <button
                    ref={destinationTriggerRef}
                    id="journey-map-destination"
                    type="button"
                    aria-labelledby="journey-map-destination-label journey-map-destination"
                    aria-haspopup="listbox"
                    aria-expanded={destinationMenuOpen}
                    aria-controls="journey-map-destination-list"
                    onClick={() =>
                      destinationMenuOpen
                        ? setDestinationMenuOpen(false)
                        : openDestinationMenu(false)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && destinationMenuOpen) {
                        event.preventDefault()
                        event.stopPropagation()
                        setDestinationMenuOpen(false)
                        return
                      }
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                        return
                      event.preventDefault()
                      openDestinationMenu(true)
                    }}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 border border-[#173a38]/30 bg-[#f0ead5] px-2.5 text-left text-sm font-medium text-[#173a38] outline-none focus:border-[#173a38]"
                  >
                    <span className="truncate">
                      {activeMapLandmark.shortTitle}
                    </span>
                    <IconChevronDown
                      size={15}
                      aria-hidden="true"
                      className={`shrink-0 transition-transform ${destinationMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {destinationMenuOpen && (
                    <div
                      id="journey-map-destination-list"
                      role="listbox"
                      aria-label="Journey destinations"
                      className="absolute right-0 bottom-full left-0 z-50 mb-1 max-h-48 overflow-y-auto border border-[#173a38]/35 bg-[#f0ead5] p-1 shadow-[4px_5px_0_rgb(23_58_56/18%)]"
                    >
                      {landmarks.map((landmark, index) => {
                        const selected = landmark.id === activeMapLandmark.id
                        return (
                          <button
                            key={landmark.id}
                            ref={(node) => {
                              destinationOptionRefs.current[index] = node
                            }}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              onSelect(landmark.id)
                              setDestinationMenuOpen(false)
                              destinationTriggerRef.current?.focus()
                            }}
                            onKeyDown={(event) =>
                              onDestinationOptionKeyDown(event, index)
                            }
                            className={`flex min-h-10 w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm outline-none hover:bg-[#d9dfd1] focus:bg-[#d9dfd1] ${selected ? "bg-[#d9dfd1] font-semibold" : ""}`}
                          >
                            <span>{landmark.shortTitle}</span>
                            {selected && (
                              <IconCheck size={14} aria-hidden="true" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (reducedMotion) return
                    onAssistedTravelToggle()
                    onOpenChange(false)
                  }}
                  aria-disabled={reducedMotion}
                  aria-label={
                    reducedMotion
                      ? "Auto-walk off: reduced motion is enabled"
                      : assistedTravel
                        ? "Stop walking"
                        : `Walk to ${activeMapLandmark.shortTitle}`
                  }
                  title={
                    reducedMotion
                      ? "Automatic walking is off while reduced motion is enabled"
                      : undefined
                  }
                  className="journey-primary-button min-w-11 px-3"
                >
                  {assistedTravel ? (
                    <IconPlayerPause size={16} aria-hidden="true" />
                  ) : (
                    <IconWalk size={16} aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">
                    {reducedMotion
                      ? "Auto-walk off"
                      : assistedTravel
                        ? "Stop"
                        : "Walk"}
                  </span>
                </button>
              </div>
              <p className="mt-2 font-mono text-[9px] leading-4 text-[#48615d]">
                The map follows the journey&apos;s chronology, not geographic
                distance.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function LandmarkArchiveRow({
  landmark,
  discovered,
  onOpenStory,
}: {
  landmark: JourneyLandmark
  discovered: boolean
  onOpenStory: (landmark: JourneyLandmark) => void
}) {
  return (
    <button
      type="button"
      disabled={!discovered}
      aria-label={`${landmark.shortTitle}, ${discovered ? "discovered story" : "not yet discovered"}`}
      onClick={() => onOpenStory(landmark)}
      className="flex min-h-11 w-full items-center gap-2 border-l-2 border-transparent px-2.5 py-2 text-left text-sm transition-colors enabled:cursor-pointer enabled:hover:border-[#c45f3f] enabled:hover:bg-[#e6e3d4] disabled:text-[#7c8b85]"
    >
      <span
        className={`size-2.5 rounded-full ${discovered ? "bg-[#386b58]" : "border border-[#71817b]"}`}
      />
      <span className="min-w-0 flex-1 truncate">{landmark.shortTitle}</span>
      {discovered && <IconCheck size={15} aria-hidden="true" />}
    </button>
  )
}

function PassportPanel({
  landmarks,
  discoveredIds,
  journeyCompleted,
  open,
  onOpenChange,
  onOpenStory,
}: {
  landmarks: readonly JourneyLandmark[]
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  journeyCompleted: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenStory: (landmark: JourneyLandmark) => void
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const wasOpen = React.useRef(open)
  React.useEffect(() => {
    if (open && !wasOpen.current) closeRef.current?.focus()
    if (!open && wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  const introduction = landmarks.find(
    (landmark) => landmark.district === "about"
  )
  const education = landmarks.filter(
    (landmark) => landmark.district === "education"
  )
  const career = landmarks.filter((landmark) => landmark.district === "career")
  const learning = landmarks.filter(
    (landmark) => landmark.district === "learning"
  )
  const projects = landmarks.filter(
    (landmark) => landmark.district === "projects"
  )
  const community = landmarks.filter(
    (landmark) => landmark.district === "community"
  )
  const contact = landmarks.filter(
    (landmark) => landmark.district === "contact"
  )
  let educationDiscovered = 0
  for (const landmark of education) {
    if (discoveredIds.has(landmark.id)) educationDiscovered += 1
  }
  const educationComplete = educationDiscovered === education.length
  let careerDiscovered = 0
  for (const landmark of career) {
    if (discoveredIds.has(landmark.id)) careerDiscovered += 1
  }
  const careerComplete = career.length > 0 && careerDiscovered === career.length
  let learningDiscovered = 0
  for (const landmark of learning) {
    if (discoveredIds.has(landmark.id)) learningDiscovered += 1
  }
  const learningComplete =
    learning.length > 0 && learningDiscovered === learning.length
  let projectsDiscovered = 0
  for (const landmark of projects) {
    if (discoveredIds.has(landmark.id)) projectsDiscovered += 1
  }
  const projectsComplete =
    projects.length > 0 && projectsDiscovered === projects.length
  let communityDiscovered = 0
  for (const landmark of community) {
    if (discoveredIds.has(landmark.id)) communityDiscovered += 1
  }
  const communityComplete =
    community.length > 0 && communityDiscovered === community.length
  let contactDiscovered = 0
  for (const landmark of contact) {
    if (discoveredIds.has(landmark.id)) contactDiscovered += 1
  }
  return (
    <div
      data-journey-ui
      className="absolute top-4 left-16 z-30 sm:top-5 sm:left-[4.5rem]"
    >
      <button
        ref={triggerRef}
        data-journey-passport-trigger
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="journey-passport-panel"
        aria-label={`Journey passport, ${discoveredIds.size} of ${landmarks.length} stories discovered${journeyCompleted ? ", journey complete" : ""}`}
        className="journey-tool-button"
      >
        <IconBook2 size={18} />
        <span className="hidden sm:inline">Passport</span>
        <span className="font-mono text-[10px] text-[#48615d] sm:text-xs">
          {discoveredIds.size}/{landmarks.length}
        </span>
      </button>
      {open && (
        <section
          data-journey-panel
          id="journey-passport-panel"
          role="region"
          aria-label="Journey passport"
          className="journey-atlas-panel journey-passport-panel mt-[16.5rem] w-[calc(100vw-5rem)] max-w-72 p-3 sm:mt-2 sm:p-4"
        >
          <div className="journey-passport-header flex items-start justify-between border-b border-[#173a38]/18">
            <div>
              <h2 className="journey-kicker">Journey passport</h2>
              <p className="mt-1 text-xs text-[#48615d]">
                {journeyCompleted
                  ? "Guided journey complete. Every district stays open."
                  : "Revisit discovered stories."}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => onOpenChange(false)}
              className="journey-icon-button"
              aria-label="Close journey passport"
            >
              <IconX size={16} />
            </button>
          </div>
          <div className="journey-passport-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mt-2">
              {introduction && (
                <LandmarkArchiveRow
                  landmark={introduction}
                  discovered={discoveredIds.has(introduction.id)}
                  onOpenStory={onOpenStory}
                />
              )}
            </div>
            <div className="mt-2 border-t border-[#173a38]/18 pt-3">
              <div className="flex items-center justify-between gap-2 px-2.5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                  Education chapters
                </p>
                <span className="font-mono text-[10px] text-[#48615d]">
                  {educationDiscovered}/{education.length}
                </span>
              </div>
              <div className="mt-1">
                {education.map((landmark) => (
                  <LandmarkArchiveRow
                    key={landmark.id}
                    landmark={landmark}
                    discovered={discoveredIds.has(landmark.id)}
                    onOpenStory={onOpenStory}
                  />
                ))}
              </div>
              {educationComplete && (
                <p className="mt-2 flex items-center gap-1.5 bg-[#d5e1d3] px-2.5 py-2 text-xs font-medium text-[#285347]">
                  <IconSparkles size={14} /> Education journey complete
                </p>
              )}
            </div>
            <div className="mt-3 border-t border-[#173a38]/18 pt-3">
              <div className="flex items-center justify-between gap-2 px-2.5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                  Career archive
                </p>
                <span className="font-mono text-[10px] text-[#48615d]">
                  {careerDiscovered}/{career.length}
                </span>
              </div>
              <div className="mt-1">
                {career.map((landmark) => (
                  <LandmarkArchiveRow
                    key={landmark.id}
                    landmark={landmark}
                    discovered={discoveredIds.has(landmark.id)}
                    onOpenStory={onOpenStory}
                  />
                ))}
              </div>
              {careerComplete && (
                <p className="mt-2 flex items-center gap-1.5 bg-[#d5e1d3] px-2.5 py-2 text-xs font-medium text-[#285347]">
                  <IconSparkles size={14} /> Career journey complete
                </p>
              )}
            </div>
            <div className="mt-3 border-t border-[#173a38]/18 pt-3">
              <div className="flex items-center justify-between gap-2 px-2.5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                  Learning archive
                </p>
                <span className="font-mono text-[10px] text-[#48615d]">
                  {learningDiscovered}/{learning.length}
                </span>
              </div>
              <div className="mt-1">
                {learning.map((landmark) => (
                  <LandmarkArchiveRow
                    key={landmark.id}
                    landmark={landmark}
                    discovered={discoveredIds.has(landmark.id)}
                    onOpenStory={onOpenStory}
                  />
                ))}
              </div>
              {learningComplete && (
                <p className="mt-2 flex items-center gap-1.5 bg-[#d5e1d3] px-2.5 py-2 text-xs font-medium text-[#285347]">
                  <IconSparkles size={14} /> Learning journey complete
                </p>
              )}
            </div>
            <div className="mt-3 border-t border-[#173a38]/18 pt-3">
              <div className="flex items-center justify-between gap-2 px-2.5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                  Project archive
                </p>
                <span className="font-mono text-[10px] text-[#48615d]">
                  {projectsDiscovered}/{projects.length}
                </span>
              </div>
              <div className="mt-1">
                {projects.map((landmark) => (
                  <LandmarkArchiveRow
                    key={landmark.id}
                    landmark={landmark}
                    discovered={discoveredIds.has(landmark.id)}
                    onOpenStory={onOpenStory}
                  />
                ))}
              </div>
              {projectsComplete && (
                <p className="mt-2 flex items-center gap-1.5 bg-[#d5e1d3] px-2.5 py-2 text-xs font-medium text-[#285347]">
                  <IconSparkles size={14} /> Project journey complete
                </p>
              )}
            </div>
            <div className="mt-3 border-t border-[#173a38]/18 pt-3">
              <div className="flex items-center justify-between gap-2 px-2.5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                  Community archive
                </p>
                <span className="font-mono text-[10px] text-[#48615d]">
                  {communityDiscovered}/{community.length}
                </span>
              </div>
              <div className="mt-1">
                {community.map((landmark) => (
                  <LandmarkArchiveRow
                    key={landmark.id}
                    landmark={landmark}
                    discovered={discoveredIds.has(landmark.id)}
                    onOpenStory={onOpenStory}
                  />
                ))}
              </div>
              {communityComplete && (
                <p className="mt-2 flex items-center gap-1.5 bg-[#d5e1d3] px-2.5 py-2 text-xs font-medium text-[#285347]">
                  <IconSparkles size={14} /> Community journey complete
                </p>
              )}
            </div>
            <div className="mt-3 border-t border-[#173a38]/18 pt-3">
              <div className="flex items-center justify-between gap-2 px-2.5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                  Contact destination
                </p>
                <span className="font-mono text-[10px] text-[#48615d]">
                  {contactDiscovered}/{contact.length}
                </span>
              </div>
              <div className="mt-1">
                {contact.map((landmark) => (
                  <LandmarkArchiveRow
                    key={landmark.id}
                    landmark={landmark}
                    discovered={discoveredIds.has(landmark.id)}
                    onOpenStory={onOpenStory}
                  />
                ))}
              </div>
              {journeyCompleted && (
                <div className="mt-2 bg-[#315d57] px-3 py-3 text-[#f4edcf]">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <IconSparkles size={14} /> Guided journey complete
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-[#dce6dc]">
                    The map, Passport, and every landmark remain available for
                    free exploration.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function LearningArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["learningArchive"]>
}) {
  const [activeRoomId, setActiveRoomId] = React.useState(archive.rooms[0]?.id)
  const [certificationQuery, setCertificationQuery] = React.useState("")
  const activeRoom =
    archive.rooms.find((room) => room.id === activeRoomId) ?? archive.rooms[0]
  const normalizedQuery = certificationQuery.trim().toLocaleLowerCase()
  const filteredCertifications = normalizedQuery
    ? archive.certifications.filter((certification) =>
        [
          certification.title,
          certification.year,
          certification.description,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
      )
    : archive.certifications

  const selectRoomFromKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % archive.rooms.length
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + archive.rooms.length) % archive.rooms.length
    } else if (event.key === "Home") {
      nextIndex = 0
    } else if (event.key === "End") {
      nextIndex = archive.rooms.length - 1
    }
    if (nextIndex === null) return

    event.preventDefault()
    const nextRoom = archive.rooms[nextIndex]
    setActiveRoomId(nextRoom.id)
    document.getElementById(`learning-room-tab-${nextRoom.id}`)?.focus()
  }

  if (!activeRoom) return null

  return (
    <section
      className="mt-6 border-t border-[#173a38]/20 pt-5"
      aria-labelledby="journey-learning-archive-title"
    >
      <p className="journey-kicker">{archive.eyebrow}</p>
      <div className="mt-2 sm:flex sm:items-end sm:justify-between sm:gap-6">
        <h3
          id="journey-learning-archive-title"
          className="font-[family-name:var(--font-journey-display)] text-2xl font-semibold tracking-[-0.01em]"
        >
          {archive.title}
        </h3>
        <p className="mt-1 max-w-md text-xs leading-5 text-[#48615d] sm:mt-0 sm:text-right">
          {archive.description}
        </p>
      </div>

      <div
        className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3"
        role="tablist"
        aria-label="Technology rooms"
      >
        {archive.rooms.map((room, index) => {
          const selected = room.id === activeRoom.id
          return (
            <button
              key={room.id}
              type="button"
              role="tab"
              id={`learning-room-tab-${room.id}`}
              aria-controls={`learning-room-panel-${room.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveRoomId(room.id)}
              onKeyDown={(event) => selectRoomFromKeyboard(event, index)}
              style={
                selected
                  ? {
                      backgroundColor: "#315d57",
                      borderColor: "#315d57",
                      color: "#f4edcf",
                    }
                  : undefined
              }
              className={`min-h-11 border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#173a38] ${
                selected
                  ? "border-[#315d57] bg-[#315d57] text-[#f4edcf]"
                  : "border-[#315d57]/20 bg-[#e5e2d2] text-[#315d57] hover:bg-[#d6ded2]"
              }`}
            >
              <span className="mr-1 font-mono text-[9px] opacity-65">
                {String(index + 1).padStart(2, "0")}
              </span>
              {room.title}
            </button>
          )
        })}
      </div>

      <div
        id={`learning-room-panel-${activeRoom.id}`}
        role="tabpanel"
        aria-labelledby={`learning-room-tab-${activeRoom.id}`}
        tabIndex={0}
        className="mt-3 border border-[#173a38]/18 bg-[#e5e2d2] p-4"
      >
        <div className="sm:flex sm:items-start sm:justify-between sm:gap-5">
          <div>
            <p className="font-mono text-[9px] tracking-[0.12em] text-[#7c4f3f] uppercase">
              Room · {activeRoom.title}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#435d57]">
              {activeRoom.summary}
            </p>
          </div>
          <span className="mt-2 inline-block font-mono text-[9px] whitespace-nowrap text-[#48615d] sm:mt-0">
            {activeRoom.evidence.length} applied records
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Technologies">
          {activeRoom.technologies.map((technology) => (
            <span
              key={technology}
              className="border border-[#315d57]/20 bg-[#d6ded2] px-2 py-1 font-mono text-[9px] text-[#315d57]"
            >
              {technology}
            </span>
          ))}
        </div>

        <div className="mt-4 border-t border-[#173a38]/15 pt-3">
          <p className="journey-kicker">Used in practice</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {activeRoom.evidence.map((evidence) => (
              <li
                key={`${activeRoom.id}-${evidence.recordId}`}
                className="border-l-2 border-[#c45f3f] bg-[#dce2d6] px-3 py-2.5"
              >
                <p className="font-mono text-[9px] tracking-[0.1em] text-[#7c4f3f] uppercase">
                  {evidence.kind}
                </p>
                <p className="mt-1 text-xs leading-5 font-semibold text-[#244743]">
                  {evidence.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[#48615d]">
                  {evidence.detail}
                </p>
                <p className="mt-1.5 font-mono text-[9px] text-[#315d57]">
                  {evidence.technologies.join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 border-t border-[#173a38]/20 pt-4">
        <div className="sm:flex sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="journey-kicker">Certification shelves</p>
            <p
              className="mt-1 text-xs text-[#48615d]"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {filteredCertifications.length} of {archive.certifications.length}{" "}
              records
            </p>
          </div>
          <label className="relative mt-3 block sm:mt-0 sm:w-72">
            <span className="sr-only">Search certifications</span>
            <IconSearch
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#48615d]"
            />
            <input
              type="search"
              value={certificationQuery}
              onChange={(event) => setCertificationQuery(event.target.value)}
              placeholder="Search certifications"
              className="h-11 w-full border border-[#315d57]/30 bg-[#f0ecda] pr-3 pl-9 text-sm text-[#244743] outline-none placeholder:text-[#48615d] focus:border-[#315d57] focus:ring-1 focus:ring-[#315d57]"
            />
          </label>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {filteredCertifications.map((certification) => (
            <li
              key={certification.recordId}
              className="flex min-h-20 items-start gap-3 border border-[#173a38]/18 bg-[#e5e2d2] p-3"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center bg-[#d6ded2] text-[#315d57]">
                <IconCertificate size={17} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9px] text-[#7c4f3f]">
                  {certification.year}
                </p>
                <p className="mt-0.5 text-xs leading-5 font-semibold text-[#244743]">
                  {certification.title}
                </p>
                {certification.description && (
                  <p className="text-[11px] text-[#48615d]">
                    {certification.description}
                  </p>
                )}
                {certification.url ? (
                  <a
                    href={certification.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex min-h-11 items-center gap-1 text-[10px] font-medium text-[#315d57] underline decoration-[#c45f3f] underline-offset-2"
                  >
                    View credential
                    <IconExternalLink size={11} aria-hidden="true" />
                  </a>
                ) : (
                  <p className="mt-1.5 font-mono text-[9px] text-[#48615d]">
                    Archive record
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {filteredCertifications.length === 0 && (
          <p className="mt-3 border border-dashed border-[#315d57]/30 px-3 py-5 text-center text-xs text-[#48615d]">
            No certification records match “{certificationQuery}”.
          </p>
        )}
      </div>
    </section>
  )
}

function ProjectArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["projectArchive"]>
}) {
  const [activeExhibitId, setActiveExhibitId] = React.useState(
    archive.featured[0]?.recordId
  )
  const [projectQuery, setProjectQuery] = React.useState("")
  const activeExhibit =
    archive.featured.find((exhibit) => exhibit.recordId === activeExhibitId) ??
    archive.featured[0]
  const normalizedQuery = projectQuery.trim().toLocaleLowerCase()
  const filteredProjects = normalizedQuery
    ? archive.records.filter((project) =>
        [project.title, project.description, ...project.technologies].some(
          (value) => value.toLocaleLowerCase().includes(normalizedQuery)
        )
      )
    : archive.records
  const featuredIds = React.useMemo(
    () => new Set(archive.featured.map((exhibit) => exhibit.recordId)),
    [archive.featured]
  )

  const selectExhibitFromKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % archive.featured.length
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + archive.featured.length) % archive.featured.length
    } else if (event.key === "Home") {
      nextIndex = 0
    } else if (event.key === "End") {
      nextIndex = archive.featured.length - 1
    }
    if (nextIndex === null) return

    event.preventDefault()
    const nextExhibit = archive.featured[nextIndex]
    setActiveExhibitId(nextExhibit.recordId)
    document
      .getElementById(`project-exhibit-tab-${nextExhibit.recordId}`)
      ?.focus()
  }

  if (!activeExhibit) return null

  const hasLiveLink = activeExhibit.links.some((link) => link.kind === "Live")
  const hasSourceLink = activeExhibit.links.some(
    (link) => link.kind === "Source"
  )

  return (
    <section
      className="mt-6 border-t border-[#173a38]/20 pt-5"
      aria-labelledby="journey-project-archive-title"
    >
      <p className="journey-kicker">{archive.eyebrow}</p>
      <div className="mt-2 sm:flex sm:items-end sm:justify-between sm:gap-6">
        <h3
          id="journey-project-archive-title"
          className="font-[family-name:var(--font-journey-display)] text-2xl font-semibold tracking-[-0.01em]"
        >
          {archive.title}
        </h3>
        <p className="mt-1 max-w-md text-xs leading-5 text-[#48615d] sm:mt-0 sm:text-right">
          {archive.description}
        </p>
      </div>

      <div
        className="journey-archive-scrollbar mt-4 flex snap-x gap-1.5 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Featured project exhibits"
      >
        {archive.featured.map((exhibit, index) => {
          const selected = exhibit.recordId === activeExhibit.recordId
          return (
            <button
              key={exhibit.recordId}
              type="button"
              role="tab"
              id={`project-exhibit-tab-${exhibit.recordId}`}
              aria-controls={`project-exhibit-panel-${exhibit.recordId}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveExhibitId(exhibit.recordId)}
              onKeyDown={(event) => selectExhibitFromKeyboard(event, index)}
              style={
                selected
                  ? {
                      backgroundColor: "#315d57",
                      borderColor: "#315d57",
                      color: "#f4edcf",
                    }
                  : undefined
              }
              className={`min-h-11 min-w-36 snap-start border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#173a38] md:min-w-0 md:flex-1 ${
                selected
                  ? "border-[#315d57] bg-[#315d57] text-[#f4edcf]"
                  : "border-[#315d57]/20 bg-[#e5e2d2] text-[#315d57] hover:bg-[#d6ded2]"
              }`}
            >
              <span className="mr-1 font-mono text-[9px] opacity-65">
                Exhibit {String(index + 1).padStart(2, "0")}
              </span>
              <span className="mt-0.5 block">{exhibit.shortTitle}</span>
            </button>
          )
        })}
      </div>

      <article
        id={`project-exhibit-panel-${activeExhibit.recordId}`}
        role="tabpanel"
        aria-labelledby={`project-exhibit-tab-${activeExhibit.recordId}`}
        tabIndex={0}
        className="mt-3 border border-[#173a38]/18 bg-[#e5e2d2] p-4 sm:p-5"
      >
        <div className="border-l-4 border-[#c45f3f] pl-3">
          <p className="font-mono text-[9px] tracking-[0.12em] text-[#7c4f3f] uppercase">
            Working exhibit
          </p>
          <h4 className="mt-1 text-lg leading-tight font-semibold text-[#244743]">
            {activeExhibit.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-[#435d57]">
            {renderEmphasis(activeExhibit.description)}
          </p>
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            ["Problem", activeExhibit.problem],
            ["Solution", activeExhibit.solution],
            ["Outcome", activeExhibit.outcome],
          ].map(([label, value]) => (
            <div
              key={label}
              className="border-t-2 border-[#315d57] bg-[#dce2d6] p-3"
            >
              <dt className="font-mono text-[9px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                {label}
              </dt>
              <dd className="mt-1.5 text-xs leading-5 text-[#435d57]">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Technologies">
          {activeExhibit.technologies.map((technology) => (
            <span
              key={technology}
              className="border border-[#315d57]/20 bg-[#d6ded2] px-2 py-1 font-mono text-[9px] text-[#315d57]"
            >
              {technology}
            </span>
          ))}
        </div>

        {activeExhibit.connections.length > 0 && (
          <div className="mt-4 border-t border-[#173a38]/15 pt-3">
            <p className="journey-kicker">Connected evidence</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {activeExhibit.connections.map((connection) => (
                <li
                  key={`${connection.kind}-${connection.recordId}`}
                  className="border border-[#315d57]/20 bg-[#f0ecda] px-2.5 py-1.5 text-[10px] text-[#315d57]"
                >
                  <span className="font-mono text-[8px] tracking-[0.08em] text-[#7c4f3f] uppercase">
                    {connection.kind}
                  </span>{" "}
                  · {connection.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#173a38]/15 pt-3">
          {activeExhibit.links.map((link) => (
            <a
              key={`${activeExhibit.recordId}-${link.kind}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="journey-primary-button"
            >
              {link.label} <IconExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
          {!hasLiveLink && (
            <span className="font-mono text-[9px] text-[#48615d]">
              Live view unavailable
            </span>
          )}
          {!hasSourceLink && (
            <span className="font-mono text-[9px] text-[#48615d]">
              Source private or unavailable
            </span>
          )}
        </div>
      </article>

      <section
        className="mt-5 border-t border-[#173a38]/20 pt-4"
        aria-label="Project archive"
      >
        <div className="sm:flex sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="journey-kicker">Complete workshop archive</p>
            <p
              className="mt-1 text-xs text-[#48615d]"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {filteredProjects.length} of {archive.records.length} records
            </p>
          </div>
          <label className="relative mt-3 block sm:mt-0 sm:w-72">
            <span className="sr-only">Search projects</span>
            <IconSearch
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#48615d]"
            />
            <input
              type="search"
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
              placeholder="Search projects or technology"
              className="h-11 w-full border border-[#315d57]/30 bg-[#f0ecda] pr-3 pl-9 text-sm text-[#244743] outline-none placeholder:text-[#48615d] focus:border-[#315d57] focus:ring-1 focus:ring-[#315d57]"
            />
          </label>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {filteredProjects.map((project) => (
            <li
              key={project.recordId}
              className="border border-[#173a38]/18 bg-[#e5e2d2] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-xs leading-5 font-semibold text-[#244743]">
                  {project.title}
                </h4>
                {featuredIds.has(project.recordId) && (
                  <span className="shrink-0 bg-[#d7c177] px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-[#4b4937] uppercase">
                    Featured
                  </span>
                )}
              </div>
              <p className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-[#48615d]">
                {renderEmphasis(project.description)}
              </p>
              <p className="mt-2 font-mono text-[9px] leading-4 text-[#315d57]">
                {project.technologies.slice(0, 5).join(" · ")}
              </p>
              {project.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {project.links.map((link) => (
                    <a
                      key={`${project.recordId}-${link.kind}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-[10px] font-medium text-[#315d57] underline decoration-[#c45f3f] underline-offset-2"
                    >
                      {link.kind}
                      <IconExternalLink size={10} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {filteredProjects.length === 0 && (
          <p className="mt-3 border border-dashed border-[#315d57]/30 px-3 py-5 text-center text-xs text-[#48615d]">
            No project records match “{projectQuery}”.
          </p>
        )}
      </section>
    </section>
  )
}

function CommunityArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["communityArchive"]>
}) {
  const groupColors = ["#315d57", "#b65f47", "#b5964f"] as const

  return (
    <section
      className="mt-6 border-t border-[#173a38]/20 pt-5"
      aria-labelledby="journey-community-archive-title"
    >
      <p className="journey-kicker">{archive.eyebrow}</p>
      <div className="mt-2 sm:flex sm:items-end sm:justify-between sm:gap-6">
        <h3
          id="journey-community-archive-title"
          className="font-[family-name:var(--font-journey-display)] text-2xl font-semibold tracking-[-0.01em]"
        >
          {archive.title}
        </h3>
        <p className="mt-1 max-w-md text-xs leading-5 text-[#48615d] sm:mt-0 sm:text-right">
          {archive.description}
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {archive.groups.map((group, groupIndex) => (
          <section
            key={group.kind}
            className="border border-[#173a38]/18 bg-[#e5e2d2] p-4"
            aria-labelledby={`community-group-${groupIndex}`}
          >
            <div
              className="border-l-4 pl-3"
              style={{ borderColor: groupColors[groupIndex] }}
            >
              <h4
                id={`community-group-${groupIndex}`}
                className="text-base font-semibold text-[#244743]"
              >
                {group.kind}
              </h4>
              <p className="mt-1 text-xs leading-5 text-[#48615d]">
                {group.summary}
              </p>
            </div>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.entries.map((entry) => (
                <li key={entry.recordId} className="bg-[#dce2d6] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div>
                      <p className="text-sm leading-5 font-semibold text-[#244743]">
                        {entry.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#48615d]">
                        {entry.role}
                      </p>
                    </div>
                    <span className="font-mono text-[9px] text-[#7c4f3f]">
                      {entry.period}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#435d57]">
                    {renderEmphasis(entry.description)}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 border-t border-[#173a38]/15 pt-2 font-mono text-[9px] text-[#315d57]">
                    <IconLink size={12} aria-hidden="true" /> Education Story
                    Link · {entry.linkedLandmarkTitle}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}

function ConversationPanel({
  conversation,
  journeyCompleted,
  onContactAction,
  onCompleteJourney,
  onContinueExploring,
}: {
  conversation: NonNullable<JourneyLandmark["story"]["conversation"]>
  journeyCompleted: boolean
  onContactAction: (action: JourneyContactAction) => void
  onCompleteJourney: () => void
  onContinueExploring: () => void
}) {
  const completionActionRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (journeyCompleted) completionActionRef.current?.focus()
  }, [journeyCompleted])

  const iconFor = (kind: JourneyContactAction["kind"]) => {
    if (kind === "Email") return <IconMail size={18} aria-hidden="true" />
    if (kind === "LinkedIn")
      return <IconBrandLinkedin size={18} aria-hidden="true" />
    return <IconFileText size={18} aria-hidden="true" />
  }

  return (
    <section
      className="mt-6 border-t border-[#173a38]/20 pt-5"
      aria-labelledby="journey-conversation-title"
    >
      <p className="journey-kicker">{conversation.eyebrow}</p>
      <div className="mt-2 sm:flex sm:items-end sm:justify-between sm:gap-6">
        <h3
          id="journey-conversation-title"
          className="font-[family-name:var(--font-journey-display)] text-3xl font-semibold tracking-[-0.01em]"
        >
          {conversation.title}
        </h3>
        <p className="mt-2 max-w-sm text-xs leading-5 text-[#48615d] sm:mt-0 sm:text-right">
          {conversation.description}
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {conversation.actions.map((action) => (
          <a
            key={action.kind}
            href={action.url}
            target={action.kind === "Email" ? undefined : "_blank"}
            rel={action.kind === "Email" ? undefined : "noreferrer"}
            onClick={() => onContactAction(action)}
            className={`group flex min-h-20 items-center gap-3 border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173a38] ${
              action.primary
                ? "border-[#315d57] bg-[#315d57] text-[#f4edcf] sm:col-span-2"
                : "border-[#315d57]/25 bg-[#e5e2d2] text-[#244743] hover:bg-[#d6ded2]"
            }`}
          >
            <span
              className={`flex size-10 shrink-0 items-center justify-center ${action.primary ? "bg-[#f4edcf] text-[#315d57]" : "bg-[#315d57] text-[#f4edcf]"}`}
            >
              {iconFor(action.kind)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {action.label}
                {action.kind !== "Email" && (
                  <IconExternalLink size={13} aria-hidden="true" />
                )}
              </span>
              <span
                className={`mt-1 block truncate text-[11px] ${action.primary ? "text-[#dce6dc]" : "text-[#48615d]"}`}
              >
                {action.detail}
              </span>
            </span>
          </a>
        ))}
      </div>

      {journeyCompleted ? (
        <div
          className="mt-4 border-l-4 border-[#d0b56e] bg-[#315d57] p-4 text-[#f4edcf] sm:flex sm:items-center sm:justify-between sm:gap-5"
          role="status"
          aria-live="polite"
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <IconCheck size={17} aria-hidden="true" /> Guided journey complete
            </p>
            <p className="mt-1 text-xs leading-5 text-[#dce6dc]">
              You reached the final chapter. Your discoveries remain in the
              Passport, and the full town stays open for free exploration.
            </p>
          </div>
          <button
            ref={completionActionRef}
            type="button"
            onClick={onContinueExploring}
            className="mt-3 min-h-11 shrink-0 bg-[#f4edcf] px-4 py-2.5 text-sm font-semibold text-[#315d57] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4edcf] sm:mt-0"
          >
            Continue exploring
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCompleteJourney}
          className="mt-4 min-h-11 w-full border border-[#315d57]/35 bg-transparent px-4 py-2.5 text-sm font-semibold text-[#315d57] transition-colors hover:bg-[#d6ded2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173a38]"
        >
          End guided journey
        </button>
      )}
    </section>
  )
}

export function StoryCard({
  landmark,
  onClose,
  journeyCompleted,
  onContactAction,
  onCompleteJourney,
}: {
  landmark: JourneyLandmark
  onClose: () => void
  journeyCompleted: boolean
  onContactAction: (action: JourneyContactAction) => void
  onCompleteJourney: () => void
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  useDialogFocusTrap(true, dialogRef, onClose)
  return (
    <div
      ref={dialogRef}
      data-journey-ui
      className="absolute inset-0 z-40 flex items-end justify-center bg-[#102f2c]/48 p-3 backdrop-blur-[3px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="journey-story-title"
    >
      <article
        className={`journey-story-sheet relative max-h-[88dvh] w-full overflow-y-auto p-5 text-[#173a38] select-text sm:p-7 ${landmark.story.archive || landmark.story.learningArchive || landmark.story.projectArchive || landmark.story.communityArchive || landmark.story.conversation ? "max-w-3xl" : "max-w-xl"}`}
      >
        <button
          type="button"
          onClick={onClose}
          className="journey-icon-button absolute top-4 right-4"
          aria-label="Close story"
        >
          <IconX size={18} />
        </button>
        <p className="journey-kicker pr-12">{landmark.story.eyebrow}</p>
        <h2
          id="journey-story-title"
          className="mt-3 max-w-md font-[family-name:var(--font-journey-display)] text-4xl leading-[0.92] font-semibold tracking-[-0.02em] text-balance sm:text-5xl"
        >
          {landmark.story.title}
        </h2>
        <p className="mt-5 text-sm leading-6 text-[#3e5853] sm:text-base sm:leading-7">
          {landmark.story.body}
        </p>
        <div className="mt-5 grid gap-2 border-t border-[#173a38]/20 pt-4 sm:grid-cols-2">
          {landmark.story.facts.map((fact, index) => (
            <p
              key={fact}
              className={`border-l-2 border-[#c45f3f] bg-[#e3e4d5] px-3 py-2 text-xs leading-relaxed text-[#435d57] ${index === 0 ? "sm:col-span-2" : ""}`}
            >
              {fact}
            </p>
          ))}
        </div>
        {landmark.story.connections &&
          landmark.story.connections.length > 0 && (
            <div className="mt-5 border-t border-[#173a38]/20 pt-4">
              <p className="journey-kicker">Connected community work</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {landmark.story.connections.map((connection) => (
                  <div
                    key={connection.recordId}
                    className="border border-[#173a38]/18 bg-[#e5e2d2] px-3 py-2.5"
                  >
                    <p className="font-mono text-[9px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                      {connection.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#244743]">
                      {connection.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#48615d]">
                      {connection.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        {landmark.story.archive && (
          <section
            className="mt-6 border-t border-[#173a38]/20 pt-5"
            aria-labelledby="journey-archive-title"
          >
            <p className="journey-kicker">{landmark.story.archive.eyebrow}</p>
            <div className="mt-2 sm:flex sm:items-end sm:justify-between sm:gap-6">
              <h3
                id="journey-archive-title"
                className="font-[family-name:var(--font-journey-display)] text-2xl font-semibold tracking-[-0.01em]"
              >
                {landmark.story.archive.title}
              </h3>
              <p className="mt-1 max-w-md text-xs leading-5 text-[#48615d] sm:mt-0 sm:text-right">
                {landmark.story.archive.description}
              </p>
            </div>
            <ol className="mt-4 space-y-3">
              {landmark.story.archive.entries.map((entry, index) => (
                <li
                  key={entry.recordId}
                  className="relative border border-[#173a38]/18 bg-[#e5e2d2] p-4 sm:grid sm:grid-cols-[8.5rem_1fr] sm:gap-5"
                >
                  <div>
                    <p className="font-mono text-[9px] tracking-[0.12em] text-[#7c4f3f] uppercase">
                      Role {index + 1} · {entry.period}
                    </p>
                    <span className="mt-2 hidden h-px w-10 bg-[#c45f3f] sm:block" />
                  </div>
                  <div className="mt-2 sm:mt-0">
                    <h4 className="text-base font-semibold text-[#244743]">
                      {entry.title}
                    </h4>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#48615d]">
                      {entry.subtitle}
                    </p>
                    <p className="mt-3 font-mono text-[9px] tracking-[0.1em] text-[#7c4f3f] uppercase">
                      Responsibilities &amp; achievements
                    </p>
                    <p className="mt-1.5 text-sm leading-6 text-[#435d57]">
                      {renderEmphasis(entry.body)}
                    </p>
                    <div
                      className="mt-3 flex flex-wrap gap-1.5"
                      aria-label="Technologies used"
                    >
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="border border-[#315d57]/20 bg-[#d6ded2] px-2 py-1 font-mono text-[9px] text-[#315d57]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        {landmark.story.learningArchive && (
          <LearningArchive archive={landmark.story.learningArchive} />
        )}
        {landmark.story.projectArchive && (
          <ProjectArchive archive={landmark.story.projectArchive} />
        )}
        {landmark.story.communityArchive && (
          <CommunityArchive archive={landmark.story.communityArchive} />
        )}
        {landmark.story.conversation && (
          <ConversationPanel
            conversation={landmark.story.conversation}
            journeyCompleted={journeyCompleted}
            onContactAction={onContactAction}
            onCompleteJourney={onCompleteJourney}
            onContinueExploring={onClose}
          />
        )}
        {(!journeyCompleted || !landmark.story.conversation) && (
          <button
            type="button"
            onClick={onClose}
            className="journey-primary-button mt-5"
          >
            Continue walking
          </button>
        )}
      </article>
    </div>
  )
}

export function JourneyOnboarding({
  onComplete,
  isTouch,
}: {
  onComplete: () => void
  isTouch: boolean
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  useDialogFocusTrap(true, dialogRef)
  return (
    <div
      ref={dialogRef}
      data-journey-ui
      className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#102f2c]/55 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="journey-welcome-title"
    >
      <div className="journey-story-sheet my-auto w-full max-w-lg p-5 text-[#173a38] sm:p-8">
        <p className="journey-kicker">A walk through Bangladesh and beyond</p>
        <h1
          id="journey-welcome-title"
          className="mt-3 font-[family-name:var(--font-journey-display)] text-5xl leading-[0.9] font-semibold tracking-[-0.025em] sm:text-6xl"
        >
          Follow the road through my journey.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#48615d] sm:text-base">
          The laterite line marks the chronological route. Walk it in order, or
          open the Journey Map and choose any chapter.
        </p>
        <div className="mt-6 grid border-y border-[#173a38]/20 sm:grid-cols-3 sm:divide-x sm:divide-[#173a38]/20">
          <div className="p-3">
            <IconWalk size={20} />
            <p className="mt-2 text-sm font-medium">Move</p>
            <p className="mt-1 text-xs leading-relaxed text-[#48615d]">
              {isTouch
                ? "Use the joystick in the lower-left corner."
                : "Use WASD or the arrow keys. Hold W/S to run."}
            </p>
          </div>
          <div className="border-t border-[#173a38]/20 p-3 sm:border-t-0">
            <IconRoute size={20} />
            <p className="mt-2 text-sm font-medium">Look around</p>
            <p className="mt-1 text-xs leading-relaxed text-[#48615d]">
              Drag the town or use J/L to turn the camera.
            </p>
          </div>
          <div className="border-t border-[#173a38]/20 p-3 sm:border-t-0">
            <IconMap2 size={20} />
            <p className="mt-2 text-sm font-medium">Choose</p>
            <p className="mt-1 text-xs leading-relaxed text-[#48615d]">
              Use the map to change destination.
            </p>
          </div>
        </div>
        <button
          type="button"
          autoFocus
          onClick={onComplete}
          className="journey-primary-button mt-6 w-full"
        >
          Step into the town
        </button>
      </div>
    </div>
  )
}

interface JourneyHudProps {
  landmarks: readonly JourneyLandmark[]
  activeLandmark: JourneyLandmark
  suggestedLandmark: JourneyLandmark | null
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  journeyCompleted: boolean
  playerPosition: MapPosition
  distance: number
  nearbyLandmark: JourneyLandmark | null
  storyLandmark: JourneyLandmark | null
  assistedTravel: boolean
  showOnboarding: boolean
  isTouch: boolean
  reducedMotion: boolean
  movementRef: React.MutableRefObject<MovementInput>
  onDestinationChange: (id: JourneyLandmarkId) => void
  onAssistedTravelToggle: () => void
  onInteract: () => void
  onStoryOpen: (landmark: JourneyLandmark) => void
  onStoryClose: () => void
  onContactAction: (action: JourneyContactAction) => void
  onCompleteJourney: () => void
  onOnboardingComplete: () => void
}

export function JourneyHud({
  landmarks,
  activeLandmark,
  suggestedLandmark,
  discoveredIds,
  journeyCompleted,
  playerPosition,
  distance,
  nearbyLandmark,
  storyLandmark,
  assistedTravel,
  showOnboarding,
  isTouch,
  reducedMotion,
  movementRef,
  onDestinationChange,
  onAssistedTravelToggle,
  onInteract,
  onStoryOpen,
  onStoryClose,
  onContactAction,
  onCompleteJourney,
  onOnboardingComplete,
}: JourneyHudProps) {
  const [openPanel, setOpenPanel] = React.useState<OpenPanel>(null)
  const returnLinkRef = React.useRef<HTMLAnchorElement>(null)
  const storyReturnTarget = React.useRef<"passport" | "interact" | null>(null)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openPanel) setOpenPanel(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openPanel])

  const openStory = (landmark: JourneyLandmark) => {
    storyReturnTarget.current = "passport"
    setOpenPanel(null)
    onStoryOpen(landmark)
  }

  const restoreFocus = React.useCallback((selector: string) => {
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(selector)
      if (target) target.focus()
      else returnLinkRef.current?.focus()
    })
  }, [])

  const closeStory = () => {
    const returnTarget = storyReturnTarget.current ?? "interact"
    storyReturnTarget.current = null
    onStoryClose()
    restoreFocus(
      returnTarget === "passport"
        ? "[data-journey-passport-trigger]"
        : "[data-journey-interact]"
    )
  }

  const statusMessage = showOnboarding
    ? ""
    : storyLandmark
      ? `Viewing ${storyLandmark.shortTitle}.`
      : journeyCompleted
        ? "Guided journey complete. Free exploration remains available."
        : assistedTravel
          ? `Assisted Travel is walking to ${activeLandmark.shortTitle}.`
          : nearbyLandmark
            ? `${nearbyLandmark.shortTitle} is nearby. Press E or use the Explore button to open its story.`
            : `Active destination: ${activeLandmark.shortTitle}.`

  return (
    <>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>
      {!storyLandmark && !showOnboarding && (
        <>
          <Link
            ref={returnLinkRef}
            data-journey-ui
            href={PORTFOLIO_URL}
            aria-label="Return to standard portfolio"
            className="journey-tool-button absolute top-4 left-4 z-30 size-11 justify-center px-0 sm:top-5 sm:left-5"
          >
            <IconArrowLeft size={18} />
          </Link>
          <PassportPanel
            landmarks={landmarks}
            discoveredIds={discoveredIds}
            journeyCompleted={journeyCompleted}
            open={openPanel === "passport"}
            onOpenChange={(open) => setOpenPanel(open ? "passport" : null)}
            onOpenStory={openStory}
          />
          <JourneyMap
            landmarks={landmarks}
            activeLandmarkId={activeLandmark.id}
            suggestedLandmarkId={suggestedLandmark?.id ?? null}
            discoveredIds={discoveredIds}
            journeyCompleted={journeyCompleted}
            assistedTravel={assistedTravel}
            reducedMotion={reducedMotion}
            playerPosition={playerPosition}
            open={openPanel === "map"}
            onOpenChange={(open) => setOpenPanel(open ? "map" : null)}
            onSelect={onDestinationChange}
            onAssistedTravelToggle={onAssistedTravelToggle}
          />

          {openPanel === null && (
            <>
              <section
                data-journey-ui
                aria-label="Current route"
                className="journey-route-strip absolute right-3 bottom-4 left-[8.5rem] z-20 min-h-[4.5rem] sm:right-auto sm:bottom-5 sm:left-1/2 sm:w-[min(42rem,calc(100vw-31rem))] sm:min-w-[29rem] sm:-translate-x-1/2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[#c45f3f]" />
                    <span className="journey-kicker">
                      {journeyCompleted ? "Free exploration" : "Destination"}
                    </span>
                    {!journeyCompleted &&
                      activeLandmark.id === suggestedLandmark?.id && (
                        <span className="hidden border-l border-[#173a38]/20 pl-2 font-mono text-[9px] tracking-[0.1em] text-[#806137] uppercase sm:inline">
                          Suggested next
                        </span>
                      )}
                  </div>
                  <h2 className="mt-1 truncate font-[family-name:var(--font-journey-display)] text-lg leading-none font-semibold sm:text-2xl">
                    {activeLandmark.shortTitle}
                  </h2>
                  <p className="mt-1 font-mono text-[10px] text-[#48615d] sm:text-xs">
                    {journeyDistanceLabel(distance)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!reducedMotion) onAssistedTravelToggle()
                  }}
                  aria-disabled={reducedMotion}
                  aria-label={
                    reducedMotion
                      ? "Auto-walk off: reduced motion is enabled"
                      : assistedTravel
                        ? "Stop walking"
                        : "Walk route"
                  }
                  title={
                    reducedMotion
                      ? "Automatic walking is off while reduced motion is enabled"
                      : undefined
                  }
                  className="journey-route-action"
                >
                  {assistedTravel ? (
                    <IconPlayerPause size={16} />
                  ) : (
                    <IconWalk size={16} />
                  )}
                  <span className="hidden sm:inline">
                    {reducedMotion
                      ? "Auto-walk off"
                      : assistedTravel
                        ? "Stop walking"
                        : "Walk route"}
                  </span>
                </button>
              </section>

              {!isTouch && (
                <div
                  data-journey-ui
                  className="absolute bottom-5 left-5 z-10 hidden items-center gap-3 border-l-2 border-[#c45f3f] bg-[#173a38]/88 px-3 py-2 font-mono text-[10px] text-[#f4edcf] shadow-lg backdrop-blur-sm md:flex"
                >
                  <span>
                    <kbd>WASD</kbd> move
                  </span>
                  <span>
                    <kbd>Hold W/S</kbd> run
                  </span>
                  <span>
                    <kbd>Drag</kbd> / <kbd>J L</kbd> turn
                  </span>
                  <span>
                    <kbd>E</kbd> explore
                  </span>
                </div>
              )}
              {isTouch && <MobileJoystick movementRef={movementRef} />}

              {nearbyLandmark && (
                <button
                  data-journey-ui
                  data-journey-interact
                  type="button"
                  onClick={() => {
                    storyReturnTarget.current = "interact"
                    onInteract()
                  }}
                  aria-keyshortcuts="E"
                  className="journey-primary-button absolute right-3 bottom-[6.25rem] z-20 sm:right-auto sm:bottom-[6.5rem] sm:left-1/2 sm:-translate-x-1/2"
                >
                  <span className="hidden border-r border-white/25 pr-2 font-mono text-[10px] md:inline">
                    E
                  </span>{" "}
                  Explore {nearbyLandmark.shortTitle}
                </button>
              )}
            </>
          )}
        </>
      )}

      {storyLandmark && (
        <StoryCard
          landmark={storyLandmark}
          onClose={closeStory}
          journeyCompleted={journeyCompleted}
          onContactAction={onContactAction}
          onCompleteJourney={onCompleteJourney}
        />
      )}
      {showOnboarding && (
        <JourneyOnboarding
          onComplete={() => {
            onOnboardingComplete()
            restoreFocus("[data-journey-passport-trigger]")
          }}
          isTouch={isTouch}
        />
      )}
    </>
  )
}
