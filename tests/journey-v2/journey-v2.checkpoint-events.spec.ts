import { expect, test } from "@playwright/test"
import {
  EMPTY_JOURNEY_CHECKPOINT_UI_STATE,
  reduceJourneyCheckpointEvent,
  resolveCanonicalJourneyLandmarkId,
} from "../../lib/journey-v2/ui/checkpoint-events"

const CANONICAL_CHECKPOINTS = [
  "town-square",
  "rangpur-zilla-school",
  "carmichael-college",
  "baust",
  "codez-info-tech",
  "drra",
  "multiversal-software",
  "mymedicalhub",
  "learning-library",
  "project-workshop",
  "community-hall",
  "contact-pavilion",
] as const

const CANONICAL_CHECKPOINT_IDS = new Set<string>(CANONICAL_CHECKPOINTS)

test("all 12 checkpoint events resolve to canonical portfolio records", () => {
  for (const recordId of CANONICAL_CHECKPOINTS) {
    const checkpointId = `checkpoint-${recordId}`
    const nearby = reduceJourneyCheckpointEvent(
      EMPTY_JOURNEY_CHECKPOINT_UI_STATE,
      {
        type: "nearby-landmark",
        id: checkpointId,
        checkpointId,
        recordId,
        distance: 3,
      },
      CANONICAL_CHECKPOINT_IDS
    )

    expect(nearby.state).toEqual({
      nearbyLandmarkId: recordId,
      nearbyRuntimeId: checkpointId,
    })
    expect(nearby.arrivedLandmarkId).toBeNull()

    const arrival = reduceJourneyCheckpointEvent(
      nearby.state,
      {
        type: "landmark-arrival",
        id: recordId,
        distance: 2,
      },
      CANONICAL_CHECKPOINT_IDS
    )
    expect(arrival.state.nearbyLandmarkId).toBe(recordId)
    expect(arrival.arrivedLandmarkId).toBe(recordId)

    const left = reduceJourneyCheckpointEvent(
      arrival.state,
      {
        type: "landmark-left",
        id: checkpointId,
      },
      CANONICAL_CHECKPOINT_IDS
    )
    expect(left.state).toEqual(EMPTY_JOURNEY_CHECKPOINT_UI_STATE)
    expect(left.arrivedLandmarkId).toBeNull()
  }
})

test("only canonical physical-arrival events authorize a Passport stamp", () => {
  const nearby = reduceJourneyCheckpointEvent(
    EMPTY_JOURNEY_CHECKPOINT_UI_STATE,
    {
      type: "nearby-landmark",
      id: "checkpoint-project-workshop",
      recordId: "project-workshop",
      distance: 3,
    },
    CANONICAL_CHECKPOINT_IDS
  )
  const left = reduceJourneyCheckpointEvent(
    nearby.state,
    {
      type: "landmark-left",
      id: "checkpoint-project-workshop",
    },
    CANONICAL_CHECKPOINT_IDS
  )
  const unknownArrival = reduceJourneyCheckpointEvent(
    nearby.state,
    {
      type: "landmark-arrival",
      id: "forged-place",
      distance: 1,
    },
    CANONICAL_CHECKPOINT_IDS
  )

  expect(nearby.arrivedLandmarkId).toBeNull()
  expect(left.arrivedLandmarkId).toBeNull()
  expect(unknownArrival.arrivedLandmarkId).toBeNull()
  expect(
    resolveCanonicalJourneyLandmarkId(CANONICAL_CHECKPOINT_IDS, "forged-place")
  ).toBeNull()
})
