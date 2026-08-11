"use client"

import * as React from "react"
import {
  IconArrowUpRight,
  IconBook2,
  IconBriefcase,
  IconCheck,
  IconExternalLink,
  IconRoute,
  IconX,
} from "@tabler/icons-react"
import type { JourneyContactAction, JourneyLandmark } from "@/lib/journey/types"
import { useDialogFocusTrap } from "@/lib/journey-v2/ui/use-journey-v2-accessibility"

function renderEmphasis(text: string) {
  return text.split("**").map((part, index) =>
    index % 2 === 1 ? (
      <strong key={`${part}-${index}`} className="font-semibold text-[#214f52]">
        {part}
      </strong>
    ) : (
      part
    )
  )
}

function TechnologyTags({ values }: { values: readonly string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Technologies used">
      {values.map((value) => (
        <span
          key={value}
          className="border border-[#2c6a60]/20 bg-[#d7dcbf] px-2 py-1 font-mono text-[9px] text-[#2c6a60]"
        >
          {value}
        </span>
      ))}
    </div>
  )
}

function CareerArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["archive"]>
}) {
  return (
    <section className="mt-7 border-t border-[#143d42]/20 pt-5">
      <p className="journey-kicker">{archive.eyebrow}</p>
      <h3 className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl font-semibold">
        {archive.title}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[#4f6865]">
        {archive.description}
      </p>
      <ol className="mt-4 space-y-3">
        {archive.entries.map((entry, index) => (
          <li
            key={entry.recordId}
            className="border border-[#143d42]/18 bg-[#f2e5ca] p-4 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-5"
          >
            <div>
              <p className="font-mono text-[9px] tracking-[0.12em] text-[#8a594a] uppercase">
                Role {index + 1}
              </p>
              <p className="mt-1 text-xs text-[#4f6865]">{entry.period}</p>
            </div>
            <div className="mt-3 sm:mt-0">
              <h4 className="font-semibold text-[#214f52]">{entry.title}</h4>
              <p className="mt-0.5 text-xs text-[#4f6865]">{entry.subtitle}</p>
              <p className="mt-3 text-sm leading-6 text-[#526b67]">
                {renderEmphasis(entry.body)}
              </p>
              <TechnologyTags values={entry.tags} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LearningArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["learningArchive"]>
}) {
  return (
    <section className="mt-7 border-t border-[#143d42]/20 pt-5">
      <p className="journey-kicker">{archive.eyebrow}</p>
      <h3 className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl font-semibold">
        {archive.title}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[#4f6865]">
        {archive.description}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {archive.rooms.map((room) => (
          <details
            key={room.id}
            className="group border border-[#143d42]/18 bg-[#f2e5ca] p-4"
          >
            <summary className="cursor-pointer list-none font-semibold text-[#214f52] marker:hidden">
              <span className="flex items-center justify-between gap-3">
                {room.title}
                <span className="font-mono text-[9px] font-normal text-[#8a594a] uppercase">
                  {room.evidence.length} records
                </span>
              </span>
            </summary>
            <p className="mt-2 text-xs leading-5 text-[#4f6865]">
              {room.summary}
            </p>
            <TechnologyTags values={room.technologies} />
            {room.evidence.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-[#143d42]/15 pt-3">
                {room.evidence.map((evidence) => (
                  <li
                    key={`${room.id}-${evidence.recordId}`}
                    className="text-xs"
                  >
                    <span className="font-mono text-[8px] tracking-[0.1em] text-[#8a594a] uppercase">
                      {evidence.kind}
                    </span>
                    <p className="font-medium text-[#214f52]">
                      {evidence.title}
                    </p>
                    <p className="text-[#4f6865]">{evidence.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
      {archive.certifications.length > 0 && (
        <div className="mt-5">
          <h4 className="font-[family-name:var(--font-journey-display)] text-2xl font-semibold">
            Certifications
          </h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {archive.certifications.map((certification) => (
              <li
                key={certification.recordId}
                className="border border-[#143d42]/18 p-3"
              >
                <a
                  href={certification.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block"
                >
                  <span className="flex items-start justify-between gap-3 text-sm font-semibold text-[#214f52]">
                    {certification.title}
                    <IconExternalLink
                      aria-hidden="true"
                      className="shrink-0"
                      size={14}
                    />
                  </span>
                  <span className="mt-1 block font-mono text-[9px] text-[#8a594a]">
                    {certification.year}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-[#4f6865]">
                    {certification.description}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ProjectArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["projectArchive"]>
}) {
  const featuredIds = new Set(
    archive.featured.map((project) => project.recordId)
  )
  const remainingProjects = archive.records.filter(
    (project) => !featuredIds.has(project.recordId)
  )

  return (
    <section className="mt-7 border-t border-[#143d42]/20 pt-5">
      <p className="journey-kicker">{archive.eyebrow}</p>
      <h3 className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl font-semibold">
        {archive.title}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[#4f6865]">
        {archive.description}
      </p>
      <div className="mt-4 space-y-4">
        {archive.featured.map((project, index) => (
          <article
            key={project.recordId}
            className="border border-[#143d42]/20 bg-[#f2e5ca] p-4 sm:p-5"
          >
            <p className="font-mono text-[9px] tracking-[0.12em] text-[#8a594a] uppercase">
              Exhibit {String(index + 1).padStart(2, "0")}
            </p>
            <h4 className="mt-1 font-[family-name:var(--font-journey-display)] text-2xl font-semibold text-[#214f52]">
              {project.shortTitle}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[#4f6865]">
              {project.description}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Problem", project.problem],
                ["Solution", project.solution],
                ["Outcome", project.outcome],
              ].map(([label, value]) => (
                <div key={label} className="border-l-2 border-[#c76343] pl-3">
                  <dt className="font-mono text-[9px] tracking-[0.1em] text-[#8a594a] uppercase">
                    {label}
                  </dt>
                  <dd className="mt-1 text-xs leading-5 text-[#526b67]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <TechnologyTags values={project.technologies} />
            {project.links.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {project.links.map((link) => (
                  <a
                    key={`${project.recordId}-${link.kind}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 items-center gap-1.5 border border-[#143d42]/30 px-3 text-xs font-semibold hover:bg-[#e9ddc6]"
                  >
                    {link.label}
                    <IconArrowUpRight aria-hidden="true" size={14} />
                  </a>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      {remainingProjects.length > 0 && (
        <details className="mt-4 border border-[#143d42]/20 bg-[#f9f2e4]/70 p-4">
          <summary className="cursor-pointer font-semibold text-[#214f52]">
            Complete project archive · {remainingProjects.length} more
          </summary>
          <ul className="mt-4 space-y-3">
            {remainingProjects.map((project) => (
              <li
                key={project.recordId}
                className="border-t border-[#143d42]/15 pt-3"
              >
                <h5 className="text-sm font-semibold text-[#214f52]">
                  {project.shortTitle}
                </h5>
                <p className="mt-1 text-xs leading-5 text-[#4f6865]">
                  {project.description}
                </p>
                <TechnologyTags values={project.technologies} />
                {project.links.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {project.links.map((link) => (
                      <a
                        key={`${project.recordId}-${link.kind}`}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-[#2c6a60] underline decoration-[#c76343] underline-offset-4"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function CommunityArchive({
  archive,
}: {
  archive: NonNullable<JourneyLandmark["story"]["communityArchive"]>
}) {
  return (
    <section className="mt-7 border-t border-[#143d42]/20 pt-5">
      <p className="journey-kicker">{archive.eyebrow}</p>
      <h3 className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl font-semibold">
        {archive.title}
      </h3>
      <p className="mt-2 text-xs leading-5 text-[#4f6865]">
        {archive.description}
      </p>
      <div className="mt-4 space-y-3">
        {archive.groups.map((group) => (
          <section
            key={group.kind}
            className="border border-[#143d42]/18 bg-[#f2e5ca] p-4"
          >
            <h4 className="font-semibold text-[#214f52]">{group.kind}</h4>
            <p className="mt-1 text-xs leading-5 text-[#4f6865]">
              {group.summary}
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.entries.map((entry) => (
                <li
                  key={entry.recordId}
                  className="border-l-2 border-[#c76343] bg-[#f9f2e4] p-3"
                >
                  <p className="text-sm font-semibold text-[#214f52]">
                    {entry.title}
                  </p>
                  <p className="mt-0.5 text-xs text-[#4f6865]">
                    {entry.role} · {entry.period}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#526b67]">
                    {entry.description}
                  </p>
                  <p className="mt-2 font-mono text-[8px] tracking-[0.1em] text-[#8a594a] uppercase">
                    Connected to {entry.linkedLandmarkTitle}
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

function ContactPanel({
  landmark,
  journeyCompleted,
  onContactAction,
  onCompleteJourney,
}: {
  landmark: JourneyLandmark
  journeyCompleted: boolean
  onContactAction: (action: JourneyContactAction) => void
  onCompleteJourney: () => void
}) {
  const conversation = landmark.story.conversation
  if (!conversation) return null

  return (
    <section className="mt-7 border-t border-[#143d42]/20 pt-5">
      <p className="journey-kicker">{conversation.eyebrow}</p>
      <h3 className="mt-1 font-[family-name:var(--font-journey-display)] text-3xl font-semibold">
        {conversation.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-[#4f6865]">
        {conversation.description}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {conversation.actions.map((action) => (
          <a
            key={action.kind}
            href={action.url}
            target={action.url.startsWith("mailto:") ? undefined : "_blank"}
            rel={action.url.startsWith("mailto:") ? undefined : "noreferrer"}
            onClick={() => onContactAction(action)}
            className={`flex min-h-20 flex-col justify-between border p-3 text-sm font-semibold ${
              action.primary
                ? "border-[#143d42] bg-[#143d42] text-[#f9f2e4]"
                : "border-[#143d42]/30 text-[#143d42]"
            }`}
          >
            <span className="flex items-start justify-between gap-2">
              {action.label}
              <IconArrowUpRight aria-hidden="true" size={15} />
            </span>
            <span
              className={`mt-2 text-[10px] leading-4 font-normal ${
                action.primary ? "text-[#e9ddc6]" : "text-[#4f6865]"
              }`}
            >
              {action.detail}
            </span>
          </a>
        ))}
      </div>
      {!journeyCompleted ? (
        <button
          type="button"
          onClick={onCompleteJourney}
          className="journey-primary-button mt-4"
        >
          <IconCheck aria-hidden="true" size={16} />
          Complete guided chronology
        </button>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#2c6a60]">
          <IconCheck aria-hidden="true" size={16} />
          Guided chronology complete. Every district remains open.
        </p>
      )}
    </section>
  )
}

interface JourneyV2StoryDialogProps {
  landmark: JourneyLandmark
  journeyCompleted: boolean
  returnLabel: string
  presentation?: "dialog" | "field-sheet"
  onClose: () => void
  onSetDestination: (landmark: JourneyLandmark) => void
  onContactAction: (action: JourneyContactAction) => void
  onCompleteJourney: () => void
}

export function JourneyV2StoryDialog({
  landmark,
  journeyCompleted,
  returnLabel,
  presentation = "dialog",
  onClose,
  onSetDestination,
  onContactAction,
  onCompleteJourney,
}: JourneyV2StoryDialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  useDialogFocusTrap(true, dialogRef, onClose)
  const hasArchive = Boolean(
    landmark.story.archive ||
    landmark.story.learningArchive ||
    landmark.story.projectArchive ||
    landmark.story.communityArchive ||
    landmark.story.conversation
  )
  const isFieldSheet = presentation === "field-sheet"

  return (
    <div
      className={
        isFieldSheet
          ? "journey-field-sheet-layer absolute inset-0 z-[60]"
          : "journey-dialog-scrim absolute inset-0 z-[60] flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
      }
    >
      <div
        className={
          isFieldSheet
            ? `journey-field-sheet w-full ${
                hasArchive ? "max-w-4xl" : "max-w-2xl"
              }`
            : `journey-layered-paper my-auto w-full ${
                hasArchive ? "max-w-4xl" : "max-w-2xl"
              }`
        }
      >
        <span className="journey-report-clip" aria-hidden="true">
          <i />
        </span>
        <article
          ref={dialogRef}
          data-journey-panel
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="journey-v2-story-title"
          className="journey-story-sheet journey-clipped-report relative max-h-[90dvh] w-full overflow-y-auto p-5 text-[var(--journey-ink)] select-text sm:p-7"
        >
          <button
            type="button"
            onClick={onClose}
            className={`journey-icon-button ${
              isFieldSheet
                ? "journey-field-sheet-close sticky top-0 float-right"
                : "absolute top-4 right-4"
            }`}
            aria-label="Close story"
          >
            <IconX aria-hidden="true" size={18} />
          </button>

          <div className="pr-12">
            <p className="journey-kicker">
              Field report · {landmark.story.eyebrow}
            </p>
            <p className="mt-2 flex items-center gap-2 font-mono text-[9px] tracking-[0.1em] text-[#4f6865] uppercase">
              <IconRoute aria-hidden="true" size={13} />
              Stop {String(landmark.routeOrder + 1).padStart(2, "0")} ·{" "}
              {landmark.shortTitle}
            </p>
          </div>
          <h2
            id="journey-v2-story-title"
            className="mt-3 max-w-2xl font-[family-name:var(--font-journey-display)] text-4xl leading-[0.92] font-semibold tracking-[-0.02em] text-balance sm:text-5xl"
          >
            {landmark.story.title}
          </h2>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-[#425f5f] sm:text-base sm:leading-7">
            {landmark.story.body}
          </p>

          <div className="mt-5 grid gap-2 border-t border-[#143d42]/20 pt-4 sm:grid-cols-2">
            {landmark.story.facts.map((fact, index) => (
              <p
                key={`${fact}-${index}`}
                className={`border-l-2 border-[#c76343] bg-[#f2e5ca] px-3 py-2 text-xs leading-5 text-[#526b67] ${
                  index === 0 ? "sm:col-span-2" : ""
                }`}
              >
                {fact}
              </p>
            ))}
          </div>

          {landmark.story.connections &&
            landmark.story.connections.length > 0 && (
              <section className="mt-5 border-t border-[#143d42]/20 pt-4">
                <h3 className="journey-kicker">Connected community work</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {landmark.story.connections.map((connection) => (
                    <div
                      key={connection.recordId}
                      className="border border-[#143d42]/18 bg-[#f2e5ca] p-3"
                    >
                      <p className="font-mono text-[9px] tracking-[0.1em] text-[#8a594a] uppercase">
                        {connection.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#214f52]">
                        {connection.title}
                      </p>
                      <p className="mt-1 text-xs text-[#4f6865]">
                        {connection.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

          {landmark.story.archive && (
            <CareerArchive archive={landmark.story.archive} />
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
          <ContactPanel
            landmark={landmark}
            journeyCompleted={journeyCompleted}
            onContactAction={onContactAction}
            onCompleteJourney={onCompleteJourney}
          />

          <footer className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#143d42]/20 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="journey-primary-button"
            >
              <IconBook2 aria-hidden="true" size={16} />
              {returnLabel}
            </button>
            <button
              type="button"
              onClick={() => onSetDestination(landmark)}
              className="inline-flex min-h-11 items-center gap-2 border border-[#143d42]/30 px-4 text-sm font-semibold hover:bg-[#e9ddc6]"
            >
              <IconBriefcase aria-hidden="true" size={16} />
              Set as destination
            </button>
          </footer>
        </article>
      </div>
    </div>
  )
}
