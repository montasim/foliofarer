import type { JourneyLandmarkId } from "@/lib/journey/types"
import type { JourneyWorldRuntimeEvent } from "@/lib/journey-v2/runtime/types"

export type JourneyCheckpointRuntimeEvent = Extract<
  JourneyWorldRuntimeEvent,
  {
    type: "nearby-landmark" | "landmark-left" | "landmark-arrival"
  }
>

export interface JourneyCheckpointUiState {
  nearbyLandmarkId: JourneyLandmarkId | null
  nearbyRuntimeId: string | null
}

export interface JourneyCheckpointUiTransition {
  state: JourneyCheckpointUiState
  arrivedLandmarkId: JourneyLandmarkId | null
}

export const EMPTY_JOURNEY_CHECKPOINT_UI_STATE: JourneyCheckpointUiState = {
  nearbyLandmarkId: null,
  nearbyRuntimeId: null,
}

export function resolveCanonicalJourneyLandmarkId(
  canonicalLandmarkIds: ReadonlySet<string>,
  ...candidateIds: ReadonlyArray<string | null | undefined>
): JourneyLandmarkId | null {
  for (const id of candidateIds) {
    if (id && canonicalLandmarkIds.has(id)) return id
  }
  return null
}

export function reduceJourneyCheckpointEvent(
  current: JourneyCheckpointUiState,
  event: JourneyCheckpointRuntimeEvent,
  canonicalLandmarkIds: ReadonlySet<string>
): JourneyCheckpointUiTransition {
  if (event.type === "nearby-landmark") {
    const landmarkId = resolveCanonicalJourneyLandmarkId(
      canonicalLandmarkIds,
      event.recordId,
      event.id
    )
    if (!landmarkId) return { state: current, arrivedLandmarkId: null }
    return {
      state: {
        nearbyLandmarkId: landmarkId,
        nearbyRuntimeId: event.id,
      },
      arrivedLandmarkId: null,
    }
  }

  if (event.type === "landmark-left") {
    const landmarkId = resolveCanonicalJourneyLandmarkId(
      canonicalLandmarkIds,
      event.id
    )
    const leftCurrentLandmark =
      event.id === current.nearbyRuntimeId ||
      landmarkId === current.nearbyLandmarkId
    return {
      state: leftCurrentLandmark ? EMPTY_JOURNEY_CHECKPOINT_UI_STATE : current,
      arrivedLandmarkId: null,
    }
  }

  const landmarkId = resolveCanonicalJourneyLandmarkId(
    canonicalLandmarkIds,
    event.id
  )
  if (!landmarkId) return { state: current, arrivedLandmarkId: null }
  return {
    state: {
      nearbyLandmarkId: landmarkId,
      nearbyRuntimeId:
        current.nearbyLandmarkId === landmarkId && current.nearbyRuntimeId
          ? current.nearbyRuntimeId
          : event.id,
    },
    arrivedLandmarkId: landmarkId,
  }
}
