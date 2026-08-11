import { expect, test } from "@playwright/test"
import { openReadyJourney } from "./journey-test-helpers"

test.describe("Journey visual contract", () => {
  test("desktop overview remains stable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReadyJourney(page, "high")
    await expect(
      page.getByRole("button", { name: /Journey passport/ })
    ).toHaveAccessibleName("Journey passport, 0 of 12 stories discovered")

    await expect(page).toHaveScreenshot("journey-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.012,
      timeout: 15_000,
    })
  })

  test("mobile overview remains stable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openReadyJourney(page, "low")

    await expect(page).toHaveScreenshot("journey-mobile.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.018,
      timeout: 15_000,
    })
  })
})
