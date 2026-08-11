import { expect, test } from "@playwright/test"
import type {
  NavigationAssetV3,
  SharedWorldAssetV3,
  WorldIndexManifestV3,
} from "../../lib/journey-v2/contracts/world"
import { checksumJson } from "../../lib/journey-v2/generator/checksum"
import {
  assertGenerationAgreement,
  assertWorldIndex,
  loadJourneyWorldBootstrap,
} from "../../lib/journey-v2/runtime/world-loader"

function withChecksum<T extends { checksum: string }>(value: T): T {
  return { ...value, checksum: checksumJson({ ...value, checksum: "" }) }
}

const shared = withChecksum<SharedWorldAssetV3>({
  schemaVersion: 3,
  generatorVersion: "loader-test",
  checksum: "",
  materials: [],
  geometries: [],
})

const navigation = withChecksum<NavigationAssetV3>({
  schemaVersion: 3,
  generatorVersion: "loader-test",
  checksum: "",
  navigation: {
    nodes: [],
    edges: [],
    checkpointNodeIds: {},
  },
})

function indexFixture(): WorldIndexManifestV3 {
  return {
    schemaVersion: 3,
    generatorVersion: "loader-test",
    checksum: "index-checksum",
    seed: 7,
    units: "metres",
    scope: "complete",
    world: {
      bounds: [0, 0, 40, 40],
      cellSize: 40,
      spawn: [20, 0, 20],
      heightRange: [0, 1],
      waterLevel: 0,
    },
    fullManifestAsset: "/world.json",
    sharedAsset: "/shared.json",
    sharedAssetChecksum: shared.checksum,
    navigationAsset: "/navigation.json",
    navigationAssetChecksum: navigation.checksum,
    cells: [],
    roads: [],
    portfolioRecords: [],
    checkpoints: [],
    waterBodies: [],
    bridges: [],
  }
}

test("V3 index requires checksum pins for shared and navigation assets", () => {
  const index = indexFixture()
  expect(() => assertWorldIndex(index)).not.toThrow()

  const missingSharedPin = { ...index } as Partial<WorldIndexManifestV3>
  delete missingSharedPin.sharedAssetChecksum
  expect(() => assertWorldIndex(missingSharedPin)).toThrow(
    /V3 world index is incomplete/
  )

  const missingNavigationPin = { ...index } as Partial<WorldIndexManifestV3>
  delete missingNavigationPin.navigationAssetChecksum
  expect(() => assertWorldIndex(missingNavigationPin)).toThrow(
    /V3 world index is incomplete/
  )
})

test("V3 bootstrap rejects valid assets from a different deployment", () => {
  const index = indexFixture()
  expect(() =>
    assertGenerationAgreement(
      index,
      shared,
      index.sharedAssetChecksum,
      "shared asset"
    )
  ).not.toThrow()
  expect(() =>
    assertGenerationAgreement(
      index,
      navigation,
      index.navigationAssetChecksum,
      "navigation asset"
    )
  ).not.toThrow()

  expect(() =>
    assertGenerationAgreement(
      index,
      shared,
      navigation.checksum,
      "shared asset"
    )
  ).toThrow(/shared asset checksum does not match its world index/)
  expect(() =>
    assertGenerationAgreement(
      index,
      navigation,
      shared.checksum,
      "navigation asset"
    )
  ).toThrow(/navigation asset checksum does not match its world index/)
})

test("bootstrap bypasses the mutable index cache and retries one mixed generation", async () => {
  const currentIndex = withChecksum<WorldIndexManifestV3>({
    ...indexFixture(),
    checksum: "",
  })
  const previousShared = withChecksum<SharedWorldAssetV3>({
    ...shared,
    generatorVersion: "previous-loader-test",
    checksum: "",
  })
  const calls: Array<{ path: string; cache: RequestCache | undefined }> = []
  let sharedRequests = 0
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input)
    const path = new URL(url, "https://journey.test").pathname
    calls.push({ path, cache: init?.cache })

    let body: unknown
    if (path === "/index.json") body = currentIndex
    else if (path === "/shared.json") {
      sharedRequests += 1
      body = sharedRequests === 1 ? previousShared : shared
    } else if (path === "/navigation.json") body = navigation
    else return new Response("Not found", { status: 404 })

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  try {
    const bootstrap = await loadJourneyWorldBootstrap(
      "https://journey.test/index.json",
      "balanced"
    )
    expect(bootstrap.manifest.schemaVersion).toBe(3)
    expect(sharedRequests).toBe(2)
    expect(
      calls.filter((call) => call.path === "/index.json").map((call) => call.cache)
    ).toEqual(["no-store", "no-store"])
    expect(
      calls
        .filter((call) => call.path === "/shared.json")
        .map((call) => call.cache)
    ).toEqual(["force-cache", "reload"])
    expect(
      calls
        .filter((call) => call.path === "/navigation.json")
        .map((call) => call.cache)
    ).toEqual(["force-cache", "reload"])
  } finally {
    globalThis.fetch = originalFetch
  }
})
