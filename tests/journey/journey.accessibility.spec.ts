import { expect, test } from "@playwright/test"
import { openReadyJourney } from "./journey-test-helpers"

test.setTimeout(90_000)

test("Map and Passport move focus into panels and return it to their triggers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyJourney(page, "high")

  const passportTrigger = page.getByRole("button", {
    name: /Journey passport/,
  })
  await passportTrigger.focus()
  await page.keyboard.press("Enter")
  const closePassport = page.getByRole("button", {
    name: "Close journey passport",
  })
  await expect(closePassport).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(passportTrigger).toBeFocused()

  const mapTrigger = page.getByRole("button", { name: "Expand Journey map" })
  await mapTrigger.focus()
  await page.keyboard.press("Enter")
  const closeMap = page.getByRole("button", { name: "Close journey map" })
  await expect(closeMap).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(mapTrigger).toBeFocused()

  const reducedMotionControl = page.getByRole("button", {
    name: /Auto-walk off/,
  })
  await expect(reducedMotionControl).toHaveAttribute("aria-disabled", "true")
  await reducedMotionControl.focus()
  await expect(reducedMotionControl).toBeFocused()
})

test("Story focus stays trapped, returns to Passport, and advances to completion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    window.localStorage.setItem("montasim-journey-onboarding-v1", "complete")
    window.localStorage.setItem(
      "montasim-journey-passport-v1",
      JSON.stringify({
        discoveredLandmarkIds: ["contact-pavilion"],
        journeyCompleted: false,
      })
    )
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/journey")
  await page
    .locator('main[data-scene-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })

  const passportTrigger = page.getByRole("button", {
    name: /Journey passport/,
  })
  await passportTrigger.focus()
  await page.keyboard.press("Enter")
  const contactStory = page.getByRole("button", {
    name: "Contact Pavilion, discovered story",
  })
  await contactStory.focus()
  await page.keyboard.press("Enter")

  const closeStory = page.getByRole("button", { name: "Close story" })
  await expect(closeStory).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(
    page.getByRole("button", { name: "Continue walking" })
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(passportTrigger).toBeFocused()

  await page.keyboard.press("Enter")
  await page
    .getByRole("button", { name: "Contact Pavilion, discovered story" })
    .press("Enter")
  const endJourney = page.getByRole("button", {
    name: "End guided journey",
  })
  await endJourney.focus()
  await page.keyboard.press("Enter")
  const continueExploring = page.getByRole("button", {
    name: "Continue exploring",
  })
  await expect(continueExploring).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(passportTrigger).toBeFocused()
})

test("Keyboard camera turning changes movement direction", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyJourney(page, "low")
  const journey = page.locator('main[data-scene-ready="true"]')
  const initialX = Number(await journey.getAttribute("data-player-x"))

  await page.keyboard.down("KeyJ")
  await page.waitForTimeout(650)
  await page.keyboard.up("KeyJ")
  await page.keyboard.down("KeyW")
  await page.waitForTimeout(500)
  await page.keyboard.up("KeyW")

  await expect
    .poll(async () => Number(await journey.getAttribute("data-player-x")))
    .not.toBe(initialX)
  const movedX = Number(await journey.getAttribute("data-player-x"))
  expect(Math.abs(movedX - initialX)).toBeGreaterThan(0.35)
})

test("Mobile controls expose touch-safe targets and keyboard joystick fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openReadyJourney(page, "low")

  await expect(
    page.getByRole("heading", {
      name: "Montasim's interactive portfolio journey",
    })
  ).toBeAttached()
  await expect(page.locator('[aria-hidden="true"] canvas')).toHaveCount(1)

  const joystick = page.getByRole("group", { name: "Movement joystick" })
  const controls = [
    page.getByRole("link", { name: "Return to standard portfolio" }),
    page.getByRole("button", { name: /Journey passport/ }),
    page.getByRole("button", { name: "Expand Journey map" }),
    page.getByRole("button", { name: /Auto-walk off/ }),
    joystick,
  ]
  for (const control of controls) {
    const box = await control.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  const passportBox = await controls[1].boundingBox()
  const mapBox = await controls[2].boundingBox()
  const mapPlotBox = await controls[2]
    .locator(".journey-mini-map-plot")
    .boundingBox()
  expect(mapBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(174)
  expect(mapBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(172)
  expect(mapPlotBox?.height ?? 0).toBeGreaterThanOrEqual(110)
  expect(
    Math.abs((mapBox?.y ?? 0) - (passportBox?.y ?? 0))
  ).toBeLessThanOrEqual(1)
  expect(mapBox?.x ?? 0).toBeGreaterThanOrEqual(
    (passportBox?.x ?? 0) + (passportBox?.width ?? 0) + 8
  )
  expect((mapBox?.x ?? 0) + (mapBox?.width ?? 0)).toBeLessThanOrEqual(375)

  await controls[1].click()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport).toBeVisible()
  await expect(controls[2]).toBeVisible()
  await passport.getByRole("button", { name: "Close journey passport" }).click()

  await controls[2].click()
  const atlas = page.getByRole("region", { name: "Journey map" })
  const destinationTrigger = atlas.getByRole("button", {
    name: /Walking destination/,
  })
  await destinationTrigger.click()
  const destinationList = atlas.getByRole("listbox", {
    name: "Journey destinations",
  })
  const atlasBox = await atlas.boundingBox()
  const destinationListBox = await destinationList.boundingBox()
  expect(destinationListBox?.x ?? 0).toBeGreaterThanOrEqual(atlasBox?.x ?? 0)
  expect(
    (destinationListBox?.x ?? 0) + (destinationListBox?.width ?? 0)
  ).toBeLessThanOrEqual((atlasBox?.x ?? 0) + (atlasBox?.width ?? 0) + 1)
  await page.keyboard.press("Escape")
  await expect(destinationList).toBeHidden()
  await atlas.getByRole("button", { name: "Close journey map" }).click()

  const journey = page.locator('main[data-scene-ready="true"]')
  const initialZ = await journey.getAttribute("data-player-z")
  await joystick.focus()
  await page.keyboard.down("ArrowUp")
  await page.waitForTimeout(450)
  await page.keyboard.up("ArrowUp")
  await expect(journey).not.toHaveAttribute("data-player-z", initialZ ?? "")
})
