"use client"

import * as React from "react"
import {
  IconBook2,
  IconCheck,
  IconListDetails,
  IconMapPin,
  IconRoute,
  IconX,
} from "@tabler/icons-react"
import type { JourneyLandmark, JourneyLandmarkId } from "@/lib/journey/types"
import { useDialogFocusTrap } from "@/lib/journey-v2/ui/use-journey-v2-accessibility"

interface JourneyV2WorldAtlasProps {
  landmarks: readonly JourneyLandmark[]
  destinationId: JourneyLandmarkId
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  onClose: () => void
  onDestinationChange: (id: JourneyLandmarkId) => void
  onStoryOpen: (landmark: JourneyLandmark) => void
  onOpenCompleteAtlas: () => void
}

function districtLabel(district: JourneyLandmark["district"]) {
  return district === "about"
    ? "Introduction"
    : `${district[0].toUpperCase()}${district.slice(1)}`
}

export function JourneyV2WorldAtlas({
  landmarks,
  destinationId,
  discoveredIds,
  onClose,
  onDestinationChange,
  onStoryOpen,
  onOpenCompleteAtlas,
}: JourneyV2WorldAtlasProps) {
  const panelRef = React.useRef<HTMLElement>(null)
  useDialogFocusTrap(true, panelRef, onClose)

  const destination =
    landmarks.find((landmark) => landmark.id === destinationId) ?? landmarks[0]
  const discoveredCount = landmarks.filter((landmark) =>
    discoveredIds.has(landmark.id)
  ).length

  return (
    <div className="journey-world-atlas-layer pointer-events-none absolute inset-0 z-40">
      <section
        ref={panelRef}
        id="journey-v2-world-atlas"
        data-journey-panel
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="journey-v2-world-atlas-title"
        className="journey-atlas-panel journey-folded-atlas journey-world-atlas-dock pointer-events-auto"
      >
        <header className="journey-dock-header flex items-start justify-between gap-3 border-b border-[#143d42]/20 pb-3">
          <div>
            <p className="journey-kicker">Route instrument · M</p>
            <h2
              id="journey-v2-world-atlas-title"
              className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl leading-none font-semibold"
            >
              The Journey Atlas
            </h2>
          </div>
          <button
            type="button"
            className="journey-icon-button"
            onClick={onClose}
            aria-label="Close Atlas"
          >
            <IconX aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="mt-3 shrink-0 border border-[#143d42]/20 bg-[#e9ddc6] p-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#c76343] text-[#f9f2e4]">
              <IconMapPin aria-hidden="true" size={16} />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[9px] tracking-[0.12em] text-[#8a594a] uppercase">
                Walking destination
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[#214f52]">
                {destination?.shortTitle}
              </p>
              <p className="mt-1 line-clamp-1 text-[11px] text-[#4f6865]">
                {destination?.story.title}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="journey-kicker">Twelve professional stops</p>
            <span className="font-mono text-[9px] text-[#4f6865]">
              {discoveredCount}/{landmarks.length} stamped
            </span>
          </div>

          <ol className="journey-world-atlas-list mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {landmarks.map((landmark) => {
              const selected = landmark.id === destinationId
              const discovered = discoveredIds.has(landmark.id)
              return (
                <li
                  key={landmark.id}
                  data-journey-atlas-entry={landmark.id}
                  data-destination={selected}
                  className={`grid grid-cols-[minmax(0,1fr)_2.75rem] border ${
                    selected
                      ? "border-[#c76343] bg-[#f2e5ca]"
                      : "border-[#143d42]/18 bg-[#f9f2e4]/88"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onDestinationChange(landmark.id)}
                    aria-pressed={selected}
                    aria-label={`${selected ? "Current destination" : "Set destination"}: ${landmark.shortTitle}`}
                    className="flex min-h-14 min-w-0 items-center gap-2.5 px-2.5 py-2 text-left hover:bg-[#e9ddc6]"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold ${
                        discovered
                          ? "border-[#143d42] bg-[#143d42] text-[#f9f2e4]"
                          : "border-[#143d42]/30 text-[#4f6865]"
                      }`}
                    >
                      {discovered ? (
                        <IconCheck size={12} stroke={3} />
                      ) : (
                        String(landmark.routeOrder + 1).padStart(2, "0")
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[8px] tracking-[0.1em] text-[#8a594a] uppercase">
                        {districtLabel(landmark.district)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-[#214f52]">
                        {landmark.shortTitle}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onStoryOpen(landmark)}
                    aria-label={`Read chapter: ${landmark.shortTitle}`}
                    className="flex min-h-11 items-center justify-center border-l border-[#143d42]/18 text-[#2c6a60] hover:bg-[#e9ddc6]"
                    title="Read chapter"
                  >
                    <IconBook2 aria-hidden="true" size={16} />
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        <footer className="mt-3 grid shrink-0 grid-cols-2 gap-2 border-t border-[#143d42]/20 pt-3">
          <button
            type="button"
            onClick={onOpenCompleteAtlas}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 border border-[#143d42]/30 px-2 text-[11px] font-semibold hover:bg-[#e9ddc6]"
          >
            <IconListDetails aria-hidden="true" size={15} />
            Complete Atlas
          </button>
          <button
            type="button"
            onClick={onClose}
            className="journey-primary-button min-h-11 px-2 text-[11px]"
          >
            <IconRoute aria-hidden="true" size={15} />
            Return to world
          </button>
        </footer>
      </section>
    </div>
  )
}
