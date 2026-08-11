"use client"

import * as React from "react"
import Link from "next/link"
import {
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconMap2,
  IconRoute,
  IconRubberStamp,
  IconWalk,
  IconX,
} from "@tabler/icons-react"
import type { JourneyLandmark, JourneyLandmarkId } from "@/lib/journey/types"
import { useDialogFocusTrap } from "@/lib/journey-v2/ui/use-journey-v2-accessibility"
import { PORTFOLIO_URL } from "@/lib/portfolio-url"

interface AtlasPoint {
  x: number
  y: number
}

function createMapPoints(landmarks: readonly JourneyLandmark[]) {
  return new Map<JourneyLandmarkId, AtlasPoint>(
    landmarks.map((landmark) => {
      const branchX =
        landmark.district === "learning"
          ? 78
          : landmark.district === "projects"
            ? 22
            : landmark.district === "community"
              ? 78
              : null
      const spineX = 48 + Math.sin(landmark.routeOrder * 1.37) * 7
      return [
        landmark.id,
        {
          x: branchX ?? spineX,
          y: 8 + landmark.routeOrder * 7.4,
        },
      ]
    })
  )
}

function districtLabel(district: JourneyLandmark["district"]) {
  return district === "about"
    ? "Introduction"
    : `${district[0].toUpperCase()}${district.slice(1)}`
}

interface JourneyV2AtlasProps {
  landmarks: readonly JourneyLandmark[]
  destinationId: JourneyLandmarkId
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  presentation: "page" | "dialog"
  worldAvailable: boolean
  onClose?: () => void
  onDestinationChange: (id: JourneyLandmarkId) => void
  onStoryOpen: (landmark: JourneyLandmark) => void
  onPassportOpen: () => void
  onEnterWorld: () => void
}

export function JourneyV2Atlas({
  landmarks,
  destinationId,
  discoveredIds,
  presentation,
  worldAvailable,
  onClose,
  onDestinationChange,
  onStoryOpen,
  onPassportOpen,
  onEnterWorld,
}: JourneyV2AtlasProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const isDialog = presentation === "dialog"
  useDialogFocusTrap(isDialog, dialogRef, () => onClose?.())

  const points = React.useMemo(() => createMapPoints(landmarks), [landmarks])
  const routePoints = landmarks
    .filter(
      (landmark) =>
        landmark.district !== "learning" &&
        landmark.district !== "projects" &&
        landmark.district !== "community"
    )
    .map((landmark) => points.get(landmark.id))
    .filter((point): point is AtlasPoint => Boolean(point))
    .map((point) => `${point.x},${point.y}`)
    .join(" ")
  const branchPaths = [
    ["multiversal-software", "learning-library"],
    ["mymedicalhub", "project-workshop"],
    ["mymedicalhub", "community-hall"],
  ]
    .map((ids) =>
      ids
        .map((id) => points.get(id))
        .filter((point): point is AtlasPoint => Boolean(point))
        .map((point) => `${point.x},${point.y}`)
        .join(" ")
    )
    .filter(Boolean)
  const discoveredCount = landmarks.filter((landmark) =>
    discoveredIds.has(landmark.id)
  ).length

  const content = (
    <div
      ref={dialogRef}
      data-journey-panel
      tabIndex={isDialog ? -1 : undefined}
      className={
        isDialog
          ? "journey-atlas-panel journey-folded-atlas flex max-h-[92dvh] w-full flex-col overflow-hidden p-4 sm:p-6"
          : "journey-atlas-page journey-folded-atlas mx-auto flex min-h-dvh w-full max-w-[100rem] flex-col px-4 py-5 sm:px-7 sm:py-7"
      }
      role={isDialog ? "dialog" : undefined}
      aria-modal={isDialog ? true : undefined}
      aria-labelledby="journey-v2-atlas-title"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#143d42]/20 pb-4">
        <div>
          <p className="journey-kicker">
            Professional Atlas · Every chapter open
          </p>
          <h1
            id="journey-v2-atlas-title"
            className="mt-2 font-[family-name:var(--font-journey-display)] text-4xl leading-none font-semibold sm:text-5xl"
          >
            The Journey Atlas
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[#4f6865] sm:text-sm">
            Read in chronological order or choose any chapter. A Passport stamp
            records a physical arrival, never a reading requirement.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="journey-icon-button"
            onClick={onPassportOpen}
            aria-label={`Open Passport. ${discoveredCount} of ${landmarks.length} places stamped`}
          >
            <IconRubberStamp aria-hidden="true" size={19} />
          </button>
          {isDialog ? (
            <button
              type="button"
              className="journey-icon-button"
              onClick={onClose}
              aria-label="Close Atlas"
            >
              <IconX aria-hidden="true" size={19} />
            </button>
          ) : (
            <Link
              href={PORTFOLIO_URL}
              className="journey-icon-button"
              aria-label="Return to standard portfolio"
            >
              <IconArrowLeft aria-hidden="true" size={19} />
            </Link>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 pt-5 lg:grid-cols-[minmax(19rem,0.82fr)_minmax(30rem,1.18fr)]">
        <section
          className="relative min-h-[20rem] overflow-hidden border border-[#143d42]/25 bg-[#c9d6b5] lg:min-h-0"
          aria-labelledby="journey-v2-map-plot-title"
        >
          <div className="absolute inset-0 bg-[linear-gradient(rgba(20,61,66,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(20,61,66,0.06)_1px,transparent_1px)] bg-[size:22px_22px]" />
          <div className="absolute top-4 left-4 z-10">
            <p className="journey-kicker">Chronology schematic</p>
            <h2
              id="journey-v2-map-plot-title"
              className="mt-1 font-[family-name:var(--font-journey-display)] text-2xl font-semibold"
            >
              Rangpur to production
            </h2>
          </div>

          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              points={routePoints}
              fill="none"
              stroke="#f9f2e4"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {branchPaths.map((branchPath) => (
              <polyline
                key={branchPath}
                points={branchPath}
                fill="none"
                stroke="#f9f2e4"
                strokeWidth="5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polyline
              points={routePoints}
              fill="none"
              stroke="#c76343"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {branchPaths.map((branchPath) => (
              <polyline
                key={`route-${branchPath}`}
                points={branchPath}
                fill="none"
                stroke="#c76343"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {landmarks.map((landmark) => {
            const point = points.get(landmark.id)
            if (!point) return null
            const selected = landmark.id === destinationId
            const discovered = discoveredIds.has(landmark.id)
            return (
              <button
                key={landmark.id}
                type="button"
                aria-label={`${landmark.shortTitle}. ${discovered ? "Passport stamped." : "Not yet physically visited."}${selected ? " Current destination." : ""}`}
                aria-pressed={selected}
                onClick={() => onDestinationChange(landmark.id)}
                className={`absolute z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[9px] font-bold shadow-sm transition-transform hover:scale-110 ${
                  selected
                    ? "border-[#f9f2e4] bg-[#c76343] text-[#f9f2e4] ring-4 ring-[#143d42]"
                    : discovered
                      ? "border-[#f9f2e4] bg-[#143d42] text-[#f9f2e4]"
                      : "border-[#143d42] bg-[#f9f2e4] text-[#143d42]"
                }`}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                {discovered ? (
                  <IconCheck aria-hidden="true" size={12} stroke={3} />
                ) : (
                  landmark.routeOrder + 1
                )}
              </button>
            )
          })}

          <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-3 bg-[#f9f2e4]/95 px-3 py-2 text-[10px] text-[#4f6865]">
            <span className="flex items-center gap-1.5">
              <IconRoute aria-hidden="true" size={14} />
              Terracotta marks the chronology
            </span>
            <span className="font-mono">
              {discoveredCount}/{landmarks.length} stamped
            </span>
          </div>
        </section>

        <section
          className="min-h-0 overflow-y-auto pr-1"
          aria-labelledby="journey-v2-chronology-title"
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="journey-kicker">Chronology</p>
              <h2
                id="journey-v2-chronology-title"
                className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl font-semibold"
              >
                Twelve professional stops
              </h2>
            </div>
            {worldAvailable && (
              <button
                type="button"
                className="journey-primary-button hidden sm:inline-flex"
                onClick={onEnterWorld}
                aria-label={isDialog ? "Return to world" : "Explore in 3D"}
              >
                <IconWalk aria-hidden="true" size={17} />
                {isDialog ? "Return to world" : "Explore in 3D"}
              </button>
            )}
          </div>

          <ol className="mt-4 space-y-2">
            {landmarks.map((landmark) => {
              const selected = landmark.id === destinationId
              const discovered = discoveredIds.has(landmark.id)
              return (
                <li
                  key={landmark.id}
                  data-journey-atlas-entry={landmark.id}
                  data-destination={selected}
                  className={`grid grid-cols-[2.25rem_minmax(0,1fr)] border p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center ${
                    selected
                      ? "border-[#c76343] bg-[#f2e5ca]"
                      : "border-[#143d42]/18 bg-[#f9f2e4]/76"
                  }`}
                >
                  <span
                    className={`flex size-8 items-center justify-center rounded-full border font-mono text-[10px] font-semibold ${
                      discovered
                        ? "border-[#143d42] bg-[#143d42] text-[#f9f2e4]"
                        : "border-[#143d42]/30"
                    }`}
                    aria-hidden="true"
                  >
                    {discovered ? (
                      <IconCheck size={14} stroke={3} />
                    ) : (
                      String(landmark.routeOrder + 1).padStart(2, "0")
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[9px] tracking-[0.12em] text-[#8a594a] uppercase">
                      {districtLabel(landmark.district)}
                      {discovered ? " · Passport stamped" : ""}
                    </p>
                    <h3 className="mt-0.5 truncate text-sm font-semibold text-[#214f52] sm:text-base">
                      {landmark.shortTitle}
                    </h3>
                    <p className="mt-1 line-clamp-1 text-xs text-[#4f6865]">
                      {landmark.story.title}
                    </p>
                  </div>
                  <div className="col-start-2 mt-3 flex flex-wrap gap-2 sm:col-start-auto sm:mt-0 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => onStoryOpen(landmark)}
                      className="inline-flex min-h-10 items-center gap-1.5 border border-[#143d42]/30 px-3 text-xs font-semibold text-[#143d42] hover:bg-[#e9ddc6]"
                    >
                      <IconBook2 aria-hidden="true" size={15} />
                      Read chapter
                    </button>
                    <button
                      type="button"
                      onClick={() => onDestinationChange(landmark.id)}
                      className="inline-flex min-h-10 items-center gap-1.5 border border-[#143d42]/30 px-3 text-xs font-semibold text-[#143d42] hover:bg-[#e9ddc6]"
                      aria-pressed={selected}
                    >
                      <IconMap2 aria-hidden="true" size={15} />
                      {selected ? "Destination set" : "Set destination"}
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>

          {worldAvailable && (
            <button
              type="button"
              className="journey-primary-button mt-4 w-full sm:hidden"
              onClick={onEnterWorld}
              aria-label={isDialog ? "Return to world" : "Explore in 3D"}
            >
              <IconWalk aria-hidden="true" size={17} />
              {isDialog ? "Return to world" : "Explore in 3D"}
            </button>
          )}
        </section>
      </div>
    </div>
  )

  if (!isDialog) {
    return (
      <div className="min-h-dvh overflow-y-auto bg-[#5ea9e1]">{content}</div>
    )
  }

  return (
    <div className="journey-dialog-scrim absolute inset-0 z-40 flex overflow-y-auto p-3 sm:p-6">
      <div className="journey-layered-paper my-auto w-full max-w-6xl">
        {content}
      </div>
    </div>
  )
}
