"use client"

import * as React from "react"
import Link from "next/link"
import { IconRoute2 } from "@tabler/icons-react"
import { trackJourneyEvent } from "@/lib/journey/analytics"
import { JOURNEY_START_MARK_KEY } from "@/lib/journey/performance"

export function JourneyLauncher() {
  React.useEffect(() => {
    document.body.classList.add("journey-launcher-present")
    return () => document.body.classList.remove("journey-launcher-present")
  }, [])

  return (
    <Link
      href="/journey"
      prefetch={false}
      onClick={() => {
        try {
          window.sessionStorage.setItem(
            JOURNEY_START_MARK_KEY,
            String(performance.now())
          )
        } catch {
          // Performance measurement falls back to navigation start.
        }
        trackJourneyEvent("journey_entrance_opened")
      }}
      className="group fixed right-4 bottom-21 z-50 flex h-11 items-center gap-2 rounded-full border border-foreground/10 bg-background/92 px-3.5 text-sm font-medium text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:right-6 sm:bottom-24 sm:h-12 sm:px-4"
      aria-label="Open Montasim's 3D journey"
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:rotate-6">
        <IconRoute2 size={15} />
      </span>
      <span className="hidden sm:inline">View my journey</span>
    </Link>
  )
}
