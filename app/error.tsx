"use client"

import * as React from "react"
import Link from "next/link"

import { PORTFOLIO_URL } from "@/lib/portfolio-url"

export default function JourneyError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error("Journey runtime failed", error)
  }, [error])

  return (
    <main className="journey-shell fixed inset-0 z-[100] flex items-center justify-center bg-[var(--journey-sky)] p-5 text-[var(--journey-ink)]">
      <section className="journey-story-sheet w-full max-w-lg p-6 sm:p-8" aria-labelledby="journey-error-title">
        <p className="journey-kicker mt-5">Journey unavailable</p>
        <h1 id="journey-error-title" className="mt-2 font-[family-name:var(--font-journey-display)] text-4xl leading-none font-semibold">
          The journey could not finish opening.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[var(--journey-copy)]">
          Retry the Journey Experience, or continue through the standard portfolio.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="journey-primary-button" onClick={reset}>
            Retry Journey
          </button>
          <Link href={PORTFOLIO_URL} className="journey-tool-button" aria-label="Return to standard portfolio">
            Standard portfolio
          </Link>
        </div>
      </section>
    </main>
  )
}
