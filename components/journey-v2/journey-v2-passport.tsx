"use client"

import * as React from "react"
import {
  IconBook2,
  IconCheck,
  IconRoute,
  IconRubberStamp,
  IconX,
} from "@tabler/icons-react"
import type { JourneyLandmark, JourneyLandmarkId } from "@/lib/journey/types"
import { useDialogFocusTrap } from "@/lib/journey-v2/ui/use-journey-v2-accessibility"

interface JourneyV2PassportProps {
  landmarks: readonly JourneyLandmark[]
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  journeyCompleted: boolean
  onClose: () => void
  onStoryOpen: (landmark: JourneyLandmark) => void
  presentation?: "dialog" | "dock"
}

export function JourneyV2Passport({
  landmarks,
  discoveredIds,
  journeyCompleted,
  onClose,
  onStoryOpen,
  presentation = "dialog",
}: JourneyV2PassportProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  useDialogFocusTrap(true, dialogRef, onClose)
  const isDock = presentation === "dock"
  const stampedLandmarks = landmarks.filter((landmark) =>
    discoveredIds.has(landmark.id)
  )
  const progress =
    landmarks.length > 0
      ? (stampedLandmarks.length / landmarks.length) * 100
      : 0

  return (
    <div
      className={
        isDock
          ? "journey-passport-dock pointer-events-none absolute inset-x-3 bottom-3 z-50 flex sm:inset-x-auto sm:top-20 sm:bottom-auto sm:left-4"
          : "journey-dialog-scrim absolute inset-0 z-50 flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
      }
    >
      <div
        className={`journey-layered-paper pointer-events-auto w-full ${
          isDock ? "sm:w-[21rem]" : "my-auto max-w-3xl"
        }`}
      >
        <section
          ref={dialogRef}
          id="journey-v2-passport-panel"
          data-journey-panel
          data-journey-passport-presentation={presentation}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="journey-v2-passport-title"
          className={`journey-atlas-panel journey-passport-panel journey-passport-booklet flex w-full flex-col overflow-hidden ${
            isDock
              ? "max-h-[72dvh] p-3 sm:max-h-[calc(100dvh-7rem)] sm:p-4"
              : "max-h-[88dvh] p-4 sm:p-6"
          }`}
        >
          <header
            className={`flex shrink-0 items-start justify-between border-b border-[#143d42]/20 ${
              isDock ? "gap-2 pb-3" : "gap-4 pb-4"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex shrink-0 items-center justify-center rounded-full border border-[#143d42]/25 bg-[#e9ddc6] ${
                  isDock ? "size-9" : "size-11"
                }`}
              >
                <IconRubberStamp aria-hidden="true" size={isDock ? 19 : 23} />
              </span>
              <div>
                <p className="journey-kicker">Persistent travel record</p>
                <h2
                  id="journey-v2-passport-title"
                  className={`mt-1 font-[family-name:var(--font-journey-display)] leading-none font-semibold ${
                    isDock ? "text-2xl" : "text-4xl"
                  }`}
                >
                  Journey Passport
                </h2>
              </div>
            </div>
            <button
              type="button"
              className="journey-icon-button"
              onClick={onClose}
              aria-label="Close Passport"
            >
              <IconX aria-hidden="true" size={19} />
            </button>
          </header>

          <div
            className={`shrink-0 border border-[#143d42]/20 bg-[#e9ddc6] ${
              isDock ? "mt-3 p-2.5" : "mt-4 p-3"
            }`}
          >
            <div
              className={`flex gap-4 ${
                isDock
                  ? "items-center justify-between"
                  : "items-end justify-between"
              }`}
            >
              <div>
                <p className="font-mono text-[9px] tracking-[0.12em] text-[#8a594a] uppercase">
                  Places physically reached
                </p>
                <p
                  className={`mt-1 font-[family-name:var(--font-journey-display)] font-semibold ${
                    isDock ? "text-2xl" : "text-3xl"
                  }`}
                >
                  {stampedLandmarks.length}
                  <span
                    className={`ml-1 text-[#4f6865] ${
                      isDock ? "text-sm" : "text-lg"
                    }`}
                  >
                    / {landmarks.length}
                  </span>
                </p>
              </div>
              {isDock ? (
                <p className="max-w-36 text-right text-[10px] leading-4 text-[#4f6865]">
                  Stamps mark places reached in the world.
                </p>
              ) : (
                <p className="max-w-sm text-right text-xs leading-5 text-[#4f6865]">
                  Reading a story from the Atlas never creates a false visit.
                  Stamps are earned only by reaching its place in the world.
                </p>
              )}
            </div>
            <div
              className={`overflow-hidden rounded-full bg-[#f9f2e4] ${
                isDock ? "mt-2 h-1.5" : "mt-3 h-2"
              }`}
              role="progressbar"
              aria-label="Journey Passport progress"
              aria-valuemin={0}
              aria-valuemax={landmarks.length}
              aria-valuenow={stampedLandmarks.length}
            >
              <div
                className="h-full rounded-full bg-[#c76343]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <ol
            className={`grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto pr-1 ${
              isDock ? "mt-3 grid-cols-1" : "mt-4 sm:grid-cols-2"
            }`}
          >
            {landmarks.map((landmark) => {
              const stamped = discoveredIds.has(landmark.id)
              return (
                <li
                  key={landmark.id}
                  data-journey-passport-entry={landmark.id}
                  data-stamped={stamped}
                  className={`relative overflow-hidden border ${
                    isDock ? "min-h-0 p-2.5" : "min-h-28 p-3"
                  } ${
                    stamped
                      ? `border-[#143d42]/35 bg-[#f2e5ca] ${
                          isDock ? "pr-12" : "pr-20"
                        }`
                      : "border-dashed border-[#143d42]/20 bg-[#f9f2e4]/55"
                  }`}
                >
                  <div
                    className={`flex items-start ${isDock ? "gap-2.5" : "gap-3"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex shrink-0 items-center justify-center rounded-full border-2 font-mono text-[10px] font-bold ${
                        isDock ? "size-8" : "size-9"
                      } ${
                        stamped
                          ? "rotate-[-6deg] border-[#c76343] text-[#c76343]"
                          : "border-[#143d42]/20 text-[#4f6865]"
                      }`}
                    >
                      {stamped ? (
                        <IconCheck size={16} stroke={3} />
                      ) : (
                        landmark.routeOrder + 1
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[9px] tracking-[0.12em] text-[#8a594a] uppercase">
                        {stamped ? "Stamped" : "Awaiting visit"} ·{" "}
                        {landmark.district}
                      </p>
                      <h3 className="mt-1 truncate text-sm font-semibold text-[#214f52]">
                        {landmark.shortTitle}
                      </h3>
                      <button
                        type="button"
                        onClick={() => onStoryOpen(landmark)}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-[#2c6a60] underline decoration-[#c76343] underline-offset-4 ${
                          isDock ? "mt-1.5 min-h-7" : "mt-2 min-h-9"
                        }`}
                      >
                        <IconBook2 aria-hidden="true" size={14} />
                        Read chapter
                      </button>
                    </div>
                  </div>
                  {stamped && (
                    <span
                      aria-hidden="true"
                      className={`journey-passport-stamp ${
                        isDock ? "journey-passport-stamp--compact" : ""
                      }`}
                    >
                      <IconCheck />
                      <span>Visited</span>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>

          <footer
            className={`flex shrink-0 flex-col items-stretch justify-between gap-3 border-t border-[#143d42]/20 sm:flex-row sm:items-center ${
              isDock ? "mt-3 pt-3" : "mt-4 pt-4"
            }`}
          >
            <p className="flex items-center gap-2 text-xs text-[#4f6865]">
              <IconRoute aria-hidden="true" size={15} />
              {journeyCompleted
                ? "Guided chronology complete. Free exploration remains open."
                : "The Contact Pavilion closes the guided chronology."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className={`journey-primary-button ${
                isDock ? "journey-passport-mobile-close" : ""
              }`}
            >
              Close Passport
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}
