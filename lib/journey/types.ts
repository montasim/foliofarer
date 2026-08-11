export type JourneyDistrict =
  | "about"
  | "education"
  | "career"
  | "learning"
  | "projects"
  | "community"
  | "contact"

export type JourneyLandmarkId = string

export type WorldPosition = readonly [number, number, number]
export type JourneyRenderTier = "high" | "balanced" | "low"

export type BuildingUse =
  | "institution"
  | "library"
  | "office"
  | "workshop"
  | "civic"
  | "pavilion"
  | "residential"
export type BuildingAccessType = "landmark-lane" | "residential-driveway"
export type RoadSide = -1 | 1

export interface BuildingPlot {
  id: string
  use: BuildingUse
  accessType: BuildingAccessType
  roadProgress: number
  roadSide: RoadSide
  setback: number
  footprint: readonly [width: number, depth: number]
  accessWidth: number
  buildingPosition: WorldPosition
  buildingRotationY: number
  entrancePosition: WorldPosition
  checkpointPosition: WorldPosition
  roadConnectionPosition: WorldPosition
  sidewalkCrossingPosition: WorldPosition
  sidewalkAnchorPosition: WorldPosition
  forecourtRadius: number
}

export interface JourneyStory {
  eyebrow: string
  title: string
  body: string
  facts: readonly string[]
  connections?: readonly JourneyStoryConnection[]
  archive?: JourneyArchive
  learningArchive?: JourneyLearningArchive
  projectArchive?: JourneyProjectArchive
  communityArchive?: JourneyCommunityArchive
  conversation?: JourneyConversation
}

export type JourneyContactActionKind = "Email" | "LinkedIn" | "Résumé"

export interface JourneyContactAction {
  kind: JourneyContactActionKind
  label: string
  detail: string
  url: string
  primary?: boolean
}

export interface JourneyConversation {
  eyebrow: string
  title: string
  description: string
  actions: readonly JourneyContactAction[]
}

export type JourneyCommunityContributionKind =
  | "Leadership & service"
  | "Event organizing"
  | "Student communities"

export interface JourneyCommunityEntry {
  recordId: string
  kind: JourneyCommunityContributionKind
  title: string
  role: string
  period: string
  description: string
  linkedLandmarkId: JourneyLandmarkId
  linkedLandmarkTitle: string
}

export interface JourneyCommunityGroup {
  kind: JourneyCommunityContributionKind
  summary: string
  entries: readonly JourneyCommunityEntry[]
}

export interface JourneyCommunityArchive {
  eyebrow: string
  title: string
  description: string
  groups: readonly JourneyCommunityGroup[]
}

export type JourneyProjectLinkKind = "Live" | "Source" | "Package" | "Release"

export interface JourneyProjectLink {
  kind: JourneyProjectLinkKind
  label: string
  url: string
}

export interface JourneyProjectConnection {
  recordId: string
  kind: "Learning room" | "Career"
  title: string
}

export interface JourneyProjectRecord {
  recordId: string
  title: string
  shortTitle: string
  description: string
  technologies: readonly string[]
  links: readonly JourneyProjectLink[]
  connections: readonly JourneyProjectConnection[]
}

export interface JourneyProjectExhibit extends JourneyProjectRecord {
  problem: string
  solution: string
  outcome: string
}

export interface JourneyProjectArchive {
  eyebrow: string
  title: string
  description: string
  featured: readonly JourneyProjectExhibit[]
  records: readonly JourneyProjectRecord[]
}

export type JourneyLearningEvidenceKind = "Career" | "Project"

export interface JourneyLearningEvidence {
  recordId: string
  kind: JourneyLearningEvidenceKind
  title: string
  detail: string
  technologies: readonly string[]
}

export interface JourneyLearningRoom {
  id: string
  title: string
  summary: string
  technologies: readonly string[]
  skillRecordIds: readonly string[]
  evidence: readonly JourneyLearningEvidence[]
}

export interface JourneyCertificationEntry {
  recordId: string
  title: string
  year: string
  description: string
  url: string
}

export interface JourneyLearningArchive {
  eyebrow: string
  title: string
  description: string
  rooms: readonly JourneyLearningRoom[]
  certifications: readonly JourneyCertificationEntry[]
}

export interface JourneyArchiveEntry {
  recordId: string
  title: string
  subtitle: string
  period: string
  body: string
  tags: readonly string[]
}

export interface JourneyArchive {
  eyebrow: string
  title: string
  description: string
  entries: readonly JourneyArchiveEntry[]
}

export interface JourneyStoryConnection {
  recordId: string
  label: string
  title: string
  detail: string
}

export interface JourneyLandmark {
  id: JourneyLandmarkId
  recordId: string | null
  recordIds?: readonly string[]
  district: JourneyDistrict
  title: string
  shortTitle: string
  position: WorldPosition
  routeOrder: number
  story: JourneyStory
}

export interface JourneyLandmarkLayout {
  plot: BuildingPlot | null
  buildingPosition: WorldPosition
  buildingRotationY: number
  entrancePosition: WorldPosition
  checkpointPosition: WorldPosition
  sidewalkAnchorPosition: WorldPosition
}

export interface JourneyPassportState {
  discoveredLandmarkIds: JourneyLandmarkId[]
  journeyCompleted: boolean
}

export interface JourneyPlayerPosition {
  x: number
  z: number
}

export interface AssistedRouteState {
  waypoints: readonly WorldPosition[]
  cursor: number
}

export interface MovementInput {
  x: number
  z: number
}
