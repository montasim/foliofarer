export interface SocialLink {
  platform: string
  url: string
  label: string
}

export interface PortfolioRecord {
  id: string
}

export interface Profile {
  name: string
  title: string
  tagline: string
  avatarUrl: string
  resumeUrl: string
  location: string
  email: string
  about: string
  socialLinks: SocialLink[]
}

export interface Experience extends PortfolioRecord {
  company: string
  companyUrl: string
  logo: string
  logoUrl?: string
  location: string
  period: string
  role: string
  description: string
  technologies: string[]
}

export interface Education extends PortfolioRecord {
  institution: string
  institutionUrl: string
  logo: string
  logoUrl?: string
  degree: string
  period: string
  details: string
  highlights: string[]
}

export interface SkillCategory extends PortfolioRecord {
  category: string
  items: string[]
}

export type ProjectType = "website" | "extension" | "package"

export interface Project extends PortfolioRecord {
  type: ProjectType
  title: string
  description: string
  technologies: string[]
  liveUrl: string
  githubUrl: string
  releaseUrl?: string
  npmUrl: string
  emoji: string
}

export interface Certification extends PortfolioRecord {
  year: string
  title: string
  description: string
  url: string
}

export interface Publication {
  title: string
  venue: string
  year: string
  authors: string
  url: string
  tags: string[]
}

export interface Volunteering extends PortfolioRecord {
  organization: string
  organizationUrl: string
  logo: string
  logoUrl?: string
  location: string
  period: string
  role: string
  description: string
}

export interface Organization extends PortfolioRecord {
  name: string
  url: string
  associatedWith: string
  period: string
  role: string
  description: string
  logo: string
  logoUrl?: string
}

export interface Recommendation {
  name: string
  role: string
  date: string
  relationship: string
  text: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}
