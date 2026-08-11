import { getExperience, getProjects } from "@/lib/data"
import {
  JOURNEY_LEARNING_ARCHIVE,
  normalizeJourneyTechnology,
} from "@/lib/journey/learning"
import type {
  JourneyProjectArchive,
  JourneyProjectConnection,
  JourneyProjectExhibit,
  JourneyProjectLink,
  JourneyProjectRecord,
} from "@/lib/journey/types"
import type { Project } from "@/lib/types"

interface FeaturedProjectEditorial {
  recordId: string
  problem: string
  solution: string
  outcome: string
  careerRecordIds: readonly string[]
}

const FEATURED_PROJECTS: readonly FeaturedProjectEditorial[] = [
  {
    recordId: "project-patient-portal",
    problem:
      "Patients need one secure path through biometric assessment, intake, reports, and provider access across different tenant configurations.",
    solution:
      "A unified healthcare portal combines MediaPipe assessment, AI-guided intake, clinical reporting, and WebRTC telemedicine in a tenant-aware workflow.",
    outcome:
      "A HIPAA-compliant patient journey spanning assessment, intake, reporting, and live provider connection in one product surface.",
    careerRecordIds: [
      "experience-mymedicalhub-junior-software-engineer",
      "experience-mymedicalhub-software-engineer",
      "experience-mymedicalhub-senior-software-engineer",
    ],
  },
  {
    recordId: "project-telemedicine-microservice",
    problem:
      "Remote physical therapy needs live clinical communication, movement assessment, and repetition feedback without losing multi-tenant boundaries.",
    solution:
      "A real-time rehabilitation application joins WebRTC video, Socket.io events, clinical movement workflows, and AI-assisted repetition counting.",
    outcome:
      "Remote rehabilitation sessions can combine provider consultation and movement feedback inside a purpose-built healthcare workflow.",
    careerRecordIds: [
      "experience-mymedicalhub-software-engineer",
      "experience-mymedicalhub-senior-software-engineer",
    ],
  },
  {
    recordId: "project-re-annotation-microservice",
    problem:
      "Captured range-of-motion measurements sometimes require clinical correction without asking the patient to repeat the assessment.",
    solution:
      "An interactive Canvas and Konva workflow lets providers adjust angle overlays and persist corrected measurements through a REST API.",
    outcome:
      "Providers can review and correct captured movement evidence while preserving the original assessment workflow.",
    careerRecordIds: [
      "experience-mymedicalhub-software-engineer",
      "experience-mymedicalhub-senior-software-engineer",
    ],
  },
  {
    recordId: "project-postcraft",
    problem:
      "Producing consistent social content across platforms requires more than generation: variants need evaluation, brand safeguards, and reliable scheduling.",
    solution:
      "Gemini-powered variant generation, engagement scoring, brand guardrails, trend analysis, and Inngest jobs form one publishing workflow.",
    outcome:
      "Content teams can move from idea to evaluated, brand-aware, scheduled variants in a single application.",
    careerRecordIds: [],
  },
  {
    recordId: "project-devtools",
    problem:
      "Common developer utilities are fragmented, and many simple transformations unnecessarily send sensitive input to remote services.",
    solution:
      "A privacy-first suite runs most of 40+ tools in the browser while 20 backend routes support authentication, saved state, short links, and controlled sharing.",
    outcome:
      "Frequently used development utilities share one consistent interface, with local processing by default and account features where they add value.",
    careerRecordIds: [],
  },
] as const

const projects = getProjects()
const experienceById = new Map(
  getExperience().map((role) => [role.id, role] as const)
)
const featuredById = new Map(
  FEATURED_PROJECTS.map((entry) => [entry.recordId, entry] as const)
)

function projectShortTitle(title: string) {
  return title.split(" — ")[0]
}

function projectLinks(project: Project): JourneyProjectLink[] {
  return [
    project.liveUrl
      ? {
          kind: "Live" as const,
          label: "Open live project",
          url: project.liveUrl,
        }
      : null,
    project.githubUrl
      ? {
          kind: "Source" as const,
          label: "View source",
          url: project.githubUrl,
        }
      : null,
    project.npmUrl
      ? { kind: "Package" as const, label: "View package", url: project.npmUrl }
      : null,
    project.releaseUrl
      ? {
          kind: "Release" as const,
          label: "View latest release",
          url: project.releaseUrl,
        }
      : null,
  ].filter((link): link is JourneyProjectLink => link !== null)
}

function learningConnections(project: Project): JourneyProjectConnection[] {
  const projectTechnologies = new Set(
    project.technologies.map(normalizeJourneyTechnology)
  )
  return JOURNEY_LEARNING_ARCHIVE.rooms
    .filter((room) =>
      room.technologies.some((technology) =>
        projectTechnologies.has(normalizeJourneyTechnology(technology))
      )
    )
    .map((room) => ({
      recordId: `learning-room-${room.id}`,
      kind: "Learning room" as const,
      title: room.title,
    }))
}

function careerConnections(
  recordIds: readonly string[]
): JourneyProjectConnection[] {
  return recordIds.flatMap((recordId) => {
    const role = experienceById.get(recordId)
    return role
      ? [
          {
            recordId,
            kind: "Career" as const,
            title: `${role.role} · ${role.company}`,
          },
        ]
      : []
  })
}

function projectRecord(project: Project): JourneyProjectRecord {
  const editorial = featuredById.get(project.id)
  return {
    recordId: project.id,
    title: project.title,
    shortTitle: projectShortTitle(project.title),
    description: project.description,
    technologies: project.technologies,
    links: projectLinks(project),
    connections: [
      ...learningConnections(project),
      ...careerConnections(editorial?.careerRecordIds ?? []),
    ],
  }
}

const records = projects.map(projectRecord)
const recordById = new Map(records.map((record) => [record.recordId, record]))

const featured: JourneyProjectExhibit[] = FEATURED_PROJECTS.map((editorial) => {
  const record = recordById.get(editorial.recordId)
  if (!record) {
    throw new Error(
      `Journey project ${editorial.recordId} is missing from projects`
    )
  }
  return { ...record, ...editorial }
})

export const JOURNEY_PROJECT_ARCHIVE: JourneyProjectArchive = {
  eyebrow: "Project archive",
  title: "Built work, inspected closely",
  description:
    "Five curated exhibits explain the work in depth. The complete archive keeps every other project searchable without turning the town into a building catalog.",
  featured,
  records,
}

export const JOURNEY_PROJECT_RECORD_IDS = records.map(
  (record) => record.recordId
)
