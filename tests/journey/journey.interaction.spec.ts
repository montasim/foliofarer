import { expect, test } from "@playwright/test"
import { openReadyJourney, prepareJourney } from "./journey-test-helpers"

test.setTimeout(60_000)

test("Journey controls and critical content remain available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyJourney(page)

  const mapTrigger = page.getByRole("button", { name: "Expand Journey map" })
  await expect(mapTrigger).toBeVisible()
  await expect(mapTrigger).toHaveCSS("padding", "16px")
  await expect(
    page.getByRole("link", { name: "Return to standard portfolio" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Journey passport/ })
  ).toHaveAccessibleName("Journey passport, 0 of 12 stories discovered")
  await expect(
    page.getByRole("button", { name: /Walk route|Auto-walk off/ })
  ).toBeVisible()

  await page.getByRole("button", { name: "Expand Journey map" }).click()
  const map = page.getByRole("region", { name: "Journey map" })
  await expect(map).toBeVisible()
  await expect(map).toHaveCSS(
    "scrollbar-color",
    "rgb(120, 144, 112) rgb(217, 223, 209)"
  )
  await expect(
    page.getByRole("button", { name: "Close journey map" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Journey map" })).toBeHidden()

  await page
    .getByRole("button", { name: /Journey passport/ })
    .dispatchEvent("click")
  await expect(
    page.getByRole("region", { name: "Journey passport" })
  ).toBeVisible()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport).toHaveCSS("padding", "16px")
  const passportBox = await passport.boundingBox()
  expect(passportBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    450
  )
  const passportHeader = passport.locator(".journey-passport-header")
  const passportScroll = passport.locator(".journey-passport-scroll")
  const headerTopBeforeScroll = (await passportHeader.boundingBox())?.y
  await passportScroll.evaluate((archive) => {
    archive.scrollTop = 280
  })
  const headerTopAfterScroll = (await passportHeader.boundingBox())?.y
  expect(
    Math.abs(
      (headerTopAfterScroll ?? Number.POSITIVE_INFINITY) -
        (headerTopBeforeScroll ?? 0)
    )
  ).toBeLessThanOrEqual(1)
  await expect(passportScroll).toHaveCSS(
    "scrollbar-color",
    "rgb(120, 144, 112) rgb(217, 223, 209)"
  )
  await expect(
    page.getByRole("button", { name: "Close journey passport" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("region", { name: "Journey passport" })
  ).toBeHidden()

  const journey = page.locator("main")
  const before = await journey.getAttribute("data-player-z")
  await page.keyboard.down("KeyW")
  await page.waitForTimeout(450)
  await page.keyboard.up("KeyW")
  await expect(journey).not.toHaveAttribute("data-player-z", before ?? "")

  await expect(
    page.locator('[data-journey-critical="landmark-label"]')
  ).toHaveCount(11)
})

test("holding forward changes the avatar from walking to running", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyJourney(page)
  const journey = page.locator("main")
  const position = async () => ({
    x: Number(await journey.getAttribute("data-player-x")),
    z: Number(await journey.getAttribute("data-player-z")),
  })
  const distance = (
    from: { x: number; z: number },
    to: { x: number; z: number }
  ) => Math.hypot(to.x - from.x, to.z - from.z)

  await page.locator("canvas").click({ position: { x: 720, y: 450 } })
  const start = await position()
  await page.keyboard.down("w")
  await page.waitForTimeout(400)
  const afterWalk = await position()
  await page.waitForTimeout(800)
  const afterRun = await position()
  await page.keyboard.up("w")

  const walkingRate = distance(start, afterWalk) / 400
  const runningRate = distance(afterWalk, afterRun) / 800
  expect(runningRate).toBeGreaterThan(walkingRate * 1.18)
})

test("Assisted Travel advances to the active destination", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareJourney(page)
  await page.goto("/journey")
  const journey = page.locator('main[data-scene-ready="true"]')
  await journey.waitFor({ state: "visible", timeout: 30_000 })
  const initialX = await journey.getAttribute("data-player-x")
  const initialZ = await journey.getAttribute("data-player-z")

  await page.getByRole("button", { name: "Walk route" }).click()
  await expect(page.getByRole("button", { name: "Stop walking" })).toBeVisible()
  await expect
    .poll(async () => ({
      x: await journey.getAttribute("data-player-x"),
      z: await journey.getAttribute("data-player-z"),
    }))
    .not.toEqual({ x: initialX, z: initialZ })
  await expect(
    page.getByRole("button", { name: /Explore Town Square/ })
  ).toBeVisible({ timeout: 25_000 })
  await expect(page.locator("[data-journey-route-guide]")).toHaveCount(0)
  expect(Number(await journey.getAttribute("data-player-y"))).toBeGreaterThan(
    0.6
  )
})

test("Journey Map selects a destination and starts Assisted Travel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareJourney(page)
  await page.goto("/journey")
  const journey = page.locator('main[data-scene-ready="true"]')
  await journey.waitFor({ state: "visible", timeout: 30_000 })

  await page.getByRole("button", { name: "Expand Journey map" }).click()
  const map = page.getByRole("region", { name: "Journey map" })
  const destination = map.getByRole("button", {
    name: /Walking destination/,
  })

  await map
    .getByRole("button", { name: /^Select Project Workshop on map/ })
    .click()
  await expect(destination).toContainText("Project Workshop")
  await expect(
    map.getByRole("navigation", { name: "Journey destinations" })
  ).toHaveCount(0)

  const initialX = await journey.getAttribute("data-player-x")
  const initialZ = await journey.getAttribute("data-player-z")
  await map.getByRole("button", { name: "Walk to Project Workshop" }).click()

  await expect(map).toBeHidden()
  await expect(page.getByRole("button", { name: "Stop walking" })).toBeVisible()
  await expect
    .poll(async () => ({
      x: await journey.getAttribute("data-player-x"),
      z: await journey.getAttribute("data-player-z"),
    }))
    .not.toEqual({ x: initialX, z: initialZ })
})

for (const renderTier of ["high", "balanced", "low"] as const) {
  test(`critical content survives the ${renderTier} render tier`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await prepareJourney(page, renderTier)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/journey")
    const journey = page.locator('main[data-scene-ready="true"]')
    await journey.waitFor({ state: "visible", timeout: 30_000 })

    await expect(journey).toHaveAttribute("data-render-tier", renderTier)
    await expect(
      page.locator('[data-journey-critical="landmark-label"]')
    ).toHaveCount(11)
    await expect(
      page.getByRole("button", { name: "Expand Journey map" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Walk route|Auto-walk off/ })
    ).toBeVisible()
  })
}

test("Career District exposes chronological company archives", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareJourney(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "montasim-journey-passport-v1",
      JSON.stringify({
        discoveredLandmarkIds: [
          "town-square",
          "codez-info-tech",
          "drra",
          "multiversal-software",
          "mymedicalhub",
        ],
      })
    )
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/journey")
  await page
    .locator('main[data-scene-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })

  await page.getByRole("button", { name: /Journey passport/ }).click()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport.getByText("Career archive")).toBeVisible()
  await expect(passport.getByText("4/4")).toBeVisible()
  await passport.getByRole("button", { name: /MyMedicalHub/ }).click()

  const story = page.getByRole("dialog")
  await expect(story.locator(".journey-story-sheet")).toHaveCSS(
    "scrollbar-color",
    "rgb(120, 144, 112) rgb(217, 223, 209)"
  )
  await expect(
    story.getByRole("heading", { name: "Role progression" })
  ).toBeVisible()
  await expect(story.getByText("Responsibilities & achievements")).toHaveCount(
    3
  )
  const roles = story.locator("ol > li")
  await expect(roles).toHaveCount(3)
  await expect(roles.nth(0)).toContainText("Junior Software Engineer")
  await expect(roles.nth(1)).toContainText("Software Engineer")
  await expect(roles.nth(2)).toContainText("Senior Software Engineer")
  await expect(story.getByText("MediaPipe", { exact: true })).toBeVisible()
})

test("Learning Library connects technology rooms to evidence and credentials", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareJourney(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "montasim-journey-passport-v1",
      JSON.stringify({ discoveredLandmarkIds: ["learning-library"] })
    )
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/journey")
  await page
    .locator('main[data-scene-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })

  await page.getByRole("button", { name: /Journey passport/ }).click()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport.getByText("Learning archive")).toBeVisible()
  await expect(passport.getByText("1/1")).toBeVisible()
  await passport.getByRole("button", { name: "Learning Library" }).click()

  const story = page.getByRole("dialog")
  await expect(
    story.getByRole("heading", { name: "Technology rooms" })
  ).toBeVisible()
  await expect(story.getByRole("tab")).toHaveCount(6)
  const frontendRoom = story.getByRole("tab", { name: /Frontend/ })
  await expect(frontendRoom).toHaveCSS("background-color", "rgb(49, 93, 87)")
  await frontendRoom.focus()
  await frontendRoom.press("End")
  await expect(
    story.getByRole("tab", { name: /Real-time Systems/ })
  ).toHaveAttribute("aria-selected", "true")
  await expect(
    story.getByLabel("Technologies").getByText("WebRTC", { exact: true })
  ).toBeVisible()
  await expect(story.getByText(/Patient Portal/)).toBeVisible()

  const search = story.getByRole("searchbox", {
    name: "Search certifications",
  })
  await search.fill("Postman")
  await expect(
    story.getByText("Webservices API Testing with Postman - Complete Guide")
  ).toBeVisible()
  await expect(story.getByText("Meta Front-End Developer")).toBeHidden()
})

test("Project Workshop exposes curated exhibits and the complete searchable archive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareJourney(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "montasim-journey-passport-v1",
      JSON.stringify({ discoveredLandmarkIds: ["project-workshop"] })
    )
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/journey")
  await page
    .locator('main[data-scene-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })

  await page.getByRole("button", { name: /Journey passport/ }).click()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport.getByText("Project archive")).toBeVisible()
  await expect(passport.getByText("1/1")).toBeVisible()
  await passport.getByRole("button", { name: "Project Workshop" }).click()

  const story = page.getByRole("dialog")
  await expect(
    story.getByRole("heading", { name: "Built work, inspected closely" })
  ).toBeVisible()
  const exhibitTabs = story.getByRole("tablist", {
    name: "Featured project exhibits",
  })
  await expect(exhibitTabs).toHaveCSS(
    "scrollbar-color",
    "rgb(120, 144, 112) rgb(217, 223, 209)"
  )
  await expect(story.getByRole("tab")).toHaveCount(5)
  await expect(story.getByText("Problem", { exact: true })).toBeVisible()
  await expect(story.getByText("Solution", { exact: true })).toBeVisible()
  await expect(story.getByText("Outcome", { exact: true })).toBeVisible()
  await expect(story.getByText(/HIPAA-compliant patient journey/)).toBeVisible()

  const firstExhibit = story.getByRole("tab", { name: /Patient Portal/ })
  await firstExhibit.focus()
  await firstExhibit.press("End")
  await expect(story.getByRole("tab", { name: /DevTools/ })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  expect(
    await exhibitTabs.evaluate(
      (tabs) =>
        tabs.scrollLeft === 0 && tabs.scrollWidth <= tabs.clientWidth + 1
    )
  ).toBe(true)
  await expect(
    story.getByRole("link", { name: "Open live project" })
  ).toHaveAttribute("href", "https://devtoolsn.vercel.app")

  const archive = story.getByRole("region", { name: "Project archive" })
  await expect(archive.getByText("17 of 17 records")).toBeVisible()
  const search = archive.getByRole("searchbox", { name: "Search projects" })
  await search.fill("address-bd")
  await expect(archive.getByText("1 of 17 records")).toBeVisible()
  await expect(archive.getByText("address-bd — npm package")).toBeVisible()
  await expect(archive.getByText(/Patient Portal/)).toBeHidden()
})

test("Community Hall owns complete records while Education keeps cross-references", async ({
  page,
}) => {
  test.slow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepareJourney(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "montasim-journey-passport-v1",
      JSON.stringify({
        discoveredLandmarkIds: ["community-hall", "rangpur-zilla-school"],
      })
    )
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/journey")
  await page
    .locator('main[data-scene-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })

  await page.getByRole("button", { name: /Journey passport/ }).click()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport.getByText("Community archive")).toBeVisible()
  await expect(passport.getByText("1/1")).toBeVisible()
  await passport.getByRole("button", { name: "Community Hall" }).click()

  const story = page.getByRole("dialog")
  await expect(
    story.getByRole("heading", { name: "Contribution through shared work" })
  ).toBeVisible()
  await expect(
    story.getByRole("heading", { name: "Leadership & service" })
  ).toBeVisible()
  await expect(
    story.getByRole("heading", { name: "Event organizing" })
  ).toBeVisible()
  await expect(
    story.getByRole("heading", { name: "Student communities" })
  ).toBeVisible()
  await expect(story.getByText(/Education Story Link/)).toHaveCount(5)
  await expect(story.getByText(/Second Best Cadet/)).toBeVisible()
  await expect(story.getByText("BAUST Programming Club")).toBeVisible()

  await story.getByRole("button", { name: "Continue walking" }).click()
  await page.getByRole("button", { name: /Journey passport/ }).click()
  await page
    .getByRole("region", { name: "Journey passport" })
    .getByRole("button", { name: "Rangpur Zilla School" })
    .click()
  const educationStory = page.getByRole("dialog")
  await expect(
    educationStory.getByText("Connected community work")
  ).toBeVisible()
  await expect(
    educationStory.getByText("Bangladesh National Cadet Corps (BNCC)")
  ).toBeVisible()
  await expect(educationStory.getByText(/Second Best Cadet/)).toBeHidden()
})

test("Contact Pavilion completes the journey without closing free exploration", async ({
  page,
}) => {
  test.slow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.evaluate(() => {
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

  await page.getByRole("button", { name: /Journey passport/ }).click()
  const passport = page.getByRole("region", { name: "Journey passport" })
  await expect(passport.getByText("Contact destination")).toBeVisible()
  await passport.getByRole("button", { name: "Contact Pavilion" }).click()

  const story = page.getByRole("dialog")
  await expect(
    story.getByRole("heading", { name: "Start a conversation" })
  ).toBeVisible()
  await expect(
    story.getByRole("link", { name: /Start a conversation/ })
  ).toHaveAttribute(
    "href",
    "mailto:montasimmamun@gmail.com?subject=A%20conversation%20about%20your%20work"
  )
  await expect(
    story.getByRole("link", { name: /Connect on LinkedIn/ })
  ).toHaveAttribute("href", "https://linkedin.com/in/montasim")
  await expect(
    story.getByRole("link", { name: /Open résumé/ })
  ).toHaveAttribute("href", /drive\.google\.com/)

  await story.getByRole("button", { name: "End guided journey" }).click()
  await expect(story.getByText("Guided journey complete")).toBeVisible()
  await story.getByRole("button", { name: "Continue exploring" }).click()
  await expect(
    page.getByRole("button", { name: /Journey passport/ })
  ).toHaveAccessibleName(
    "Journey passport, 1 of 12 stories discovered, journey complete"
  )

  await page.reload()
  await page
    .locator('main[data-scene-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })
  await expect(
    page.getByText("Free exploration", { exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Expand Journey map" }).click()
  const map = page.getByRole("region", { name: "Journey map" })
  await expect(map.getByText("Journey complete")).toBeVisible()
  await expect(map.getByText("Suggested", { exact: true })).toBeHidden()
  await map.getByRole("button", { name: /Walking destination/ }).click()
  await map.getByRole("option", { name: "Town Square" }).click()
  await map.getByRole("button", { name: "Close journey map" }).click()
  await expect(page.getByText("Town Square", { exact: true })).toBeVisible()
})
