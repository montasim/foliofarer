"use client"

import { IconMap2 } from "@tabler/icons-react"
import generatedWorldIndex from "@/public/journey-v2/generated-next/index.json"
import type { JourneyLandmark, JourneyLandmarkId } from "@/lib/journey/types"

type MapPoint = readonly [x: number, y: number]
type WorldPoint = readonly [x: number, z: number]

interface GeneratedRoad {
  id: string
  centerline: readonly (readonly [number, number, number])[]
}

interface GeneratedCheckpoint {
  recordId: string
  position: readonly [number, number, number]
}

interface GeneratedCell {
  id: string
  districtId: string
  bounds: readonly [minX: number, minZ: number, maxX: number, maxZ: number]
}

interface GeneratedWaterBody {
  id: string
  polygon: readonly WorldPoint[] | readonly (readonly WorldPoint[])[]
}

interface GeneratedBridge {
  id: string
  deckPolygon: readonly WorldPoint[]
}

interface GeneratedMiniMapSource {
  world: {
    bounds: readonly [minX: number, minZ: number, maxX: number, maxZ: number]
  }
  cells: readonly GeneratedCell[]
  roads: readonly GeneratedRoad[]
  checkpoints: readonly GeneratedCheckpoint[]
  waterBodies: readonly GeneratedWaterBody[]
  bridges: readonly GeneratedBridge[]
}

export interface JourneyV2MiniMapProps {
  landmarks: readonly JourneyLandmark[]
  destinationId: JourneyLandmarkId
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  playerPosition: { x: number; z: number } | null
  expanded?: boolean
  onOpen: () => void
}

const MAP_PADDING = 6
const MAP_SIZE = 100
const WORLD = generatedWorldIndex as unknown as GeneratedMiniMapSource
const DISTRICT_WASH: Readonly<Record<string, string>> = Object.freeze({
  town: "#d7c99f",
  education: "#b9cfaa",
  career: "#a8c5ae",
  learning: "#a9c9c0",
  projects: "#d5bd99",
  community: "#d1b7a1",
  contact: "#b7c9b0",
})

function mapWorldPoint([x, z]: WorldPoint): MapPoint {
  const [minX, minZ, maxX, maxZ] = WORLD.world.bounds
  const drawableSize = MAP_SIZE - MAP_PADDING * 2
  const mapX = MAP_PADDING + ((x - minX) / (maxX - minX)) * drawableSize
  const mapY = MAP_PADDING + ((maxZ - z) / (maxZ - minZ)) * drawableSize
  return [mapX, mapY]
}

function pathFromWorldPoints(points: readonly WorldPoint[], close = false) {
  const commands = points.map((point, index) => {
    const [x, y] = mapWorldPoint(point)
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
  })
  if (close && commands.length > 0) commands.push("Z")
  return commands.join(" ")
}

function roadPath(centerline: GeneratedRoad["centerline"]) {
  return pathFromWorldPoints(centerline.map(([x, , z]) => [x, z] as const))
}

function waterRings(polygon: GeneratedWaterBody["polygon"]) {
  if (polygon.length === 0) return []
  const first = polygon[0]
  return Array.isArray(first[0])
    ? (polygon as readonly (readonly WorldPoint[])[])
    : [polygon as readonly WorldPoint[]]
}

function waterPath(polygon: GeneratedWaterBody["polygon"]) {
  return waterRings(polygon)
    .map((ring) => pathFromWorldPoints(ring, true))
    .join(" ")
}

function mapCellBounds(
  bounds: GeneratedCell["bounds"]
): readonly [x: number, y: number, width: number, height: number] {
  const [minX, minZ, maxX, maxZ] = bounds
  const [x, y] = mapWorldPoint([minX, maxZ])
  const [right, bottom] = mapWorldPoint([maxX, minZ])
  return [x, y, right - x, bottom - y]
}

const CHECKPOINTS_BY_RECORD_ID = new Map(
  WORLD.checkpoints.map((checkpoint) => [checkpoint.recordId, checkpoint])
)

export function JourneyV2MiniMap({
  landmarks,
  destinationId,
  discoveredIds,
  playerPosition,
  expanded = false,
  onOpen,
}: JourneyV2MiniMapProps) {
  const destination = landmarks.find(
    (landmark) => landmark.id === destinationId
  )
  const discoveredCount = landmarks.filter((landmark) =>
    discoveredIds.has(landmark.id)
  ).length

  return (
    <button
      type="button"
      className="journey-mini-map journey-v2-mini-map ml-auto"
      aria-label="Open Atlas"
      aria-keyshortcuts="M"
      aria-expanded={expanded}
      aria-controls="journey-v2-world-atlas"
      data-journey-ui
      data-journey-mini-map
      data-journey-map-source="generated-next-index"
      data-destination-id={destinationId}
      onClick={onOpen}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="journey-kicker">Journey map</span>
        <IconMap2 aria-hidden="true" size={16} />
      </span>

      <span className="journey-mini-map-plot journey-v2-mini-map-plot relative mt-1.5 overflow-hidden border border-[#143d42]/25 bg-[#c9d6b5] sm:mt-2">
        <span className="sr-only">
          The map shows route districts, waterways, bridges, arrival buildings,
          the selected destination and your current position.
        </span>
        <span className="absolute top-1.5 left-1.5 z-10 bg-[#c9d6b5]/90 px-1 py-0.5 font-mono text-[8px] leading-none tracking-[0.14em] text-[#294945] uppercase">
          Start
        </span>
        <span className="absolute bottom-1.5 left-1.5 z-10 bg-[#c9d6b5]/90 px-1 py-0.5 font-mono text-[8px] leading-none tracking-[0.14em] text-[#294945] uppercase">
          End
        </span>
        <span
          aria-hidden="true"
          className="journey-mini-map-north"
          title="North"
        >
          <span>N</span>
          <i />
        </span>
        <span aria-hidden="true" className="journey-mini-map-scale">
          <i />
          <span>40 m</span>
        </span>

        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <rect width="100" height="100" fill="#c9d6b5" />

          <g data-journey-map-districts>
            {WORLD.cells.map((cell) => {
              const [x, y, width, height] = mapCellBounds(cell.bounds)
              return (
                <rect
                  key={cell.id}
                  data-cell-id={cell.id}
                  data-district-id={cell.districtId}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={DISTRICT_WASH[cell.districtId] ?? "#c9d6b5"}
                  fillOpacity="0.28"
                />
              )
            })}
          </g>

          <g data-journey-map-water>
            {WORLD.waterBodies.map((waterBody) => (
              <path
                key={waterBody.id}
                data-water-body-id={waterBody.id}
                d={waterPath(waterBody.polygon)}
                fill="#5ea9e1"
                fillOpacity="0.82"
                fillRule="evenodd"
                stroke="#397f9d"
                strokeOpacity="0.55"
                strokeWidth="0.65"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g data-journey-map-bridges>
            {WORLD.bridges.map((bridge) => (
              <path
                key={bridge.id}
                data-bridge-id={bridge.id}
                d={pathFromWorldPoints(bridge.deckPolygon, true)}
                fill="#e9ddc6"
                stroke="#8a7257"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g data-journey-map-roads>
            {WORLD.roads.map((road) => {
              const path = roadPath(road.centerline)
              return (
                <g key={road.id} data-road-id={road.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke="#efe3c8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="7"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="#536966"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="4.7"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="#f9f2e4"
                    strokeDasharray="2 4"
                    strokeLinecap="round"
                    strokeWidth="0.75"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}
          </g>

          <g data-journey-map-buildings>
            {WORLD.checkpoints.map((checkpoint, index) => {
              const [x, y] = mapWorldPoint([
                checkpoint.position[0],
                checkpoint.position[2],
              ])
              const rotation = index % 2 === 0 ? -8 : 8
              return (
                <rect
                  key={checkpoint.recordId}
                  data-building-record-id={checkpoint.recordId}
                  x="-2.4"
                  y="-1.45"
                  width="4.8"
                  height="2.9"
                  rx="0.35"
                  fill="#f2e5ca"
                  stroke="#294945"
                  strokeWidth="0.65"
                  vectorEffect="non-scaling-stroke"
                  transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation})`}
                />
              )
            })}
          </g>

          <g data-journey-map-landmarks>
            {landmarks.map((landmark) => {
              const checkpoint = CHECKPOINTS_BY_RECORD_ID.get(landmark.id)
              if (!checkpoint) return null
              const [x, y] = mapWorldPoint([
                checkpoint.position[0],
                checkpoint.position[2],
              ])
              const active = landmark.id === destinationId
              const discovered = discoveredIds.has(landmark.id)
              const state = active
                ? "destination"
                : discovered
                  ? "discovered"
                  : "unvisited"

              return (
                <g
                  key={landmark.id}
                  data-journey-map-landmark
                  data-landmark-id={landmark.id}
                  data-state={state}
                  transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
                >
                  {active ? (
                    <circle
                      r="3.4"
                      fill="none"
                      stroke="#c76343"
                      strokeWidth="1.4"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  <circle
                    r={active ? 2.05 : 1.7}
                    fill={
                      active ? "#c76343" : discovered ? "#143d42" : "#f9f2e4"
                    }
                    stroke="#f9f2e4"
                    strokeWidth="0.9"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}
          </g>

          {playerPosition ? (
            <g
              data-journey-map-player
              transform={`translate(${mapWorldPoint([
                playerPosition.x,
                playerPosition.z,
              ])[0].toFixed(2)} ${mapWorldPoint([
                playerPosition.x,
                playerPosition.z,
              ])[1].toFixed(2)})`}
            >
              <polygon
                points="0,-3.1 3.1,0 0,3.1 -3.1,0"
                fill="#f9f2e4"
                stroke="#c76343"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <circle r="0.8" fill="#143d42" />
            </g>
          ) : null}
        </svg>
      </span>

      <span className="mt-1.5 flex items-center justify-between gap-2 text-[9px] leading-tight text-[#4f6865] sm:mt-2">
        <span className="min-w-0 truncate">
          {destination?.shortTitle ?? "Choose destination"}
        </span>
        <span className="shrink-0 font-mono text-[8px] tracking-[0.08em] uppercase">
          {discoveredCount}/{landmarks.length}
        </span>
      </span>
    </button>
  )
}
