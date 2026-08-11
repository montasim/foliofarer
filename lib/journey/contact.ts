import { getProfile } from "@/lib/data"
import type { JourneyConversation } from "@/lib/journey/types"

const profile = getProfile()
const linkedInUrl = profile.socialLinks.find(
  (link) => link.platform.toLocaleLowerCase() === "linkedin"
)?.url

if (!linkedInUrl) {
  throw new Error("The Contact Pavilion requires a LinkedIn profile URL")
}

export const JOURNEY_CONVERSATION: JourneyConversation = {
  eyebrow: "Direct contact",
  title: "Start a conversation",
  description:
    "If the work you have seen connects with a problem you are solving, choose the channel that suits you. Email is the clearest place to begin.",
  actions: [
    {
      kind: "Email",
      label: "Start a conversation",
      detail: profile.email,
      url: `mailto:${profile.email}?subject=${encodeURIComponent("A conversation about your work")}`,
      primary: true,
    },
    {
      kind: "LinkedIn",
      label: "Connect on LinkedIn",
      detail: "Professional profile and direct message",
      url: linkedInUrl,
    },
    {
      kind: "Résumé",
      label: "Open résumé",
      detail: "A concise record of experience and education",
      url: profile.resumeUrl,
    },
  ],
}
