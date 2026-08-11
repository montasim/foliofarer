import { getOrganizations, getVolunteering } from "@/lib/data"
import type {
  JourneyCommunityArchive,
  JourneyCommunityContributionKind,
  JourneyCommunityEntry,
  JourneyLandmarkId,
} from "@/lib/journey/types"

interface CommunityEntryDefinition {
  recordId: string
  source: "organization" | "volunteering"
  kind: JourneyCommunityContributionKind
  linkedLandmarkId: JourneyLandmarkId
  linkedLandmarkTitle: string
}

const ENTRY_DEFINITIONS: readonly CommunityEntryDefinition[] = [
  {
    recordId: "organization-bncc",
    source: "organization",
    kind: "Leadership & service",
    linkedLandmarkId: "rangpur-zilla-school",
    linkedLandmarkTitle: "Rangpur Zilla School",
  },
  {
    recordId: "volunteering-rangpur-zilla-school-event-organizer",
    source: "volunteering",
    kind: "Event organizing",
    linkedLandmarkId: "rangpur-zilla-school",
    linkedLandmarkTitle: "Rangpur Zilla School",
  },
  {
    recordId: "volunteering-carmichael-event-organizer",
    source: "volunteering",
    kind: "Event organizing",
    linkedLandmarkId: "carmichael-college",
    linkedLandmarkTitle: "Carmichael College",
  },
  {
    recordId: "organization-baust-career-club",
    source: "organization",
    kind: "Student communities",
    linkedLandmarkId: "baust",
    linkedLandmarkTitle: "BAUST",
  },
  {
    recordId: "organization-baust-programming-club",
    source: "organization",
    kind: "Student communities",
    linkedLandmarkId: "baust",
    linkedLandmarkTitle: "BAUST",
  },
] as const

const organizationsById = new Map(
  getOrganizations().map((organization) => [organization.id, organization])
)
const volunteeringById = new Map(
  getVolunteering().map((entry) => [entry.id, entry])
)

function communityEntry(
  definition: CommunityEntryDefinition
): JourneyCommunityEntry {
  if (definition.source === "organization") {
    const organization = organizationsById.get(definition.recordId)
    if (!organization) {
      throw new Error(
        `Journey community record ${definition.recordId} is missing from organizations`
      )
    }
    return {
      ...definition,
      title: organization.name,
      role: organization.role,
      period: organization.period || "During university",
      description: organization.description,
    }
  }

  const volunteering = volunteeringById.get(definition.recordId)
  if (!volunteering) {
    throw new Error(
      `Journey community record ${definition.recordId} is missing from volunteering`
    )
  }
  return {
    ...definition,
    title: volunteering.organization,
    role: volunteering.role,
    period: volunteering.period,
    description: volunteering.description,
  }
}

const entries = ENTRY_DEFINITIONS.map(communityEntry)

const GROUP_SUMMARIES: Record<JourneyCommunityContributionKind, string> = {
  "Leadership & service":
    "Discipline, teamwork, and responsibility practiced through structured service.",
  "Event organizing":
    "Shared occasions planned through volunteer coordination, budgeting, and practical delivery.",
  "Student communities":
    "Career and programming communities used for peer learning, professional growth, and collaboration.",
}

const GROUP_ORDER: readonly JourneyCommunityContributionKind[] = [
  "Leadership & service",
  "Event organizing",
  "Student communities",
]

export const JOURNEY_COMMUNITY_ARCHIVE: JourneyCommunityArchive = {
  eyebrow: "Community archive",
  title: "Contribution through shared work",
  description:
    "Five canonical records show how service, events, and student communities developed alongside the education journey that shaped them.",
  groups: GROUP_ORDER.map((kind) => ({
    kind,
    summary: GROUP_SUMMARIES[kind],
    entries: entries.filter((entry) => entry.kind === kind),
  })),
}

export const JOURNEY_COMMUNITY_RECORD_IDS = entries.map(
  (entry) => entry.recordId
)
