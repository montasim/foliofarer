import {
  getCertifications,
  getExperience,
  getProjects,
  getSkills,
} from "@/lib/data"
import type {
  JourneyLearningArchive,
  JourneyLearningEvidence,
  JourneyLearningRoom,
} from "@/lib/journey/types"

interface LearningRoomDefinition {
  id: string
  title: string
  summary: string
  technologies: readonly string[]
}

const ROOM_DEFINITIONS: readonly LearningRoomDefinition[] = [
  {
    id: "frontend",
    title: "Frontend",
    summary:
      "Interfaces shaped through component systems, typed state, responsive layouts, accessibility, and browser testing.",
    technologies: [
      "React.js",
      "Next.js",
      "TypeScript",
      "JavaScript",
      "HTML5",
      "CSS",
      "Tailwind CSS",
      "Redux.js",
      "Responsive Web Design",
      "Jest",
      "React Testing Library",
      "Playwright",
    ],
  },
  {
    id: "backend",
    title: "Backend",
    summary:
      "Service boundaries, APIs, authentication, and maintainable server-side systems built for production use.",
    technologies: [
      "Node.js",
      "Express.js",
      "REST APIs",
      "PHP",
      "Microservices",
      "System Design",
    ],
  },
  {
    id: "databases",
    title: "Databases",
    summary:
      "Relational and document data models connected through practical query, ORM, cache, and persistence work.",
    technologies: [
      "PostgreSQL",
      "MongoDB",
      "Mongoose",
      "Prisma",
      "Redis",
      "PhpMyAdmin",
    ],
  },
  {
    id: "cloud",
    title: "Cloud",
    summary:
      "Cloud delivery, containers, automated pipelines, storage, and background work supporting reliable releases.",
    technologies: [
      "Microsoft Azure",
      "Docker",
      "GitHub Actions",
      "CI/CD",
      "AWS S3",
      "PM2",
      "Inngest",
    ],
  },
  {
    id: "ai",
    title: "AI",
    summary:
      "Applied computer vision and generative AI integrated into products with deterministic user workflows.",
    technologies: ["MediaPipe", "Gemini API"],
  },
  {
    id: "realtime",
    title: "Real-time Systems",
    summary:
      "Live communication and event-driven updates developed for healthcare, collaboration, and interactive products.",
    technologies: ["WebRTC", "Socket.io", "Opentok"],
  },
] as const

const TECHNOLOGY_ALIASES = new Map<string, string>([
  ["react 19", "react.js"],
  ["react", "react.js"],
  ["redux toolkit", "redux.js"],
  ["css3", "css"],
  ["html", "html5"],
  ["tailwind css v4", "tailwind css"],
  ["gemini flash api", "gemini api"],
])

export function normalizeJourneyTechnology(value: string) {
  const normalized = value.trim().toLowerCase()
  return TECHNOLOGY_ALIASES.get(normalized) ?? normalized
}

const skills = getSkills()
const certifications = getCertifications()
const projects = getProjects()
const experience = getExperience()

const skillRecordsByTechnology = new Map<string, Set<string>>()
for (const category of skills) {
  for (const technology of category.items) {
    const key = normalizeJourneyTechnology(technology)
    const records = skillRecordsByTechnology.get(key) ?? new Set<string>()
    records.add(category.id)
    skillRecordsByTechnology.set(key, records)
  }
}

const roomIdByTechnology = new Map<string, string>()
for (const room of ROOM_DEFINITIONS) {
  for (const technology of room.technologies) {
    roomIdByTechnology.set(normalizeJourneyTechnology(technology), room.id)
  }
}

const evidenceByRoom = new Map<string, JourneyLearningEvidence[]>()
for (const room of ROOM_DEFINITIONS) evidenceByRoom.set(room.id, [])

function indexEvidence(
  recordId: string,
  kind: JourneyLearningEvidence["kind"],
  title: string,
  detail: string,
  technologies: readonly string[]
) {
  const matchesByRoom = new Map<string, string[]>()
  for (const technology of technologies) {
    const roomId = roomIdByTechnology.get(
      normalizeJourneyTechnology(technology)
    )
    if (!roomId) continue
    const matches = matchesByRoom.get(roomId) ?? []
    matches.push(technology)
    matchesByRoom.set(roomId, matches)
  }
  for (const [roomId, matches] of matchesByRoom) {
    evidenceByRoom.get(roomId)?.push({
      recordId,
      kind,
      title,
      detail,
      technologies: matches,
    })
  }
}

for (const role of experience) {
  indexEvidence(
    role.id,
    "Career",
    `${role.role} · ${role.company}`,
    role.period,
    role.technologies
  )
}

for (const project of projects) {
  indexEvidence(
    project.id,
    "Project",
    project.title,
    project.description,
    project.technologies
  )
}

const rooms: readonly JourneyLearningRoom[] = ROOM_DEFINITIONS.map((room) => {
  const skillRecordIds = new Set<string>()
  for (const technology of room.technologies) {
    for (const recordId of skillRecordsByTechnology.get(
      normalizeJourneyTechnology(technology)
    ) ?? []) {
      skillRecordIds.add(recordId)
    }
  }
  return {
    ...room,
    skillRecordIds: [...skillRecordIds],
    evidence: evidenceByRoom.get(room.id) ?? [],
  }
})

export const JOURNEY_LEARNING_ARCHIVE: JourneyLearningArchive = {
  eyebrow: "Learning archive",
  title: "Technology rooms",
  description:
    "Each room connects a technology journey to the jobs and projects where it became practical.",
  rooms,
  certifications: certifications.map((certification) => ({
    recordId: certification.id,
    title: certification.title,
    year: certification.year,
    description: certification.description,
    url: certification.url,
  })),
}

export const JOURNEY_LEARNING_RECORD_IDS = [
  ...new Set([
    ...rooms.flatMap((room) => room.skillRecordIds),
    ...certifications.map((certification) => certification.id),
  ]),
] as const

export const JOURNEY_LEARNING_EVIDENCE_COUNT = new Set(
  rooms.flatMap((room) => room.evidence.map((evidence) => evidence.recordId))
).size
