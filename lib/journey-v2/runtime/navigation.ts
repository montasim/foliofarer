import * as THREE from "three"
import type {
  JourneyWorldNavigationEdge,
  JourneyWorldNavigationNode,
  Vec2,
  Vec3,
} from "@/lib/journey-v2/runtime/types"

interface GraphEdge {
  targetId: string
  cost: number
  portal?: readonly [Vec2, Vec2]
}

interface QueueEntry {
  id: string
  distance: number
}

interface OrientedPortal {
  left: Vec2
  right: Vec2
}

const PORTAL_EPSILON = 1e-5

function signedTriangleArea(a: Vec2, b: Vec2, c: Vec2) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function samePoint(a: Vec2, b: Vec2) {
  return (
    Math.abs(a[0] - b[0]) <= PORTAL_EPSILON &&
    Math.abs(a[1] - b[1]) <= PORTAL_EPSILON
  )
}

function orientPortal(
  from: JourneyWorldNavigationNode,
  to: JourneyWorldNavigationNode,
  portal: readonly [Vec2, Vec2]
): OrientedPortal {
  const origin: Vec2 = [from.position[0], from.position[2]]
  const destination: Vec2 = [to.position[0], to.position[2]]
  const firstSide = signedTriangleArea(origin, destination, portal[0])
  const secondSide = signedTriangleArea(origin, destination, portal[1])
  // Three.js uses XZ for the ground plane; compared with the usual XY funnel
  // notation, its screen-facing winding is reversed.
  return firstSide <= secondSide
    ? { left: portal[0], right: portal[1] }
    : { left: portal[1], right: portal[0] }
}

/**
 * String-pulls a route through triangle portals. The graph still enforces the
 * exact sidewalk/crosswalk topology, while the avatar follows the corridor
 * instead of zigzagging through every triangle centroid.
 */
function pullString(portals: readonly OrientedPortal[]) {
  if (portals.length === 0) return [] as Vec2[]

  const points: Vec2[] = [portals[0].left]
  let apex = portals[0].left
  let left = portals[0].left
  let right = portals[0].right
  let apexIndex = 0
  let leftIndex = 0
  let rightIndex = 0

  for (let index = 1; index < portals.length; index += 1) {
    const nextLeft = portals[index].left
    const nextRight = portals[index].right

    if (signedTriangleArea(apex, right, nextRight) <= 0) {
      if (
        samePoint(apex, right) ||
        signedTriangleArea(apex, left, nextRight) > 0
      ) {
        right = nextRight
        rightIndex = index
      } else {
        if (!samePoint(points[points.length - 1], left)) points.push(left)
        apex = left
        apexIndex = leftIndex
        left = apex
        right = apex
        leftIndex = apexIndex
        rightIndex = apexIndex
        index = apexIndex
        continue
      }
    }

    if (signedTriangleArea(apex, left, nextLeft) >= 0) {
      if (
        samePoint(apex, left) ||
        signedTriangleArea(apex, right, nextLeft) < 0
      ) {
        left = nextLeft
        leftIndex = index
      } else {
        if (!samePoint(points[points.length - 1], right)) points.push(right)
        apex = right
        apexIndex = rightIndex
        left = apex
        right = apex
        leftIndex = apexIndex
        rightIndex = apexIndex
        index = apexIndex
      }
    }
  }

  const destination = portals[portals.length - 1].left
  if (!samePoint(points[points.length - 1], destination)) {
    points.push(destination)
  }
  return points
}

class MinQueue {
  private entries: QueueEntry[] = []

  get size() {
    return this.entries.length
  }

  push(entry: QueueEntry) {
    this.entries.push(entry)
    let index = this.entries.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.entries[parent].distance <= entry.distance) break
      this.entries[index] = this.entries[parent]
      index = parent
    }
    this.entries[index] = entry
  }

  pop() {
    if (this.entries.length === 0) return null
    const first = this.entries[0]
    const last = this.entries.pop()
    if (!last || this.entries.length === 0) return first

    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.entries.length) break
      const smallest =
        right < this.entries.length &&
        this.entries[right].distance < this.entries[left].distance
          ? right
          : left
      if (this.entries[smallest].distance >= last.distance) break
      this.entries[index] = this.entries[smallest]
      index = smallest
    }
    this.entries[index] = last
    return first
  }
}

export class JourneyNavigation {
  private readonly nodes = new Map<string, JourneyWorldNavigationNode>()
  private readonly adjacency = new Map<string, GraphEdge[]>()
  private readonly routeCache = new Map<string, Map<string, string | null>>()

  constructor(
    nodes: JourneyWorldNavigationNode[],
    edges: JourneyWorldNavigationEdge[],
    private readonly landmarkNodeIds: Record<string, string>
  ) {
    for (const node of nodes) {
      this.nodes.set(node.id, node)
      this.adjacency.set(node.id, [])
    }
    for (const edge of edges) {
      if (!this.nodes.has(edge.a) || !this.nodes.has(edge.b)) continue
      this.adjacency.get(edge.a)?.push({
        targetId: edge.b,
        cost: Math.max(edge.cost, 0.001),
        portal: "portal" in edge ? edge.portal : undefined,
      })
      this.adjacency.get(edge.b)?.push({
        targetId: edge.a,
        cost: Math.max(edge.cost, 0.001),
        portal: "portal" in edge ? edge.portal : undefined,
      })
    }
  }

  nearestNode(position: THREE.Vector3) {
    let nearest: JourneyWorldNavigationNode | null = null
    let nearestDistanceSquared = Number.POSITIVE_INFINITY
    for (const node of this.nodes.values()) {
      const x = node.position[0] - position.x
      const z = node.position[2] - position.z
      const distanceSquared = x * x + z * z
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared
        nearest = node
      }
    }
    return nearest
  }

  private predecessorsFor(destinationNodeId: string) {
    const cached = this.routeCache.get(destinationNodeId)
    if (cached) return cached

    const predecessors = new Map<string, string | null>([
      [destinationNodeId, null],
    ])
    const distances = new Map<string, number>([[destinationNodeId, 0]])
    const queue = new MinQueue()
    queue.push({ id: destinationNodeId, distance: 0 })

    while (queue.size > 0) {
      const current = queue.pop()
      if (!current) break
      if (current.distance !== distances.get(current.id)) continue

      for (const edge of this.adjacency.get(current.id) ?? []) {
        const nextDistance = current.distance + edge.cost
        if (nextDistance >= (distances.get(edge.targetId) ?? Infinity)) continue
        distances.set(edge.targetId, nextDistance)
        predecessors.set(edge.targetId, current.id)
        queue.push({ id: edge.targetId, distance: nextDistance })
      }
    }

    this.routeCache.set(destinationNodeId, predecessors)
    return predecessors
  }

  routeToLandmark(position: THREE.Vector3, landmarkId: string): Vec3[] | null {
    const destinationNodeId = this.landmarkNodeIds[landmarkId]
    const destinationNode = destinationNodeId
      ? this.nodes.get(destinationNodeId)
      : null
    const startNode = this.nearestNode(position)
    if (!destinationNode || !startNode) return null

    const predecessors = this.predecessorsFor(destinationNodeId)
    if (!predecessors.has(startNode.id)) return null

    const routeNodeIds: string[] = []
    let cursor: string | null = startNode.id
    const visited = new Set<string>()
    while (cursor) {
      if (visited.has(cursor)) return null
      visited.add(cursor)
      if (!this.nodes.has(cursor)) return null
      routeNodeIds.push(cursor)
      if (cursor === destinationNodeId) break
      cursor = predecessors.get(cursor) ?? null
    }

    if (routeNodeIds.length === 0) return null

    const start: Vec2 = [position.x, position.z]
    const destination: Vec2 = [
      destinationNode.position[0],
      destinationNode.position[2],
    ]
    const portals: OrientedPortal[] = [{ left: start, right: start }]
    for (let index = 0; index < routeNodeIds.length - 1; index += 1) {
      const from = this.nodes.get(routeNodeIds[index])
      const to = this.nodes.get(routeNodeIds[index + 1])
      const edge = this.adjacency
        .get(routeNodeIds[index])
        ?.find((candidate) => candidate.targetId === routeNodeIds[index + 1])
      if (!from || !to || !edge?.portal) {
        return routeNodeIds.map((id) => this.nodes.get(id)!.position)
      }
      portals.push(orientPortal(from, to, edge.portal))
    }
    portals.push({ left: destination, right: destination })

    return pullString(portals).map(
      ([x, z]) => [x, destinationNode.position[1], z] as Vec3
    )
  }
}
