import type { Page } from "@playwright/test"
import type { JourneyRenderTier } from "../../lib/journey/types"

export const JOURNEY_ONBOARDING_KEY = "montasim-journey-onboarding-v1"
export const JOURNEY_PASSPORT_KEY = "montasim-journey-passport-v1"

export async function prepareJourney(
  page: Page,
  renderTier?: JourneyRenderTier
) {
  await page.addInitScript(
    ({ onboardingKey, passportKey, renderTier }) => {
      window.localStorage.setItem(onboardingKey, "complete")
      window.localStorage.setItem(
        passportKey,
        JSON.stringify({
          discoveredLandmarkIds: [],
          journeyCompleted: false,
        })
      )
      if (renderTier) window.__JOURNEY_RENDER_TIER_OVERRIDE__ = renderTier
    },
    {
      onboardingKey: JOURNEY_ONBOARDING_KEY,
      passportKey: JOURNEY_PASSPORT_KEY,
      renderTier,
    }
  )
}

export async function openReadyJourney(
  page: Page,
  renderTier?: JourneyRenderTier
) {
  await prepareJourney(page, renderTier)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/journey")
  await page.locator('main[data-scene-ready="true"]').waitFor({
    state: "visible",
    timeout: 30_000,
  })
  await page.waitForTimeout(500)
}
