import * as THREE from "three"

const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4
const SLOT_WIDTH = 512
const SLOT_HEIGHT = 96
const ATLAS_WIDTH = ATLAS_COLUMNS * SLOT_WIDTH
const ATLAS_HEIGHT = ATLAS_ROWS * SLOT_HEIGHT
const LABEL_INK = "#143d42"
const LABEL_PAPER = "#f8f1e1"
const LABEL_TERRACOTTA = "#c76343"
const LABEL_BRASS = "#d8b36a"
const PLAQUE_FACE_STANDOFF = 0.34
const PLAQUE_BACKING_RECESS = 0.045
const PLAQUE_BACKING_MARGIN_X = 0.16
const PLAQUE_BACKING_MARGIN_Y = 0.14
const PARK_MARKER_INSET = 0.38
const PARK_MARKER_PATH_CLEARANCE = 0.72
const PARK_MARKER_CENTER_HEIGHT = 1.58
const PARK_MARKER_POST_WIDTH = 0.11
const PARK_MARKER_POST_INSET = 0.32

export type JourneyBuildingLabelMount = "facade" | "freestanding"

export interface JourneyWayfindingBuilding {
  id: string
  archetype?: string
  footprint: readonly (readonly [number, number])[]
  baseHeight?: number
  height: number
  entrance: readonly [number, number, number]
}

export interface JourneyBuildingLabelPlacement {
  position: readonly [number, number, number]
  outward: readonly [number, number]
  width: number
  height: number
  mount: JourneyBuildingLabelMount
  supportBaseY: number
}

interface AtlasSlot {
  u0: number
  v0: number
  u1: number
  v1: number
}

export interface JourneyBuildingWayfindingAtlas {
  material: THREE.MeshBasicMaterial
  slot: (buildingId: string) => AtlasSlot | null
  dispose: () => void
}

export interface JourneyBuildingWayfindingMesh {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  dispose: () => void
}

function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number]
) {
  const edgeX = end[0] - start[0]
  const edgeZ = end[1] - start[1]
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ
  const fraction =
    lengthSquared <= Number.EPSILON
      ? 0
      : THREE.MathUtils.clamp(
          ((point[0] - start[0]) * edgeX + (point[1] - start[1]) * edgeZ) /
            lengthSquared,
          0,
          1
        )
  return {
    distance: Math.hypot(
      start[0] + edgeX * fraction - point[0],
      start[1] + edgeZ * fraction - point[1]
    ),
    length: Math.sqrt(lengthSquared),
  }
}

function estimatedLabelWidth(label: string) {
  const units = [...label].reduce((total, character) => {
    if (character === " ") return total + 0.38
    if ("MWQ".includes(character)) return total + 0.88
    if ("I1".includes(character)) return total + 0.34
    return total + 0.64
  }, 0)
  return 1.82 + units * 0.255
}

/**
 * Places the plaque on the façade edge nearest the authored entrance. The
 * outward normal is derived from the footprint so every road side follows the
 * same deterministic rule. The plaque face uses one canopy-safe standoff for
 * every enclosed archetype; this keeps the backing clear of procedural
 * lintels, windows, and entrance canopies instead of relying on per-building
 * offsets.
 */
export function resolveJourneyBuildingLabelPlacement(
  building: JourneyWayfindingBuilding,
  label: string
): JourneyBuildingLabelPlacement | null {
  const signLabel = formatJourneyBuildingWayfindingLabel(label)
  if (building.footprint.length < 3 || signLabel.length === 0) return null

  const center = building.footprint.reduce(
    (sum, point) => {
      sum.x += point[0] / building.footprint.length
      sum.z += point[1] / building.footprint.length
      return sum
    },
    { x: 0, z: 0 }
  )
  const entrance2: readonly [number, number] = [
    building.entrance[0],
    building.entrance[2],
  ]
  let façadeWidth = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < building.footprint.length; index += 1) {
    const edge = distanceToSegment(
      entrance2,
      building.footprint[index],
      building.footprint[(index + 1) % building.footprint.length]
    )
    if (edge.distance < nearestDistance) {
      nearestDistance = edge.distance
      façadeWidth = edge.length
    }
  }

  const frontX = entrance2[0] - center.x
  const frontZ = entrance2[1] - center.z
  const frontLength = Math.hypot(frontX, frontZ)
  if (frontLength <= Number.EPSILON || façadeWidth <= Number.EPSILON) {
    return null
  }
  const outwardX = frontX / frontLength
  const outwardZ = frontZ / frontLength
  const availableWidth = Math.max(2.45, façadeWidth - 0.72)
  const minimumWidth = Math.min(2.8, availableWidth)
  const width = THREE.MathUtils.clamp(
    estimatedLabelWidth(signLabel),
    minimumWidth,
    Math.min(5.4, availableWidth)
  )
  const baseHeight = building.baseHeight ?? building.entrance[1] - 0.08

  if (building.archetype === "town-pavilion") {
    const rightX = outwardZ
    const rightZ = -outwardX
    const lateralOffset = width / 2 + PARK_MARKER_PATH_CLEARANCE
    return {
      position: [
        building.entrance[0] -
          outwardX * PARK_MARKER_INSET +
          rightX * lateralOffset,
        baseHeight + PARK_MARKER_CENTER_HEIGHT,
        building.entrance[2] -
          outwardZ * PARK_MARKER_INSET +
          rightZ * lateralOffset,
      ],
      outward: [outwardX, outwardZ],
      width,
      height: 0.62,
      mount: "freestanding",
      supportBaseY: baseHeight + 0.04,
    }
  }

  return {
    position: [
      building.entrance[0] + outwardX * PLAQUE_FACE_STANDOFF,
      baseHeight + THREE.MathUtils.clamp(building.height * 0.5, 2.72, 3.18),
      building.entrance[2] + outwardZ * PLAQUE_FACE_STANDOFF,
    ],
    outward: [outwardX, outwardZ],
    width,
    height: 0.62,
    mount: "facade",
    supportBaseY: baseHeight,
  }
}

function trackedTextWidth(
  context: CanvasRenderingContext2D,
  value: string,
  tracking: number
) {
  return (
    [...value].reduce(
      (width, character) => width + context.measureText(character).width,
      0
    ) +
    Math.max(0, value.length - 1) * tracking
  )
}

function drawTrackedText(
  context: CanvasRenderingContext2D,
  value: string,
  centerX: number,
  baselineY: number,
  tracking: number
) {
  let cursor = centerX - trackedTextWidth(context, value, tracking) / 2
  for (const character of value) {
    context.fillText(character, cursor, baselineY)
    cursor += context.measureText(character).width + tracking
  }
}

/**
 * Converts authored compact/camel-case names into sign copy without changing
 * the canonical DOM label. Existing word spacing and acronyms are preserved.
 */
export function formatJourneyBuildingWayfindingLabel(label: string) {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase()
}

function drawLabelSlot(
  context: CanvasRenderingContext2D,
  label: string,
  column: number,
  row: number
) {
  const x = column * SLOT_WIDTH
  const y = row * SLOT_HEIGHT
  context.fillStyle = LABEL_INK
  context.fillRect(x, y, SLOT_WIDTH, SLOT_HEIGHT)
  context.strokeStyle = LABEL_BRASS
  context.lineWidth = 3
  context.strokeRect(x + 7.5, y + 7.5, SLOT_WIDTH - 15, SLOT_HEIGHT - 15)
  context.fillStyle = LABEL_TERRACOTTA
  context.fillRect(x + 18, y + 22, 6, SLOT_HEIGHT - 44)

  const text = formatJourneyBuildingWayfindingLabel(label)
  const maximumTextWidth = SLOT_WIDTH - 76
  let fontSize = 46
  let tracking = 2.4
  do {
    context.font = `700 ${fontSize}px "Arial Narrow", "Liberation Sans Narrow", sans-serif`
    tracking = Math.max(1, fontSize * 0.052)
    if (
      trackedTextWidth(context, text, tracking) <= maximumTextWidth ||
      fontSize <= 27
    ) {
      break
    }
    fontSize -= 1
  } while (fontSize > 26)

  context.fillStyle = LABEL_PAPER
  context.textBaseline = "middle"
  drawTrackedText(
    context,
    text,
    x + SLOT_WIDTH / 2 + 8,
    y + SLOT_HEIGHT / 2 - 1,
    tracking
  )
}

/**
 * Builds one in-memory atlas and one material for the complete route. It is
 * shared by every streamed cell, so labels add one texture globally and at
 * most one draw call per visible signed cell.
 */
export function createJourneyBuildingWayfindingAtlas(
  labels: ReadonlyMap<string, string>
): JourneyBuildingWayfindingAtlas | null {
  if (typeof document === "undefined" || labels.size === 0) return null
  const entries = [...labels.entries()]
    .filter(([, label]) => label.trim().length > 0)
    .sort(([first], [second]) => first.localeCompare(second))
    .slice(0, ATLAS_COLUMNS * ATLAS_ROWS)
  if (entries.length === 0) return null

  const canvas = document.createElement("canvas")
  canvas.width = ATLAS_WIDTH
  canvas.height = ATLAS_HEIGHT
  const context = canvas.getContext("2d")
  if (!context) return null

  const slots = new Map<string, AtlasSlot>()
  entries.forEach(([buildingId, label], index) => {
    const column = index % ATLAS_COLUMNS
    const row = Math.floor(index / ATLAS_COLUMNS)
    drawLabelSlot(context, label, column, row)
    const insetX = 1 / ATLAS_WIDTH
    const insetY = 1 / ATLAS_HEIGHT
    slots.set(buildingId, {
      u0: column / ATLAS_COLUMNS + insetX,
      u1: (column + 1) / ATLAS_COLUMNS - insetX,
      v0: 1 - (row + 1) / ATLAS_ROWS + insetY,
      v1: 1 - row / ATLAS_ROWS - insetY,
    })
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.name = "journey-wayfinding-atlas"
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 4
  texture.needsUpdate = true

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.FrontSide,
    toneMapped: false,
    depthWrite: true,
  })
  material.name = "journey-wayfinding-material"

  return {
    material,
    slot: (buildingId) => slots.get(buildingId) ?? null,
    dispose: () => {
      material.dispose()
      texture.dispose()
    },
  }
}

function appendFacingQuad(
  positions: number[],
  uvs: number[],
  indices: number[],
  options: {
    center: readonly [number, number, number]
    outward: readonly [number, number]
    width: number
    height: number
    normalOffset?: number
    uv: readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  }
) {
  const [normalX, normalZ] = options.outward
  const rightX = normalZ
  const rightZ = -normalX
  const normalOffset = options.normalOffset ?? 0
  const centerX = options.center[0] + normalX * normalOffset
  const centerY = options.center[1]
  const centerZ = options.center[2] + normalZ * normalOffset
  const halfWidth = options.width / 2
  const halfHeight = options.height / 2
  const offset = positions.length / 3

  positions.push(
    centerX - rightX * halfWidth,
    centerY - halfHeight,
    centerZ - rightZ * halfWidth,
    centerX + rightX * halfWidth,
    centerY - halfHeight,
    centerZ + rightZ * halfWidth,
    centerX + rightX * halfWidth,
    centerY + halfHeight,
    centerZ + rightZ * halfWidth,
    centerX - rightX * halfWidth,
    centerY + halfHeight,
    centerZ - rightZ * halfWidth
  )
  uvs.push(...options.uv)
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3)
}

export function createJourneyBuildingWayfindingMesh(
  buildings: readonly JourneyWayfindingBuilding[],
  labels: ReadonlyMap<string, string>,
  atlas: JourneyBuildingWayfindingAtlas
): JourneyBuildingWayfindingMesh | null {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const renderedLabels: string[] = []
  const renderedBuildingIds: string[] = []
  const renderedMounts: JourneyBuildingLabelMount[] = []

  for (const building of buildings) {
    const label = labels.get(building.id)?.trim()
    const slot = atlas.slot(building.id)
    if (!label || !slot) continue
    const placement = resolveJourneyBuildingLabelPlacement(building, label)
    if (!placement) continue
    const [centerX, centerY, centerZ] = placement.position
    const [normalX, normalZ] = placement.outward
    const rightX = normalZ
    const rightZ = -normalX
    const solidU = (slot.u0 + slot.u1) / 2
    const solidV = slot.v0 + (slot.v1 - slot.v0) * 0.8
    const solidUv = [
      solidU,
      solidV,
      solidU,
      solidV,
      solidU,
      solidV,
      solidU,
      solidV,
    ] as const

    appendFacingQuad(positions, uvs, indices, {
      center: placement.position,
      outward: placement.outward,
      width: placement.width + PLAQUE_BACKING_MARGIN_X,
      height: placement.height + PLAQUE_BACKING_MARGIN_Y,
      normalOffset: -PLAQUE_BACKING_RECESS,
      uv: solidUv,
    })
    appendFacingQuad(positions, uvs, indices, {
      center: placement.position,
      outward: placement.outward,
      width: placement.width,
      height: placement.height,
      uv: [
        slot.u0,
        slot.v0,
        slot.u1,
        slot.v0,
        slot.u1,
        slot.v1,
        slot.u0,
        slot.v1,
      ],
    })

    if (placement.mount === "freestanding") {
      const plaqueBottom = centerY - placement.height / 2
      const postTop = plaqueBottom + 0.06
      const postHeight = Math.max(0.2, postTop - placement.supportBaseY)
      const postCenterY = placement.supportBaseY + postHeight / 2
      const postOffset = Math.max(
        placement.width * 0.2,
        placement.width / 2 - PARK_MARKER_POST_INSET
      )
      for (const side of [-1, 1]) {
        appendFacingQuad(positions, uvs, indices, {
          center: [
            centerX + rightX * postOffset * side,
            postCenterY,
            centerZ + rightZ * postOffset * side,
          ],
          outward: placement.outward,
          width: PARK_MARKER_POST_WIDTH,
          height: postHeight,
          normalOffset: -PLAQUE_BACKING_RECESS,
          uv: solidUv,
        })
      }
    }

    renderedLabels.push(label)
    renderedBuildingIds.push(building.id)
    renderedMounts.push(placement.mount)
  }
  if (positions.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  )
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, atlas.material)
  mesh.name =
    renderedLabels.length === 1
      ? `journey-wayfinding-label.${renderedBuildingIds[0] ?? "arrival"}`
      : "journey-wayfinding-labels"
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 3
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  mesh.userData.journeyWayfindingLabels = renderedLabels
  mesh.userData.journeyWayfindingMounts = renderedMounts

  return {
    mesh,
    dispose: () => {
      mesh.removeFromParent()
      geometry.dispose()
    },
  }
}
