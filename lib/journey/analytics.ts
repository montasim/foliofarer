type JourneyEvent =
  | "journey_entrance_opened"
  | "journey_started"
  | "journey_landmark_encountered"
  | "journey_assisted_travel_started"
  | "journey_destination_changed"
  | "journey_contact_action"
  | "journey_completed"
  | "journey_webgl_unavailable"
  | "journey_performance_summary"

declare global {
  interface Window {
    gtag?: (
      command: "event",
      eventName: string,
      parameters?: Record<string, unknown>
    ) => void
  }
}

export function trackJourneyEvent(
  event: JourneyEvent,
  parameters?: Record<string, unknown>
) {
  if (typeof window === "undefined") return
  window.gtag?.("event", event, parameters)
}
