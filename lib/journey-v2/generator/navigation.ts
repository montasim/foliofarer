import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import type {
  NavigationEdge,
  NavigationNode,
  Vec2,
  Vec3,
} from "../contracts/world.ts"
import {
  distance,
  pointInMultiPolygon,
  round,
  triangleCentroid,
  triangulateMultiPolygon,
} from "./geometry.ts"
import type { CompiledBuilding } from "./placement.ts"
import type { CompiledCrosswalk } from "./scenery.ts"
import { cellIdAt } from "./spatial.ts"

const { union } = polygonClipping

export interface CompiledNavigation {
  walkable: MultiPolygon
  nodes: NavigationNode[]
  edges: NavigationEdge[]
  landmarkNodeIds: Record<string, string>
  crosswalkNodeIds: Record<string, [string, string]>
}

function midpoint(a: Vec3, b: Vec3): Vec2 {
  return [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2]
}

function closestNode(nodes: readonly NavigationNode[], point: Vec2) {
  let best = nodes[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const candidate = distance([node.position[0], node.position[2]], point)
    if (candidate < bestDistance) {
      best = node
      bestDistance = candidate
    }
  }
  if (!best) throw new Error("Navigation mesh did not create any nodes")
  return best
}

export function compileNavigation(options: {
  sidewalk: MultiPolygon
  accessPolygons: readonly Polygon[]
  crosswalks: readonly CompiledCrosswalk[]
  buildings: readonly CompiledBuilding[]
  cellSize: number
}): CompiledNavigation {
  const walkable = union(
    options.sidewalk,
    ...options.accessPolygons,
    ...options.crosswalks.map((crosswalk) => crosswalk.polygon)
  )
  const mesh = triangulateMultiPolygon(
    "internal.navigation",
    "surface",
    "surface.sidewalk",
    0.061,
    walkable
  )
  const nodes: NavigationNode[] = []
  const nodeCrosswalkIds = new Map<string, string>()
  const triangles: [number, number, number][] = []

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle: [number, number, number] = [
      mesh.indices[index],
      mesh.indices[index + 1],
      mesh.indices[index + 2],
    ]
    triangles.push(triangle)
    const center = triangleCentroid(
      mesh.positions,
      triangle[0],
      triangle[1],
      triangle[2]
    )
    const crosswalk = options.crosswalks.find((candidate) =>
      pointInMultiPolygon(center, [candidate.polygon])
    )
    const isAccess = options.accessPolygons.some((polygon) =>
      pointInMultiPolygon(center, [polygon])
    )
    const id = `nav.${String(triangles.length - 1).padStart(4, "0")}`
    nodes.push({
      id,
      position: [round(center[0]), 0.065, round(center[1])],
      cellId: cellIdAt(center, options.cellSize),
      kind: crosswalk ? "crossing" : isAccess ? "entrance" : "sidewalk",
    })
    if (crosswalk) nodeCrosswalkIds.set(id, crosswalk.id)
  }

  const edgeOwners = new Map<string, number[]>()
  for (const [triangleIndex, triangle] of triangles.entries()) {
    for (const [a, b] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const owners = edgeOwners.get(key) ?? []
      owners.push(triangleIndex)
      edgeOwners.set(key, owners)
    }
  }

  const edges: NavigationEdge[] = []
  for (const [edgeKey, owners] of edgeOwners) {
    if (owners.length !== 2) continue
    const a = nodes[owners[0]]
    const b = nodes[owners[1]]
    const [portalAIndex, portalBIndex] = edgeKey
      .split(":")
      .map((value) => Number(value))
    const portal = [
      [
        round(mesh.positions[portalAIndex * 3]),
        round(mesh.positions[portalAIndex * 3 + 2]),
      ],
      [
        round(mesh.positions[portalBIndex * 3]),
        round(mesh.positions[portalBIndex * 3 + 2]),
      ],
    ] as const
    const center = midpoint(a.position, b.position)
    const crosswalk = options.crosswalks.find((candidate) =>
      pointInMultiPolygon(center, [candidate.polygon])
    )
    const kind =
      crosswalk || a.kind === "crossing" || b.kind === "crossing"
        ? "crossing"
        : a.kind === "entrance" || b.kind === "entrance"
          ? "entrance"
          : "sidewalk"
    const edge: NavigationEdge = {
      a: a.id,
      b: b.id,
      cost: round(
        distance([a.position[0], a.position[2]], [b.position[0], b.position[2]])
      ),
      kind,
      portal,
    }
    const crosswalkId =
      crosswalk?.id ?? nodeCrosswalkIds.get(a.id) ?? nodeCrosswalkIds.get(b.id)
    if (kind === "crossing" && crosswalkId) edge.crosswalkId = crosswalkId
    edges.push(edge)
  }

  const landmarkNodeIds: Record<string, string> = {}
  for (const building of options.buildings) {
    if (!building.landmark) continue
    landmarkNodeIds[building.landmark.id] = closestNode(nodes, [
      building.entrance[0],
      building.entrance[2],
    ]).id
  }

  const crosswalkNodeIds: Record<string, [string, string]> = {}
  for (const crosswalk of options.crosswalks) {
    const crossingNodes = nodes.filter(
      (node) => nodeCrosswalkIds.get(node.id) === crosswalk.id
    )
    const candidates = crossingNodes.length > 1 ? crossingNodes : nodes
    const sorted = [...candidates].sort((a, b) => {
      const aProjection =
        (a.position[0] - crosswalk.center[0]) * crosswalk.normal[0] +
        (a.position[2] - crosswalk.center[1]) * crosswalk.normal[1]
      const bProjection =
        (b.position[0] - crosswalk.center[0]) * crosswalk.normal[0] +
        (b.position[2] - crosswalk.center[1]) * crosswalk.normal[1]
      return aProjection - bProjection
    })
    crosswalkNodeIds[crosswalk.id] = [
      sorted[0].id,
      sorted[sorted.length - 1].id,
    ]
  }

  return { walkable, nodes, edges, landmarkNodeIds, crosswalkNodeIds }
}
