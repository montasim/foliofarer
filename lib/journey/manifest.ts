import {
  getEducation,
  getExperience,
  getOrganizations,
  getProfile,
  getVolunteering,
} from "@/lib/data"
import type { Experience } from "@/lib/types"
import type {
  JourneyArchiveEntry,
  JourneyLandmark,
  JourneyLandmarkId,
} from "@/lib/journey/types"
import {
  JOURNEY_LEARNING_ARCHIVE,
  JOURNEY_LEARNING_EVIDENCE_COUNT,
  JOURNEY_LEARNING_RECORD_IDS,
} from "@/lib/journey/learning"
import {
  JOURNEY_PROJECT_ARCHIVE,
  JOURNEY_PROJECT_RECORD_IDS,
} from "@/lib/journey/projects"
import {
  JOURNEY_COMMUNITY_ARCHIVE,
  JOURNEY_COMMUNITY_RECORD_IDS,
} from "@/lib/journey/community"
import { JOURNEY_CONVERSATION } from "@/lib/journey/contact"
import { JOURNEY_LANDMARK_LAYOUTS } from "@/lib/journey/world-layout"

const profile = getProfile()
const education = getEducation()
const experience = getExperience()
const volunteering = getVolunteering()
const organizations = getOrganizations()

function requireRecord<T extends { id: string }>(
  records: T[],
  id: string,
  collection: string
) {
  const record = records.find((candidate) => candidate.id === id)
  if (!record)
    throw new Error(`Journey record ${id} is missing from ${collection}`)
  return record
}

const rangpurZillaSchool = requireRecord(
  education,
  "education-rangpur-zilla-school",
  "education"
)
const carmichaelCollege = requireRecord(
  education,
  "education-carmichael-college",
  "education"
)
const baust = requireRecord(education, "education-baust", "education")
const schoolOrganizer = requireRecord(
  volunteering,
  "volunteering-rangpur-zilla-school-event-organizer",
  "volunteering"
)
const collegeOrganizer = requireRecord(
  volunteering,
  "volunteering-carmichael-event-organizer",
  "volunteering"
)
const bncc = requireRecord(organizations, "organization-bncc", "organizations")
const careerClub = requireRecord(
  organizations,
  "organization-baust-career-club",
  "organizations"
)
const programmingClub = requireRecord(
  organizations,
  "organization-baust-programming-club",
  "organizations"
)

const codezRole = requireRecord(
  experience,
  "experience-codez-web-developer",
  "experience"
)
const drraMisRole = requireRecord(
  experience,
  "experience-drra-mis-officer",
  "experience"
)
const drraInstructorRole = requireRecord(
  experience,
  "experience-drra-computer-instructor",
  "experience"
)
const multiversalRole = requireRecord(
  experience,
  "experience-multiversal-junior-frontend-developer",
  "experience"
)
const myMedicalHubJuniorRole = requireRecord(
  experience,
  "experience-mymedicalhub-junior-software-engineer",
  "experience"
)
const myMedicalHubEngineerRole = requireRecord(
  experience,
  "experience-mymedicalhub-software-engineer",
  "experience"
)
const myMedicalHubSeniorRole = requireRecord(
  experience,
  "experience-mymedicalhub-senior-software-engineer",
  "experience"
)

function careerArchiveEntry(role: Experience): JourneyArchiveEntry {
  return {
    recordId: role.id,
    title: role.role,
    subtitle: `${role.company} · ${role.location}`,
    period: role.period,
    body: role.description,
    tags: role.technologies,
  }
}

function careerArchive(roles: readonly Experience[]) {
  return {
    eyebrow: "Career archive",
    title: roles.length === 1 ? "Role record" : "Role progression",
    description:
      "Responsibilities, outcomes, and technologies are presented in chronological order.",
    entries: roles.map(careerArchiveEntry),
  } as const
}

export const JOURNEY_LANDMARKS: readonly JourneyLandmark[] = [
  {
    id: "town-square",
    recordId: null,
    district: "about",
    title: "Montasim's Town Square",
    shortTitle: "Town Square",
    position: JOURNEY_LANDMARK_LAYOUTS["town-square"].checkpointPosition,
    routeOrder: 0,
    story: {
      eyebrow: "Welcome to my journey",
      title: `I'm ${profile.name.split(" ")[1] ?? "Montasim"}.`,
      body: "I build software for the moments when real systems are under pressure—not only for the happy path. This town turns my education, work, learning, projects, and community service into a journey you can follow or explore in your own order.",
      facts: [
        profile.title,
        profile.location,
        "3+ years building production software",
      ],
    },
  },
  {
    id: "rangpur-zilla-school",
    recordId: rangpurZillaSchool.id,
    district: "education",
    title: rangpurZillaSchool.institution,
    shortTitle: "Rangpur Zilla School",
    position:
      JOURNEY_LANDMARK_LAYOUTS["rangpur-zilla-school"].checkpointPosition,
    routeOrder: 1,
    story: {
      eyebrow: "Education · First chapter",
      title: "Where my curiosity took root.",
      body: "Rangpur Zilla School is where my science journey began. Those formative years gave me the discipline to keep asking how things work—a habit that later became the foundation of my life in software engineering.",
      facts: [
        rangpurZillaSchool.degree,
        rangpurZillaSchool.period,
        rangpurZillaSchool.details,
      ],
      connections: [
        {
          recordId: bncc.id,
          label: "Organization",
          title: bncc.name,
          detail: `${bncc.role} · ${bncc.period}`,
        },
        {
          recordId: schoolOrganizer.id,
          label: "Volunteering",
          title: schoolOrganizer.role,
          detail: `${schoolOrganizer.organization} · ${schoolOrganizer.period}`,
        },
      ],
    },
  },
  {
    id: "carmichael-college",
    recordId: carmichaelCollege.id,
    district: "education",
    title: carmichaelCollege.institution,
    shortTitle: "Carmichael College",
    position: JOURNEY_LANDMARK_LAYOUTS["carmichael-college"].checkpointPosition,
    routeOrder: 2,
    story: {
      eyebrow: "Education · Second chapter",
      title: "Science became a direction.",
      body: "At Carmichael College, physics, chemistry, and mathematics turned broad curiosity into a more deliberate path. It was also a place to practice responsibility beyond the classroom by organizing shared experiences for the college community.",
      facts: [
        carmichaelCollege.degree,
        carmichaelCollege.period,
        carmichaelCollege.details,
      ],
      connections: [
        {
          recordId: collegeOrganizer.id,
          label: "Volunteering",
          title: collegeOrganizer.role,
          detail: `${collegeOrganizer.organization} · ${collegeOrganizer.period}`,
        },
      ],
    },
  },
  {
    id: "baust",
    recordId: baust.id,
    district: "education",
    title: baust.institution,
    shortTitle: "BAUST",
    position: JOURNEY_LANDMARK_LAYOUTS.baust.checkpointPosition,
    routeOrder: 3,
    story: {
      eyebrow: "Education · Third chapter",
      title: "Curiosity became engineering.",
      body: "At BAUST, I turned a science foundation into practical software engineering. Computer science fundamentals, programming communities, and career-focused collaboration gave me the tools and habits I now bring to production systems.",
      facts: [baust.degree, baust.period, baust.details],
      connections: [
        {
          recordId: programmingClub.id,
          label: "Organization",
          title: programmingClub.name,
          detail: programmingClub.role,
        },
        {
          recordId: careerClub.id,
          label: "Organization",
          title: careerClub.name,
          detail: careerClub.role,
        },
      ],
    },
  },
  {
    id: "codez-info-tech",
    recordId: codezRole.id,
    recordIds: [codezRole.id],
    district: "career",
    title: codezRole.company,
    shortTitle: "Codez Info Tech",
    position: JOURNEY_LANDMARK_LAYOUTS["codez-info-tech"].checkpointPosition,
    routeOrder: 4,
    story: {
      eyebrow: "Career · First chapter",
      title: "The first production foundation.",
      body: "At Codez Info Tech, client requirements became working web applications. Building, maintaining, and testing those systems established the practical foundation for every role that followed.",
      facts: [codezRole.period, codezRole.location, "1 role in this office"],
      archive: careerArchive([codezRole]),
    },
  },
  {
    id: "drra",
    recordId: drraMisRole.id,
    recordIds: [drraMisRole.id, drraInstructorRole.id],
    district: "career",
    title: drraMisRole.company,
    shortTitle: "DRRA",
    position: JOURNEY_LANDMARK_LAYOUTS.drra.checkpointPosition,
    routeOrder: 5,
    story: {
      eyebrow: "Career · Second chapter",
      title: "Technology became service.",
      body: "At DRRA, reliable systems and patient teaching mattered for the same reason: they helped people keep learning. The work joined IT operations, information management, curriculum delivery, and hands-on instruction.",
      facts: [
        "Dec 2021 - Aug 2022",
        drraMisRole.location,
        "2 connected roles in this office",
      ],
      archive: careerArchive([drraMisRole, drraInstructorRole]),
    },
  },
  {
    id: "multiversal-software",
    recordId: multiversalRole.id,
    recordIds: [multiversalRole.id],
    district: "career",
    title: multiversalRole.company,
    shortTitle: "Multiversal",
    position:
      JOURNEY_LANDMARK_LAYOUTS["multiversal-software"].checkpointPosition,
    routeOrder: 6,
    story: {
      eyebrow: "Career · Third chapter",
      title: "Frontend craft met healthcare.",
      body: "Multiversal brought product-facing frontend work into focus. Building responsive telemedicine interfaces and improving their loading behavior connected interface quality with real healthcare use.",
      facts: [
        multiversalRole.period,
        multiversalRole.location,
        "1 role in this studio",
      ],
      archive: careerArchive([multiversalRole]),
    },
  },
  {
    id: "mymedicalhub",
    recordId: myMedicalHubJuniorRole.id,
    recordIds: [
      myMedicalHubJuniorRole.id,
      myMedicalHubEngineerRole.id,
      myMedicalHubSeniorRole.id,
    ],
    district: "career",
    title: myMedicalHubSeniorRole.company,
    shortTitle: "MyMedicalHub",
    position: JOURNEY_LANDMARK_LAYOUTS.mymedicalhub.checkpointPosition,
    routeOrder: 7,
    story: {
      eyebrow: "Career · Current chapter",
      title: "From features to resilient systems.",
      body: "MyMedicalHub is a continuous progression from junior engineer to senior engineer. The work moved from secure real-time healthcare features into platform performance, cloud efficiency, and deterministic AI systems built for production pressure.",
      facts: [
        "Sep 2022 - Present",
        myMedicalHubSeniorRole.location,
        "3 chronological roles in this campus",
      ],
      archive: careerArchive([
        myMedicalHubJuniorRole,
        myMedicalHubEngineerRole,
        myMedicalHubSeniorRole,
      ]),
    },
  },
  {
    id: "learning-library",
    recordId: "skills-frontend",
    recordIds: JOURNEY_LEARNING_RECORD_IDS,
    district: "learning",
    title: "Learning Library",
    shortTitle: "Learning Library",
    position: JOURNEY_LANDMARK_LAYOUTS["learning-library"].checkpointPosition,
    routeOrder: 8,
    story: {
      eyebrow: "Learning · Current practice",
      title: "Learning becomes useful when it travels.",
      body: "This library organizes technology by how it is used, not by a score or a wall of logos. Six rooms connect ongoing study and certifications to the roles and projects where each capability became practical.",
      facts: [
        `${JOURNEY_LEARNING_ARCHIVE.rooms.length} technology rooms`,
        `${JOURNEY_LEARNING_ARCHIVE.certifications.length} certification records`,
        `${JOURNEY_LEARNING_EVIDENCE_COUNT} connected jobs and projects`,
      ],
      learningArchive: JOURNEY_LEARNING_ARCHIVE,
    },
  },
  {
    id: "project-workshop",
    recordId: JOURNEY_PROJECT_ARCHIVE.featured[0].recordId,
    recordIds: JOURNEY_PROJECT_RECORD_IDS,
    district: "projects",
    title: "Project Workshop",
    shortTitle: "Project Workshop",
    position: JOURNEY_LANDMARK_LAYOUTS["project-workshop"].checkpointPosition,
    routeOrder: 9,
    story: {
      eyebrow: "Projects · Built in practice",
      title: "Ideas earn their place by working.",
      body: "The workshop is where problems, decisions, and outcomes sit side by side. Five projects are opened up as working exhibits, while the archive keeps the complete body of work available without giving every record another building.",
      facts: [
        `${JOURNEY_PROJECT_ARCHIVE.featured.length} curated physical exhibits`,
        `${JOURNEY_PROJECT_ARCHIVE.records.length} projects in the complete archive`,
        "Live, source, package, and release destinations are shown only when available",
      ],
      projectArchive: JOURNEY_PROJECT_ARCHIVE,
    },
  },
  {
    id: "community-hall",
    recordId: JOURNEY_COMMUNITY_RECORD_IDS[0],
    recordIds: JOURNEY_COMMUNITY_RECORD_IDS,
    district: "community",
    title: "Community Hall",
    shortTitle: "Community Hall",
    position: JOURNEY_LANDMARK_LAYOUTS["community-hall"].checkpointPosition,
    routeOrder: 10,
    story: {
      eyebrow: "Community · Shared work",
      title: "Contribution grows through other people.",
      body: "The Community Hall gathers the service, organizing, and student communities that developed beside my formal education. The complete accounts live here; their school, college, and university chapters point back to the same records rather than telling them twice.",
      facts: [
        `${JOURNEY_COMMUNITY_ARCHIVE.groups.length} contribution groups`,
        `${JOURNEY_COMMUNITY_RECORD_IDS.length} canonical community records`,
        "3 connected Education landmarks",
      ],
      communityArchive: JOURNEY_COMMUNITY_ARCHIVE,
    },
  },
  {
    id: "contact-pavilion",
    recordId: null,
    district: "contact",
    title: "Contact Pavilion",
    shortTitle: "Contact Pavilion",
    position: JOURNEY_LANDMARK_LAYOUTS["contact-pavilion"].checkpointPosition,
    routeOrder: 11,
    story: {
      eyebrow: "Contact · Final destination",
      title: "The guided road ends with an open door.",
      body: "This quiet pavilion closes the chronological route without closing the town. Start a conversation if my experience fits what you are building, end the guided journey when you are ready, or keep exploring every district in your own order.",
      facts: [
        "Email is the primary conversation channel",
        "LinkedIn and résumé remain directly available",
        "Ending the journey never restricts free exploration",
      ],
      conversation: JOURNEY_CONVERSATION,
    },
  },
] as const

export const JOURNEY_LANDMARK_BY_ID = Object.fromEntries(
  JOURNEY_LANDMARKS.map((landmark) => [landmark.id, landmark])
) as Record<JourneyLandmarkId, JourneyLandmark>

export const JOURNEY_LANDMARKS_BY_ROUTE = [...JOURNEY_LANDMARKS].sort(
  (first, second) => first.routeOrder - second.routeOrder
)

export const JOURNEY_EDUCATION_LANDMARKS = JOURNEY_LANDMARKS.filter(
  (landmark) => landmark.district === "education"
)

export const JOURNEY_CAREER_LANDMARKS = JOURNEY_LANDMARKS.filter(
  (landmark) => landmark.district === "career"
)

export const JOURNEY_LEARNING_LANDMARKS = JOURNEY_LANDMARKS.filter(
  (landmark) => landmark.district === "learning"
)

export const JOURNEY_PROJECT_LANDMARKS = JOURNEY_LANDMARKS.filter(
  (landmark) => landmark.district === "projects"
)

export const JOURNEY_COMMUNITY_LANDMARKS = JOURNEY_LANDMARKS.filter(
  (landmark) => landmark.district === "community"
)

export const JOURNEY_CONTACT_LANDMARKS = JOURNEY_LANDMARKS.filter(
  (landmark) => landmark.district === "contact"
)

export function getNextJourneyLandmark(
  currentId: JourneyLandmarkId,
  discoveredIds: ReadonlySet<JourneyLandmarkId>
) {
  const nextAfterCurrent = JOURNEY_LANDMARKS_BY_ROUTE.find(
    (landmark) =>
      landmark.routeOrder > JOURNEY_LANDMARK_BY_ID[currentId].routeOrder
  )
  return (
    nextAfterCurrent ??
    JOURNEY_LANDMARKS_BY_ROUTE.find(
      (landmark) => !discoveredIds.has(landmark.id)
    ) ??
    JOURNEY_LANDMARK_BY_ID[currentId]
  )
}

export function getSuggestedJourneyLandmark(
  discoveredIds: ReadonlySet<JourneyLandmarkId>,
  fallback: JourneyLandmark
) {
  return (
    JOURNEY_LANDMARKS_BY_ROUTE.find(
      (landmark) => !discoveredIds.has(landmark.id)
    ) ?? fallback
  )
}
