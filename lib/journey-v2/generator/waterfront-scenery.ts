import type {
  AuthoredWaterBodyV3,
  AuthoredWorldV3,
  Vec2,
  Vec3,
} from "../contracts/world.ts"
import { round } from "./geometry.ts"
import type { TerrainFieldV3 } from "./terrain.ts"

type LinearColor = readonly [number, number, number]

export interface WaterfrontScenePlanV3 {
  id: string
  waterBodyId: string
  centerlineProgress: number
  bankSide: -1 | 1
  dockLength: number
  dockWidth: number
}

export interface WaterfrontFeatureV3 {
  id: string
  kind: "ghat" | "country-boat"
  waterBodyId: string
  center: Vec3
  direction: Vec2
  dimensions: Vec3
}

export interface WaterfrontSceneryV3 {
  positions: number[]
  indices: number[]
  colors: number[]
  features: WaterfrontFeatureV3[]
}

/**
 * A single restrained river landing is enough to make the northern river feel
 * inhabited without turning environmental scenery into portfolio navigation.
 * Its authored input is spatial only; every visible part is generated below.
 */
export const WATERFRONT_SCENES_V3: readonly WaterfrontScenePlanV3[] = [
  {
    id: "environment.waterfront.northern-ghat",
    waterBodyId: "water.northern-river",
    centerlineProgress: 0.78,
    bankSide: 1,
    dockLength: 5.6,
    dockWidth: 1.8,
  },
]

const COLORS = {
  sunBleachedTimber: "#e0cda2",
  timber: "#71513a",
  darkHull: "#143d42",
  hullInterior: "#4f392d",
  terracotta: "#c76343",
  rope: "#a98a62",
} as const

interface MutableMesh {
  positions: number[]
  indices: number[]
  colors: number[]
}

interface Frame2 {
  origin: Vec2
  u: Vec2
  v: Vec2
}

function hexToLinearRgb(value: string): LinearColor {
  const normalized = value.replace("#", "")
  const toLinear = (channel: number) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  return [
    toLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    toLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    toLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
  ]
}

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector[0], vector[1])
  return length > 1e-8
    ? [vector[0] / length, vector[1] / length]
    : [1, 0]
}

function worldPoint(
  frame: Frame2,
  localX: number,
  y: number,
  localZ: number
): Vec3 {
  return [
    frame.origin[0] + frame.u[0] * localX + frame.v[0] * localZ,
    y,
    frame.origin[1] + frame.u[1] * localX + frame.v[1] * localZ,
  ]
}

function addVertex(
  target: MutableMesh,
  point: Vec3,
  color: LinearColor
) {
  const index = target.positions.length / 3
  target.positions.push(round(point[0]), round(point[1]), round(point[2]))
  target.colors.push(
    round(color[0], 5),
    round(color[1], 5),
    round(color[2], 5)
  )
  return index
}

function addFace(
  target: MutableMesh,
  points: readonly [Vec3, Vec3, Vec3, Vec3],
  color: LinearColor
) {
  const indices = points.map((point) => addVertex(target, point, color))
  target.indices.push(
    indices[0],
    indices[1],
    indices[2],
    indices[0],
    indices[2],
    indices[3]
  )
}

function addBox(
  target: MutableMesh,
  frame: Frame2,
  centerY: number,
  width: number,
  height: number,
  depth: number,
  color: LinearColor
) {
  const left = -width / 2
  const right = width / 2
  const bottom = centerY - height / 2
  const top = centerY + height / 2
  const front = -depth / 2
  const back = depth / 2
  const point = (x: number, y: number, z: number) =>
    worldPoint(frame, x, y, z)

  addFace(
    target,
    [
      point(left, bottom, front),
      point(left, top, front),
      point(right, top, front),
      point(right, bottom, front),
    ],
    color
  )
  addFace(
    target,
    [
      point(left, bottom, back),
      point(right, bottom, back),
      point(right, top, back),
      point(left, top, back),
    ],
    color
  )
  addFace(
    target,
    [
      point(left, bottom, front),
      point(left, bottom, back),
      point(left, top, back),
      point(left, top, front),
    ],
    color
  )
  addFace(
    target,
    [
      point(right, bottom, front),
      point(right, top, front),
      point(right, top, back),
      point(right, bottom, back),
    ],
    color
  )
  addFace(
    target,
    [
      point(left, bottom, front),
      point(right, bottom, front),
      point(right, bottom, back),
      point(left, bottom, back),
    ],
    color
  )
  addFace(
    target,
    [
      point(left, top, front),
      point(left, top, back),
      point(right, top, back),
      point(right, top, front),
    ],
    color
  )
}

function addRibbon(
  target: MutableMesh,
  start: Vec3,
  end: Vec3,
  width: number,
  color: LinearColor
) {
  const direction = normalize([end[0] - start[0], end[2] - start[2]])
  const normal: Vec2 = [-direction[1], direction[0]]
  const halfWidth = width / 2
  addFace(
    target,
    [
      [
        start[0] + normal[0] * halfWidth,
        start[1],
        start[2] + normal[1] * halfWidth,
      ],
      [
        end[0] + normal[0] * halfWidth,
        end[1],
        end[2] + normal[1] * halfWidth,
      ],
      [
        end[0] - normal[0] * halfWidth,
        end[1],
        end[2] - normal[1] * halfWidth,
      ],
      [
        start[0] - normal[0] * halfWidth,
        start[1],
        start[2] - normal[1] * halfWidth,
      ],
    ],
    color
  )
}

function sampleCenterline(
  points: readonly Vec2[],
  progress: number
): { point: Vec2; tangent: Vec2 } {
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point[0] - points[index][0], point[1] - points[index][1])
  )
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  let remaining = Math.max(0, Math.min(1, progress)) * totalLength
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const start = points[index]
      const end = points[index + 1]
      const amount =
        lengths[index] <= 1e-8 ? 0 : Math.min(1, remaining / lengths[index])
      return {
        point: [
          start[0] + (end[0] - start[0]) * amount,
          start[1] + (end[1] - start[1]) * amount,
        ],
        tangent: normalize([end[0] - start[0], end[1] - start[1]]),
      }
    }
    remaining -= lengths[index]
  }
  throw new Error("A waterfront centerline requires two distinct points")
}

function addDock(options: {
  target: MutableMesh
  scene: WaterfrontScenePlanV3
  water: AuthoredWaterBodyV3
  field: TerrainFieldV3
  centerlinePoint: Vec2
  tangent: Vec2
  bankNormal: Vec2
}) {
  const {
    target,
    scene,
    water,
    field,
    centerlinePoint,
    tangent,
    bankNormal,
  } = options
  const timber = hexToLinearRgb(COLORS.timber)
  const paleTimber = hexToLinearRgb(COLORS.sunBleachedTimber)
  const halfRiverWidth = (water.width ?? 0) / 2
  const inward: Vec2 = [-bankNormal[0], -bankNormal[1]]
  const shore: Vec2 = [
    centerlinePoint[0] + bankNormal[0] * (halfRiverWidth + 0.62),
    centerlinePoint[1] + bankNormal[1] * (halfRiverWidth + 0.62),
  ]
  const deckCenter: Vec2 = [
    shore[0] + inward[0] * (scene.dockLength / 2),
    shore[1] + inward[1] * (scene.dockLength / 2),
  ]
  const deckTop = water.waterLevel + 0.56
  const deckFrame: Frame2 = {
    origin: deckCenter,
    u: tangent,
    // Keep the mesh frame right-handed so the upward deck and stair faces
    // survive back-face culling. Positioning still follows `inward`; the box
    // primitives are symmetric around their local depth axis.
    v: bankNormal,
  }

  addBox(
    target,
    deckFrame,
    deckTop - 0.11,
    scene.dockWidth,
    0.22,
    scene.dockLength,
    paleTimber
  )

  // A single uninterrupted deck prevents the landing reading as scattered
  // floating boards. Recessed seams supply just enough timber rhythm while
  // remaining part of the same vertex-coloured mesh.
  for (let index = 1; index < 6; index += 1) {
    const along = -scene.dockLength / 2 + (scene.dockLength * index) / 6
    const seamCenter: Vec2 = [
      deckCenter[0] + inward[0] * along,
      deckCenter[1] + inward[1] * along,
    ]
    const seamFrame: Frame2 = {
      origin: seamCenter,
      u: tangent,
      v: bankNormal,
    }
    addBox(
      target,
      seamFrame,
      deckTop + 0.009,
      scene.dockWidth - 0.08,
      0.018,
      0.026,
      timber
    )
  }

  const postBottom = water.waterLevel - 0.54
  const postTop = deckTop + 0.32
  for (const along of [-scene.dockLength * 0.08, scene.dockLength * 0.42]) {
    for (const across of [-scene.dockWidth * 0.43, scene.dockWidth * 0.43]) {
      const postOrigin: Vec2 = [
        deckCenter[0] + inward[0] * along + tangent[0] * across,
        deckCenter[1] + inward[1] * along + tangent[1] * across,
      ]
      addBox(
        target,
        { origin: postOrigin, u: tangent, v: bankNormal },
        (postBottom + postTop) / 2,
        0.2,
        postTop - postBottom,
        0.2,
        timber
      )
    }
  }

  const stepCount = 3
  const stepDepth = 0.58
  const landTop = Math.max(
    deckTop + 0.22,
    (field.landHeightAt?.(shore) ?? field.heightAt(shore)) + 0.04
  )
  for (let index = 0; index < stepCount; index += 1) {
    // Descend from the high bank over the riverward end of the deck. Putting
    // the stair boxes into the dry bank leaves their first two treads buried
    // by the deliberately incised shoreline, which reads as stray timber
    // lines rather than a usable ghat.
    const stepOrigin: Vec2 = [
      shore[0] + inward[0] * (index + 0.5) * stepDepth,
      shore[1] + inward[1] * (index + 0.5) * stepDepth,
    ]
    const heightProgress = (stepCount - index) / stepCount
    const stepTop =
      deckTop + 0.07 + (landTop - deckTop - 0.07) * heightProgress
    const stepBottom = deckTop - 0.16
    addBox(
      target,
      { origin: stepOrigin, u: tangent, v: bankNormal },
      (stepTop + stepBottom) / 2,
      scene.dockWidth + 0.62,
      stepTop - stepBottom,
      stepDepth,
      paleTimber
    )
  }

  return {
    center: [deckCenter[0], deckTop, deckCenter[1]] as Vec3,
    direction: inward,
    shore,
    dockEnd: [
      shore[0] + inward[0] * scene.dockLength,
      shore[1] + inward[1] * scene.dockLength,
    ] as Vec2,
    deckTop,
  }
}

function addBoat(options: {
  target: MutableMesh
  id: string
  water: AuthoredWaterBodyV3
  center: Vec2
  tangent: Vec2
  length: number
  width: number
}) {
  const { target, water, center, tangent, length, width } = options
  const normal: Vec2 = [-tangent[1], tangent[0]]
  const frame: Frame2 = { origin: center, u: tangent, v: normal }
  const darkHull = hexToLinearRgb(COLORS.darkHull)
  const interior = hexToLinearRgb(COLORS.hullInterior)
  const accent = hexToLinearRgb(COLORS.terracotta)
  const paleTimber = hexToLinearRgb(COLORS.sunBleachedTimber)
  const topY = water.waterLevel + 0.46
  const keelY = water.waterLevel - 0.18
  const topRing = [
    [-length / 2, 0],
    [-length * 0.29, -width / 2],
    [length * 0.29, -width / 2],
    [length / 2, 0],
    [length * 0.29, width / 2],
    [-length * 0.29, width / 2],
  ] as const
  const keelRing = topRing.map(([x, z]) => [x * 0.8, z * 0.44] as const)

  for (let index = 0; index < topRing.length; index += 1) {
    const next = (index + 1) % topRing.length
    addFace(
      target,
      [
        worldPoint(frame, topRing[index][0], topY, topRing[index][1]),
        worldPoint(frame, keelRing[index][0], keelY, keelRing[index][1]),
        worldPoint(frame, keelRing[next][0], keelY, keelRing[next][1]),
        worldPoint(frame, topRing[next][0], topY, topRing[next][1]),
      ],
      darkHull
    )

    // A raised timber gunwale gives the hull real freeboard instead of the
    // black paper-strip silhouette produced by a water-level-only rim.
    addFace(
      target,
      [
        worldPoint(
          frame,
          topRing[index][0],
          topY - 0.1,
          topRing[index][1]
        ),
        worldPoint(
          frame,
          topRing[next][0],
          topY - 0.1,
          topRing[next][1]
        ),
        worldPoint(
          frame,
          topRing[next][0],
          topY + 0.015,
          topRing[next][1]
        ),
        worldPoint(
          frame,
          topRing[index][0],
          topY + 0.015,
          topRing[index][1]
        ),
      ],
      interior
    )

    // A narrow terracotta cap carries the Journey palette without painting
    // the whole pointed country-boat orange.
    const inset = 0.085
    addFace(
      target,
      [
        worldPoint(
          frame,
          topRing[index][0],
          topY + 0.018,
          topRing[index][1]
        ),
        worldPoint(
          frame,
          topRing[next][0],
          topY + 0.018,
          topRing[next][1]
        ),
        worldPoint(
          frame,
          topRing[next][0] * (1 - inset),
          topY + 0.022,
          topRing[next][1] * (1 - inset)
        ),
        worldPoint(
          frame,
          topRing[index][0] * (1 - inset),
          topY + 0.022,
          topRing[index][1] * (1 - inset)
        ),
      ],
      accent
    )
  }

  addFace(
    target,
    [
      worldPoint(frame, -length * 0.29, water.waterLevel + 0.2, -width * 0.3),
      worldPoint(frame, length * 0.29, water.waterLevel + 0.2, -width * 0.3),
      worldPoint(frame, length * 0.29, water.waterLevel + 0.2, width * 0.3),
      worldPoint(frame, -length * 0.29, water.waterLevel + 0.2, width * 0.3),
    ],
    interior
  )

  for (const seatX of [-length * 0.15, length * 0.15]) {
    const seatOrigin: Vec2 = [
      center[0] + tangent[0] * seatX,
      center[1] + tangent[1] * seatX,
    ]
    addBox(
      target,
      { origin: seatOrigin, u: tangent, v: normal },
      topY + 0.07,
      0.2,
      0.1,
      width * 0.68,
      paleTimber
    )
  }

  return {
    id: options.id,
    kind: "country-boat" as const,
    waterBodyId: water.id,
    center: [center[0], (topY + keelY) / 2, center[1]] as Vec3,
    direction: tangent,
    dimensions: [length, 0.64, width] as Vec3,
  }
}

export function compileWaterfrontSceneryV3(options: {
  world: AuthoredWorldV3
  field: TerrainFieldV3
}): WaterfrontSceneryV3 {
  const target: WaterfrontSceneryV3 = {
    positions: [],
    indices: [],
    colors: [],
    features: [],
  }

  for (const scene of WATERFRONT_SCENES_V3) {
    const water = options.world.waterBodies.find(
      (candidate) => candidate.id === scene.waterBodyId
    )
    if (!water?.centerline || !water.width) {
      throw new Error(
        `${scene.id} requires line water "${scene.waterBodyId}" with a width`
      )
    }
    const sampled = sampleCenterline(
      water.centerline,
      scene.centerlineProgress
    )
    const leftNormal: Vec2 = [-sampled.tangent[1], sampled.tangent[0]]
    const bankNormal: Vec2 = [
      leftNormal[0] * scene.bankSide,
      leftNormal[1] * scene.bankSide,
    ]
    const dock = addDock({
      target,
      scene,
      water,
      field: options.field,
      centerlinePoint: sampled.point,
      tangent: sampled.tangent,
      bankNormal,
    })
    target.features.push({
      id: scene.id,
      kind: "ghat",
      waterBodyId: water.id,
      center: dock.center,
      direction: dock.direction,
      dimensions: [scene.dockWidth, 1.1, scene.dockLength],
    })

    const inward: Vec2 = [-bankNormal[0], -bankNormal[1]]
    const firstBoatLength = 4.8
    const secondBoatLength = 4.45
    const firstBoatWidth = 0.98
    const secondBoatWidth = 0.92
    const hullClearance = 0.22
    const firstTangentOffset =
      -(firstBoatWidth / 2 + scene.dockWidth / 2 + hullClearance)
    const secondTangentOffset =
      secondBoatWidth / 2 + scene.dockWidth / 2 + hullClearance
    const mooringInset = 0.52
    const dockCenter: Vec2 = [dock.center[0], dock.center[2]]
    const firstBoatCenter: Vec2 = [
      dockCenter[0] +
        inward[0] * mooringInset +
        sampled.tangent[0] * firstTangentOffset,
      dockCenter[1] +
        inward[1] * mooringInset +
        sampled.tangent[1] * firstTangentOffset,
    ]
    const secondBoatCenter: Vec2 = [
      dockCenter[0] +
        inward[0] * mooringInset +
        sampled.tangent[0] * secondTangentOffset,
      dockCenter[1] +
        inward[1] * mooringInset +
        sampled.tangent[1] * secondTangentOffset,
    ]
    const firstBoat = addBoat({
      target,
      id: `${scene.id}.boat.01`,
      water,
      center: firstBoatCenter,
      tangent: inward,
      length: firstBoatLength,
      width: firstBoatWidth,
    })
    const secondBoat = addBoat({
      target,
      id: `${scene.id}.boat.02`,
      water,
      center: secondBoatCenter,
      tangent: inward,
      length: secondBoatLength,
      width: secondBoatWidth,
    })
    target.features.push(firstBoat, secondBoat)

    const ropeY = water.waterLevel + 0.32
    const ropeColor = hexToLinearRgb(COLORS.rope)
    const moorings = [
      {
        dockOffset: -scene.dockWidth * 0.43,
        boat: firstBoat,
        boatSide: firstBoat.dimensions[2] * 0.43,
      },
      {
        dockOffset: scene.dockWidth * 0.43,
        boat: secondBoat,
        boatSide: -secondBoat.dimensions[2] * 0.43,
      },
    ] as const
    for (const mooring of moorings) {
      const ropeAlongDock = 0.64
      addRibbon(
        target,
        [
          dockCenter[0] +
            inward[0] * ropeAlongDock +
            sampled.tangent[0] * mooring.dockOffset,
          ropeY,
          dockCenter[1] +
            inward[1] * ropeAlongDock +
            sampled.tangent[1] * mooring.dockOffset,
        ],
        [
          mooring.boat.center[0] +
            sampled.tangent[0] * mooring.boatSide +
            inward[0] * 0.1,
          ropeY,
          mooring.boat.center[2] +
            sampled.tangent[1] * mooring.boatSide +
            inward[1] * 0.1,
        ],
        0.026,
        ropeColor
      )
    }
  }

  return target
}
