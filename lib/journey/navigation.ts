import type {
  JourneyLandmarkId,
  RoadSide,
  WorldPosition,
} from "@/lib/journey/types"
import {
  educationRoadProgress,
  JOURNEY_BUILDING_PLOTS,
  JOURNEY_CROSSWALK_PROGRESS,
  JOURNEY_LANDMARK_LAYOUTS,
  JOURNEY_START_POSITION,
  JOURNEY_STREET,
  JOURNEY_TOWN_ROAD_PROGRESS,
  positionBesideRoad,
} from "@/lib/journey/world-layout"

interface NavigationNode {
  id: string
  position: WorldPosition
  neighbors: readonly NavigationEdge[]
}

interface NavigationEdge {
  id: string
  cost: number
}

interface QueueEntry {
  id: string
  cost: number
}

const SIDEWALK_START = educationRoadProgress(0.055)
const SIDEWALK_END = 0.985
const SIDEWALK_STEPS = 392
const PREFERRED_SIDEWALK: RoadSide = -1
const OPPOSITE_SIDEWALK_COST_MULTIPLIER = 64

export const JOURNEY_MAP_BOUNDS = {
  minX: -25,
  maxX: 72,
  minZ: -390,
  maxZ: 18,
} as const

function nodeId(side: RoadSide, index: number) {
  return `${side === -1 ? "west" : "east"}-${index}`
}

function distanceSquared(
  first: { x: number; z: number },
  second: WorldPosition
) {
  const dx = first.x - second[0]
  const dz = first.z - second[2]
  return dx * dx + dz * dz
}

function distance(first: WorldPosition, second: WorldPosition) {
  return Math.sqrt(distanceSquared({ x: first[0], z: first[2] }, second))
}

function nearestRouteIndex(progress: number) {
  return Math.round(
    ((progress - SIDEWALK_START) / (SIDEWALK_END - SIDEWALK_START)) *
      SIDEWALK_STEPS
  )
}

const crosswalkIndices = new Set(
  JOURNEY_CROSSWALK_PROGRESS.map(nearestRouteIndex)
)

const sidewalkRoutes = new Map<RoadSide, readonly WorldPosition[]>(
  ([-1, 1] as const).map((side) => [
    side,
    Array.from({ length: SIDEWALK_STEPS + 1 }, (_, index) => {
      const progress =
        SIDEWALK_START +
        ((SIDEWALK_END - SIDEWALK_START) * index) / SIDEWALK_STEPS
      return positionBesideRoad(progress, side, JOURNEY_STREET.sidewalkOffset)
    }),
  ])
)

const navigationNodeMap = new Map<string, NavigationNode>()

for (const side of [-1, 1] as const) {
  const route = sidewalkRoutes.get(side) ?? []
  route.forEach((position, index) => {
    const neighbors: NavigationEdge[] = []
    if (index > 0) {
      neighbors.push({
        id: nodeId(side, index - 1),
        cost:
          distance(position, route[index - 1]) *
          (side === PREFERRED_SIDEWALK ? 1 : OPPOSITE_SIDEWALK_COST_MULTIPLIER),
      })
    }
    if (index < route.length - 1) {
      neighbors.push({
        id: nodeId(side, index + 1),
        cost:
          distance(position, route[index + 1]) *
          (side === PREFERRED_SIDEWALK ? 1 : OPPOSITE_SIDEWALK_COST_MULTIPLIER),
      })
    }
    if (crosswalkIndices.has(index)) {
      const oppositePosition = sidewalkRoutes.get(side === -1 ? 1 : -1)?.[index]
      if (oppositePosition) {
        neighbors.push({
          id: nodeId(side === -1 ? 1 : -1, index),
          cost: distance(position, oppositePosition),
        })
      }
    }
    navigationNodeMap.set(nodeId(side, index), {
      id: nodeId(side, index),
      position,
      neighbors,
    })
  })
}

export const JOURNEY_NAVIGATION_NODES = [...navigationNodeMap.values()]

class MinPriorityQueue {
  private entries: QueueEntry[] = []

  get size() {
    return this.entries.length
  }

  push(entry: QueueEntry) {
    this.entries.push(entry)
    let index = this.entries.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.entries[parent].cost <= entry.cost) break
      this.entries[index] = this.entries[parent]
      index = parent
    }
    this.entries[index] = entry
  }

  pop() {
    const first = this.entries[0]
    const last = this.entries.pop()
    if (!first || !last || this.entries.length === 0) return first

    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.entries.length) break
      const child =
        right < this.entries.length &&
        this.entries[right].cost < this.entries[left].cost
          ? right
          : left
      if (this.entries[child].cost >= last.cost) break
      this.entries[index] = this.entries[child]
      index = child
    }
    this.entries[index] = last
    return first
  }
}

const destinationProgress: Record<string, number> = {
  "town-square": JOURNEY_TOWN_ROAD_PROGRESS,
  ...Object.fromEntries(
    Object.values(JOURNEY_BUILDING_PLOTS).map((plot) => [
      plot.id,
      plot.roadProgress,
    ])
  ),
}

const destinationSide: Record<string, RoadSide> = {
  "town-square": -1,
  ...Object.fromEntries(
    Object.values(JOURNEY_BUILDING_PLOTS).map((plot) => [
      plot.id,
      plot.roadSide,
    ])
  ),
}

function shortestPathTree(targetId: string) {
  const costs = new Map<string, number>([[targetId, 0]])
  const next = new Map<string, string>()
  const queue = new MinPriorityQueue()
  queue.push({ id: targetId, cost: 0 })

  while (queue.size > 0) {
    const current = queue.pop()
    if (!current || current.cost !== costs.get(current.id)) continue
    const node = navigationNodeMap.get(current.id)
    if (!node) continue
    for (const edge of node.neighbors) {
      const candidateCost = current.cost + edge.cost
      if (candidateCost >= (costs.get(edge.id) ?? Number.POSITIVE_INFINITY)) {
        continue
      }
      costs.set(edge.id, candidateCost)
      next.set(edge.id, current.id)
      queue.push({ id: edge.id, cost: candidateCost })
    }
  }
  return next
}

const targetNodeByDestination = new Map<string, string>()
const routeTreeByDestination = new Map<string, ReadonlyMap<string, string>>()

for (const [id, progress] of Object.entries(destinationProgress)) {
  const side = destinationSide[id]
  if (!side) continue
  const targetId = nodeId(side, nearestRouteIndex(progress))
  targetNodeByDestination.set(id, targetId)
  routeTreeByDestination.set(id, shortestPathTree(targetId))
}

function nearestSidewalkNode(position: { x: number; z: number }) {
  let nearest: NavigationNode | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const node of JOURNEY_NAVIGATION_NODES) {
    const candidateDistance = distanceSquared(position, node.position)
    if (candidateDistance < nearestDistance) {
      nearest = node
      nearestDistance = candidateDistance
    }
  }
  return nearest
}

const TOWN_START_TURN = positionBesideRoad(
  educationRoadProgress(0.08),
  -1,
  JOURNEY_STREET.outerEdge + 4.78
)
const TOWN_START_APPROACH = positionBesideRoad(
  JOURNEY_TOWN_ROAD_PROGRESS,
  -1,
  JOURNEY_STREET.outerEdge + 4.78
)

export function buildAssistedRoute(
  current: { x: number; z: number },
  destinationId: JourneyLandmarkId
): WorldPosition[] {
  const layout = JOURNEY_LANDMARK_LAYOUTS[destinationId]
  if (!layout) return []
  if (distanceSquared(current, layout.checkpointPosition) <= 2.2 * 2.2) {
    return []
  }

  if (
    destinationId === "town-square" &&
    distanceSquared(current, JOURNEY_START_POSITION) <= 4
  ) {
    return [TOWN_START_TURN, TOWN_START_APPROACH, layout.checkpointPosition]
  }

  const start = nearestSidewalkNode(current)
  const targetId = targetNodeByDestination.get(destinationId)
  const routeTree = routeTreeByDestination.get(destinationId)
  if (!start || !targetId || !routeTree) return []

  const positions: WorldPosition[] = []
  let currentId = start.id
  let safety = JOURNEY_NAVIGATION_NODES.length + 1
  while (currentId !== targetId && safety > 0) {
    const node = navigationNodeMap.get(currentId)
    if (node && distanceSquared(current, node.position) > 1) {
      positions.push(node.position)
    }
    const nextId = routeTree.get(currentId)
    if (!nextId) return []
    currentId = nextId
    safety -= 1
  }

  const target = navigationNodeMap.get(targetId)
  if (target) positions.push(target.position)
  positions.push(layout.sidewalkAnchorPosition, layout.checkpointPosition)

  const route: WorldPosition[] = []
  for (const position of positions) {
    const previous = route.at(-1)
    if (
      !previous ||
      distanceSquared({ x: position[0], z: position[2] }, previous) > 0.0625
    ) {
      route.push(position)
    }
  }
  return route
}
