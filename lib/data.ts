import profile from "@/data/profile.json"
import experience from "@/data/experience.json"
import education from "@/data/education.json"
import skills from "@/data/skills.json"
import projects from "@/data/projects.json"
import certifications from "@/data/certifications.json"
import volunteering from "@/data/volunteering.json"
import organizations from "@/data/organizations.json"
import type {
  Profile,
  Experience,
  Education,
  SkillCategory,
  Project,
  Certification,
  Volunteering,
  Organization,
} from "@/lib/types"

const socialLinkMap = Object.fromEntries(
  (profile.socialLinks as { platform: string; url: string }[]).map((l) => [l.platform, l.url]),
) as Record<string, string>

export const siteConfig = {
  url: "https://montasim.vercel.app",
  name: profile.name,
  title: `${profile.name} — ${profile.title}`,
  description: profile.tagline,
  email: profile.email,
  github: socialLinkMap.github ?? "",
  linkedin: socialLinkMap.linkedin ?? "",
} as const

export function getProfile(): Profile {
  return profile as Profile
}

export function getExperience(): Experience[] {
  return experience as Experience[]
}

export function getEducation(): Education[] {
  return education as Education[]
}

export function getSkills(): SkillCategory[] {
  return skills as SkillCategory[]
}

export function getProjects(): Project[] {
  return projects as Project[]
}

export function getCertifications(): Certification[] {
  return certifications as Certification[]
}

export function getVolunteering(): Volunteering[] {
  return volunteering as Volunteering[]
}

export function getOrganizations(): Organization[] {
  return organizations as Organization[]
}
