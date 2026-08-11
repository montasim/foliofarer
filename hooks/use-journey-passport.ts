"use client"

import * as React from "react"
import { JOURNEY_LANDMARKS } from "@/lib/journey/manifest"
import type {
  JourneyLandmarkId,
  JourneyPassportState,
} from "@/lib/journey/types"

const STORAGE_KEY = "montasim-journey-passport-v1"
const EMPTY_PASSPORT: JourneyPassportState = {
  discoveredLandmarkIds: [],
  journeyCompleted: false,
}
const VALID_LANDMARK_IDS = new Set(
  JOURNEY_LANDMARKS.map((landmark) => landmark.id)
)

function readPassport(): JourneyPassportState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return EMPTY_PASSPORT
    const parsed = JSON.parse(stored) as Partial<JourneyPassportState>
    const discoveredLandmarkIds = Array.isArray(parsed.discoveredLandmarkIds)
      ? parsed.discoveredLandmarkIds.filter(
          (id): id is JourneyLandmarkId =>
            typeof id === "string" && VALID_LANDMARK_IDS.has(id)
        )
      : []
    return {
      discoveredLandmarkIds: [...new Set(discoveredLandmarkIds)],
      journeyCompleted: parsed.journeyCompleted === true,
    }
  } catch {
    return EMPTY_PASSPORT
  }
}

export function useJourneyPassport() {
  const [passport, setPassport] = React.useState<JourneyPassportState>(() =>
    typeof window === "undefined" ? EMPTY_PASSPORT : readPassport()
  )

  const discover = React.useCallback((id: JourneyLandmarkId) => {
    setPassport((current) => {
      if (current.discoveredLandmarkIds.includes(id)) return current
      const next = {
        ...current,
        discoveredLandmarkIds: [...current.discoveredLandmarkIds, id],
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Discovery remains available for this session when storage is blocked.
      }
      return next
    })
  }, [])

  const discoveredIds = React.useMemo(
    () => new Set(passport.discoveredLandmarkIds),
    [passport.discoveredLandmarkIds]
  )

  const completeJourney = React.useCallback(() => {
    setPassport((current) => {
      if (current.journeyCompleted) return current
      const next = { ...current, journeyCompleted: true }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Completion remains available for this session when storage is blocked.
      }
      return next
    })
  }, [])

  return { passport, discoveredIds, discover, completeJourney }
}
