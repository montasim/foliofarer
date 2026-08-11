import { expect, test, type Page } from "@playwright/test"

const CANONICAL_CHECKPOINTS = [
  { id: "town-square", title: "Town Square" },
  { id: "rangpur-zilla-school", title: "Rangpur Zilla School" },
  { id: "carmichael-college", title: "Carmichael College" },
  { id: "baust", title: "BAUST" },
  { id: "codez-info-tech", title: "Codez Info Tech" },
  { id: "drra", title: "DRRA" },
  { id: "multiversal-software", title: "Multiversal" },
  { id: "mymedicalhub", title: "MyMedicalHub" },
  { id: "learning-library", title: "Learning Library" },
  { id: "project-workshop", title: "Project Workshop" },
  { id: "community-hall", title: "Community Hall" },
  { id: "contact-pavilion", title: "Contact Pavilion" },
] as const

async function openAtlasFirst(page: Page) {
  await page.goto("/journey")
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await page
    .getByRole("navigation", { name: "Journey tools" })
    .getByRole("button", { name: "Open Atlas" })
    .click()
  await expect(
    page.getByRole("dialog", { name: "The Journey Atlas" })
  ).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("montasim-journey-passport-v1")
  })
})

test("every Atlas destination returns to the world as the route target", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await openAtlasFirst(page)

  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(journey).toHaveAttribute("data-world-paused", "true")
  await expect(page.locator("[data-journey-atlas-entry]")).toHaveCount(12)
  await expect(page.locator("canvas")).toHaveCount(1)

  for (const [index, checkpoint] of CANONICAL_CHECKPOINTS.entries()) {
    const atlas = page.getByRole("dialog", { name: "The Journey Atlas" })
    const entry = atlas.locator(`[data-journey-atlas-entry="${checkpoint.id}"]`)
    await expect(entry).toBeVisible()

    const destinationButton = entry.getByRole("button", {
      name: /destination/i,
    })
    if ((await destinationButton.getAttribute("aria-pressed")) !== "true") {
      await destinationButton.click()
    }
    await expect(entry).toHaveAttribute("data-destination", "true")
    await expect(journey).toHaveAttribute("data-destination-id", checkpoint.id)
    await expect(journey).toHaveAttribute("data-assisted-travel", "false")

    await atlas
      .getByRole("button", {
        name: "Return to world",
      })
      .first()
      .click()
    await expect(journey).toHaveAttribute("data-journey-mode", "world")

    const routeControl = page.getByRole("button", {
      name: `Follow route to ${checkpoint.title}`,
    })
    await expect(routeControl).toBeVisible()
    await expect(
      page.locator(`[data-route-destination-id="${checkpoint.id}"]`)
    ).toBeVisible()

    await routeControl.click()
    await expect(journey).toHaveAttribute("data-assisted-travel", "true")
    await expect(
      page.getByRole("button", {
        name: `Stop route to ${checkpoint.title}`,
      })
    ).toHaveAttribute("aria-pressed", "true")

    if (index < CANONICAL_CHECKPOINTS.length - 1) {
      await page
        .getByRole("navigation", { name: "Journey tools" })
        .getByRole("button", { name: "Open Atlas" })
        .click()
      await expect(
        page.getByRole("dialog", { name: "The Journey Atlas" })
      ).toBeVisible()
    }
  }
})

test("a genuine physical arrival reveals a DOM Place Card and stamps the Passport", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto("/journey")

  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })
  await page
    .getByRole("button", { name: "Follow route to Town Square" })
    .click()

  const placeCard = page.getByRole("region", { name: "Town Square" })
  await expect(placeCard).toBeVisible({ timeout: 30_000 })
  await expect(placeCard).toHaveAttribute("data-landmark-id", "town-square")
  await expect(
    placeCard.getByRole("heading", { name: "Town Square" })
  ).toBeVisible()

  await page
    .getByRole("navigation", { name: "Journey tools" })
    .getByRole("button", { name: /Open Passport/ })
    .click()
  const passport = page.getByRole("dialog", { name: "Journey Passport" })
  const progress = passport.getByRole("progressbar", {
    name: "Journey Passport progress",
  })
  await expect
    .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
    .toBeGreaterThanOrEqual(1)
  await expect(
    passport.locator('[data-journey-passport-entry="town-square"]')
  ).toHaveAttribute("data-stamped", "true")
})
