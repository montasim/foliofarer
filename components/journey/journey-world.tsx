"use client"

import * as React from "react"
import { Html } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import {
  CuboidCollider,
  CylinderCollider,
  RigidBody,
} from "@react-three/rapier"
import * as THREE from "three"
import type {
  BuildingPlot,
  JourneyLandmark,
  JourneyLandmarkId,
  JourneyRenderTier,
  WorldPosition,
} from "@/lib/journey/types"
import { JOURNEY_RENDER_CONFIG } from "@/lib/journey/performance"
import {
  careerRoadProgress,
  communityRoadProgress,
  educationRoadProgress,
  getRoadFrame,
  JOURNEY_BUILDING_PLOTS,
  JOURNEY_CROSSWALK_PROGRESS,
  JOURNEY_HOUSE_PLOTS,
  JOURNEY_LANDMARK_LAYOUTS,
  JOURNEY_PLOT_GEOMETRY,
  JOURNEY_STREET,
  JOURNEY_TOWN_ROAD_PROGRESS,
  journeyStreetCurve,
  learningRoadProgress,
  positionBesideRoad,
  projectRoadProgress,
} from "@/lib/journey/world-layout"

const COLORS = {
  asphalt: "#596a64",
  asphaltEdge: "#465b55",
  sidewalk: "#ded9c7",
  sidewalkEdge: "#a6b5a9",
  drain: "#647770",
  grass: "#9fb39a",
  field: "#829c78",
  plaster: "#e7e1cc",
  route: "#c45f3f",
  ink: "#173a38",
} as const

type TreeVariant = "broadleaf" | "rain-tree" | "palm"

function Tree({
  position,
  scale = 1,
  variant = "broadleaf",
}: {
  position: WorldPosition
  scale?: number
  variant?: TreeVariant
}) {
  const isPalm = variant === "palm"

  return (
    <RigidBody type="fixed" colliders={false} position={[...position]}>
      <CylinderCollider
        args={[(isPalm ? 1.05 : 0.68) * scale, (isPalm ? 0.14 : 0.2) * scale]}
        position={[0, (isPalm ? 1.05 : 0.68) * scale, 0]}
      />
      <group scale={scale}>
        <mesh position={[0, isPalm ? 1.08 : 0.7, 0]} castShadow>
          <cylinderGeometry
            args={isPalm ? [0.11, 0.2, 2.16, 7] : [0.16, 0.23, 1.4, 7]}
          />
          <meshStandardMaterial color="#775f48" roughness={1} />
        </mesh>
        {variant === "broadleaf" && (
          <>
            <mesh position={[0, 1.75, 0]} castShadow>
              <icosahedronGeometry args={[0.9, 1]} />
              <meshStandardMaterial color="#607f69" roughness={0.96} />
            </mesh>
            <mesh position={[-0.52, 1.52, 0.12]} scale={0.68} castShadow>
              <icosahedronGeometry args={[0.8, 1]} />
              <meshStandardMaterial color="#78937a" roughness={0.96} />
            </mesh>
          </>
        )}
        {variant === "rain-tree" && (
          <>
            <mesh position={[0, 1.72, 0]} scale={[1.42, 0.7, 1]} castShadow>
              <icosahedronGeometry args={[0.9, 1]} />
              <meshStandardMaterial color="#54745f" roughness={0.98} />
            </mesh>
            <mesh
              position={[-0.72, 1.55, 0.06]}
              scale={[0.92, 0.58, 0.72]}
              castShadow
            >
              <icosahedronGeometry args={[0.82, 1]} />
              <meshStandardMaterial color="#6f8b6e" roughness={0.98} />
            </mesh>
            <mesh
              position={[0.76, 1.58, -0.02]}
              scale={[0.85, 0.54, 0.7]}
              castShadow
            >
              <icosahedronGeometry args={[0.82, 1]} />
              <meshStandardMaterial color="#789573" roughness={0.98} />
            </mesh>
          </>
        )}
        {isPalm && (
          <group position={[0, 2.12, 0]}>
            {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map(
              (rotation, index) => (
                <mesh
                  key={rotation}
                  position={[
                    Math.sin(rotation) * 0.34,
                    index % 2 === 0 ? 0.02 : -0.05,
                    Math.cos(rotation) * 0.34,
                  ]}
                  rotation={[0, rotation, index % 2 === 0 ? 0.12 : -0.12]}
                  scale={[0.34, 0.12, 1.2]}
                  castShadow
                >
                  <icosahedronGeometry args={[0.72, 0]} />
                  <meshStandardMaterial color="#4f7763" roughness={0.98} />
                </mesh>
              )
            )}
            <mesh position={[0, 0.02, 0]} scale={[0.58, 0.42, 0.58]}>
              <icosahedronGeometry args={[0.42, 1]} />
              <meshStandardMaterial color="#6f8b63" roughness={1} />
            </mesh>
          </group>
        )}
      </group>
    </RigidBody>
  )
}

function Shrub({
  position,
  scale = 1,
  flowering = false,
}: {
  position: WorldPosition
  scale?: number
  flowering?: boolean
}) {
  return (
    <group position={[...position]} scale={scale}>
      <mesh position={[-0.28, 0.35, 0]} scale={[1, 0.78, 0.9]} castShadow>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial color="#567762" roughness={1} />
      </mesh>
      <mesh position={[0.3, 0.3, 0.08]} scale={[0.84, 0.68, 0.78]} castShadow>
        <icosahedronGeometry args={[0.48, 1]} />
        <meshStandardMaterial color="#728d6c" roughness={1} />
      </mesh>
      {flowering && (
        <>
          <mesh position={[-0.34, 0.62, 0.12]}>
            <octahedronGeometry args={[0.08, 0]} />
            <meshStandardMaterial color="#d9b879" roughness={0.9} />
          </mesh>
          <mesh position={[0.25, 0.52, 0.35]}>
            <octahedronGeometry args={[0.075, 0]} />
            <meshStandardMaterial color="#c96d57" roughness={0.9} />
          </mesh>
        </>
      )}
    </group>
  )
}

function GrassClump({
  position,
  scale = 1,
  rotation = 0,
}: {
  position: WorldPosition
  scale?: number
  rotation?: number
}) {
  return (
    <group position={[...position]} rotation={[0, rotation, 0]} scale={scale}>
      <mesh position={[-0.14, 0.24, 0]} rotation={[0, 0, -0.16]}>
        <coneGeometry args={[0.18, 0.52, 5]} />
        <meshStandardMaterial color="#698362" roughness={1} />
      </mesh>
      <mesh position={[0.13, 0.2, 0.05]} rotation={[0, 0, 0.2]}>
        <coneGeometry args={[0.16, 0.44, 5]} />
        <meshStandardMaterial color="#80966d" roughness={1} />
      </mesh>
    </group>
  )
}

function StreetLamp({ progress, side }: { progress: number; side: -1 | 1 }) {
  const frame = getRoadFrame(progress)
  const position = frame.center
    .clone()
    .addScaledVector(frame.normal, side * (JOURNEY_STREET.outerEdge + 0.42))
  return (
    <group position={[position.x, 0, position.z]}>
      <mesh position={[0, 1.35, 0]}>
        <cylinderGeometry args={[0.055, 0.08, 2.7, 8]} />
        <meshStandardMaterial color="#294743" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.68, 0]}>
        <boxGeometry args={[0.34, 0.14, 0.34]} />
        <meshStandardMaterial
          color="#d9c68d"
          emissive="#8c6d2f"
          emissiveIntensity={0.18}
        />
      </mesh>
    </group>
  )
}

function ParkedRickshaw({
  progress,
  side,
}: {
  progress: number
  side: -1 | 1
}) {
  const { center, tangent, normal } = getRoadFrame(progress)
  const position = center
    .clone()
    .addScaledVector(normal, side * (JOURNEY_STREET.roadwayWidth / 2 - 0.7))
  const rotation = Math.atan2(tangent.x, tangent.z)
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[position.x, 0, position.z]}
      rotation={[0, rotation, 0]}
    >
      <CuboidCollider args={[0.58, 0.62, 0.9]} position={[0, 0.62, 0]} />
      {[-0.48, 0.48].map((x) => (
        <mesh
          key={x}
          position={[x, 0.42, 0.36]}
          rotation={[0, Math.PI / 2, 0]}
          castShadow
        >
          <torusGeometry args={[0.34, 0.075, 7, 14]} />
          <meshStandardMaterial color="#203632" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.72, 0.18]} castShadow>
        <boxGeometry args={[0.95, 0.72, 1.15]} />
        <meshStandardMaterial color="#1d6a62" roughness={0.86} />
      </mesh>
      <mesh position={[0, 1.24, 0.18]} rotation={[0, 0, Math.PI]} castShadow>
        <coneGeometry args={[0.78, 0.58, 4]} />
        <meshStandardMaterial color="#b84f65" roughness={0.9} />
      </mesh>
      <mesh
        position={[0, 0.42, -0.9]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
      >
        <torusGeometry args={[0.3, 0.065, 7, 14]} />
        <meshStandardMaterial color="#203632" roughness={0.9} />
      </mesh>
      <mesh
        position={[0, 0.75, -0.52]}
        rotation={[Math.PI / 3, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[0.04, 0.04, 1.1, 6]} />
        <meshStandardMaterial color="#d4b446" roughness={0.84} />
      </mesh>
      <mesh position={[0, 0.76, 0.78]}>
        <boxGeometry args={[0.62, 0.08, 0.05]} />
        <meshStandardMaterial color="#d4b446" roughness={0.84} />
      </mesh>
    </RigidBody>
  )
}

function StreetBench({ progress, side }: { progress: number; side: -1 | 1 }) {
  const { center, tangent, normal } = getRoadFrame(progress)
  const position = center
    .clone()
    .addScaledVector(normal, side * (JOURNEY_STREET.outerEdge + 1.05))
  const rotation = Math.atan2(tangent.x, tangent.z)
  return (
    <group position={[position.x, 0, position.z]} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.45, 0.14, 0.42]} />
        <meshStandardMaterial color="#8a5d3d" roughness={0.96} />
      </mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.25, 0]} castShadow>
          <boxGeometry args={[0.12, 0.5, 0.32]} />
          <meshStandardMaterial color="#294743" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function ParkBench({
  position,
  rotation,
}: {
  position: WorldPosition
  rotation: number
}) {
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...position]}
      rotation={[0, rotation, 0]}
    >
      <CuboidCollider args={[0.76, 0.48, 0.3]} position={[0, 0.48, 0]} />
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.55, 0.14, 0.48]} />
        <meshStandardMaterial color="#94613d" roughness={0.96} />
      </mesh>
      <mesh position={[0, 0.88, 0.2]} castShadow>
        <boxGeometry args={[1.55, 0.58, 0.12]} />
        <meshStandardMaterial color="#a96a3f" roughness={0.96} />
      </mesh>
      {[-0.58, 0.58].map((x) => (
        <mesh key={x} position={[x, 0.25, 0]} castShadow>
          <boxGeometry args={[0.12, 0.5, 0.34]} />
          <meshStandardMaterial color="#294743" roughness={0.9} />
        </mesh>
      ))}
    </RigidBody>
  )
}

function ParkSwing({
  position,
  rotation,
}: {
  position: WorldPosition
  rotation: number
}) {
  const framePosts = [
    [-1.55, 1.15, -0.62, -0.12],
    [-1.55, 1.15, 0.62, 0.12],
    [1.55, 1.15, -0.62, 0.12],
    [1.55, 1.15, 0.62, -0.12],
  ] as const

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...position]}
      rotation={[0, rotation, 0]}
    >
      {framePosts.map(([x, y, z, lean], index) => (
        <React.Fragment key={`${x}-${z}`}>
          <CylinderCollider
            args={[1.15, 0.1]}
            position={[x, y, z]}
            rotation={[0, 0, lean]}
          />
          <mesh position={[x, y, z]} rotation={[0, 0, lean]} castShadow>
            <cylinderGeometry args={[0.085, 0.12, 2.3, 7]} />
            <meshStandardMaterial
              color={index < 2 ? "#456b5f" : "#3f6258"}
              roughness={0.92}
            />
          </mesh>
        </React.Fragment>
      ))}
      <mesh position={[0, 2.26, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 3.42, 8]} />
        <meshStandardMaterial color="#35554e" roughness={0.9} />
      </mesh>
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {[-0.28, 0.28].map((z) => (
            <mesh key={z} position={[0, 1.45, z]} castShadow>
              <cylinderGeometry args={[0.018, 0.018, 1.55, 6]} />
              <meshStandardMaterial color="#d8c99c" roughness={0.88} />
            </mesh>
          ))}
          <mesh position={[0, 0.68, 0]} castShadow>
            <boxGeometry args={[0.72, 0.1, 0.72]} />
            <meshStandardMaterial color="#a96a3f" roughness={0.94} />
          </mesh>
        </group>
      ))}
    </RigidBody>
  )
}

function LandmarkLabel({
  children,
  width = "w-48",
}: {
  children: React.ReactNode
  width?: string
}) {
  return (
    <Html
      transform
      center
      sprite
      occlude
      distanceFactor={12.6}
      zIndexRange={[8, 0]}
      className="pointer-events-none"
    >
      <div
        aria-hidden="true"
        data-journey-critical="landmark-label"
        className={`${width} border-2 border-[#d6c99e] bg-[#173a38] px-2.5 py-1 text-center font-[family-name:var(--font-journey-display)] text-[13px] font-semibold tracking-[0.1em] text-[#f4edcf] uppercase shadow-[3px_3px_0_#9e5039]`}
      >
        {children}
      </div>
    </Html>
  )
}

function PlotGround({
  plot,
  color = COLORS.field,
}: {
  plot: BuildingPlot
  color?: string
}) {
  const backMargin = JOURNEY_PLOT_GEOMETRY.institutionRearMargin
  const depth = plot.footprint[1] + plot.setback + backMargin
  const centerZ = (plot.setback - backMargin) / 2
  const width =
    plot.footprint[0] + JOURNEY_PLOT_GEOMETRY.institutionSideMargin * 2
  const front = plot.footprint[1] / 2 + plot.setback

  return (
    <group
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <mesh position={[0, 0.016, centerZ]} receiveShadow>
        <boxGeometry args={[width, 0.035, depth]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[(side * width) / 2, 0.22, centerZ]}
          castShadow
        >
          <boxGeometry args={[0.12, 0.44, depth]} />
          <meshStandardMaterial color="#d5ccb3" roughness={1} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`gate-${side}`}
          position={[side * (plot.accessWidth / 2 + 0.32), 0.62, front - 0.04]}
          castShadow
        >
          <boxGeometry args={[0.34, 1.24, 0.34]} />
          <meshStandardMaterial color="#b65f47" roughness={0.92} />
        </mesh>
      ))}
    </group>
  )
}

function TownHouse({
  plot,
  color,
  height = 2.5,
}: {
  plot: BuildingPlot
  color: string
  height?: number
}) {
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider
        args={[1.8, height / 2, 1.6]}
        position={[0, height / 2, 0]}
      />
      <mesh position={[0, 0.035, 0]} receiveShadow>
        <boxGeometry args={[4.45, 0.07, 4.15]} />
        <meshStandardMaterial color="#8fa585" roughness={1} />
      </mesh>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.6, height, 3.2]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh
        position={[0, height + 0.5, 0]}
        rotation={[0, Math.PI / 4, 0]}
        castShadow
      >
        <coneGeometry args={[2.55, 1.1, 4]} />
        <meshStandardMaterial color="#647c82" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.72, 1.61]}>
        <boxGeometry args={[0.7, 1.35, 0.06]} />
        <meshStandardMaterial color="#274a49" roughness={0.82} />
      </mesh>
      {[-1.05, 1.05].map((x) => (
        <mesh key={x} position={[x, 1.36, 1.625]}>
          <boxGeometry args={[0.65, 0.72, 0.05]} />
          <meshStandardMaterial color="#88a9af" roughness={0.62} />
        </mesh>
      ))}
      <mesh position={[0, 0.14, 2]} receiveShadow>
        <boxGeometry args={[2.45, 0.16, 0.84]} />
        <meshStandardMaterial color="#d8d1bb" roughness={1} />
      </mesh>
    </RigidBody>
  )
}

function RangpurZillaSchool({ plot }: { plot: BuildingPlot }) {
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider args={[5.4, 1.8, 2.2]} position={[0, 1.8, 0]} />
      <mesh position={[0, 1.8, 0]} castShadow receiveShadow>
        <boxGeometry args={[10.8, 3.6, 4.4]} />
        <meshStandardMaterial color="#d9d1bd" roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.92, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[7.1, 1.15, 4]} />
        <meshStandardMaterial color="#955f48" roughness={0.9} />
      </mesh>
      {[-3.8, -2.25, 2.25, 3.8].map((x) => (
        <mesh key={x} position={[x, 2.15, 2.23]}>
          <boxGeometry args={[1.05, 1.15, 0.08]} />
          <meshStandardMaterial color="#65858b" roughness={0.62} />
        </mesh>
      ))}
      <mesh position={[0, 1, 2.24]}>
        <boxGeometry args={[1.25, 2, 0.09]} />
        <meshStandardMaterial color="#315a50" roughness={0.84} />
      </mesh>
      <mesh position={[0, 0.11, 2.6]} receiveShadow>
        <boxGeometry args={[2.1, 0.22, 0.72]} />
        <meshStandardMaterial color="#d8cfb9" roughness={1} />
      </mesh>
      <group position={[0, 4.72, 2.68]}>
        <LandmarkLabel>Rangpur Zilla School</LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function CarmichaelCollege({ plot }: { plot: BuildingPlot }) {
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider args={[4.7, 1.65, 2]} position={[0, 1.65, 0]} />
      <mesh position={[0, 1.65, 0]} castShadow receiveShadow>
        <boxGeometry args={[9.4, 3.3, 4]} />
        <meshStandardMaterial color="#b97458" roughness={0.94} />
      </mesh>
      {[-5.15, 5.15].map((x) => (
        <mesh key={x} position={[x, 1.4, 0.2]} castShadow>
          <boxGeometry args={[1.35, 2.8, 3.2]} />
          <meshStandardMaterial color="#c68465" roughness={0.94} />
        </mesh>
      ))}
      <mesh position={[0, 3.57, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[6.15, 1.05, 4]} />
        <meshStandardMaterial color="#665b50" roughness={0.92} />
      </mesh>
      <mesh position={[0, 1.22, 2.12]}>
        <boxGeometry args={[2.3, 2.45, 0.3]} />
        <meshStandardMaterial color="#eadfc8" roughness={0.94} />
      </mesh>
      <mesh position={[0, 1.15, 2.3]}>
        <circleGeometry args={[0.86, 24, 0, Math.PI]} />
        <meshStandardMaterial color="#274b48" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.11, 2.5]} receiveShadow>
        <boxGeometry args={[2.7, 0.22, 0.7]} />
        <meshStandardMaterial color="#e5dcc5" roughness={1} />
      </mesh>
      {[-3.45, -2.4, 2.4, 3.45].map((x) => (
        <group key={x} position={[x, 1.72, 2.12]}>
          <mesh>
            <cylinderGeometry args={[0.16, 0.2, 2.65, 12]} />
            <meshStandardMaterial color="#eee4cf" roughness={0.93} />
          </mesh>
          <mesh position={[0, 1.34, 0]}>
            <boxGeometry args={[0.48, 0.17, 0.42]} />
            <meshStandardMaterial color="#eee4cf" roughness={0.93} />
          </mesh>
        </group>
      ))}
      <group position={[0, 4.42, 2.58]}>
        <LandmarkLabel>Carmichael College</LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function BaustCampus({ plot }: { plot: BuildingPlot }) {
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider args={[5.1, 1.8, 2.1]} position={[0, 1.8, 0]} />
      <mesh position={[-1.45, 1.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.3, 3.4, 4.2]} />
        <meshStandardMaterial color="#c8d0c2" roughness={0.86} />
      </mesh>
      <mesh position={[3.1, 2.65, 0.12]} castShadow receiveShadow>
        <boxGeometry args={[2, 5.3, 4.2]} />
        <meshStandardMaterial color="#536f68" roughness={0.82} />
      </mesh>
      <mesh position={[-0.4, 3.68, 0]} castShadow>
        <boxGeometry args={[9.35, 0.28, 4.55]} />
        <meshStandardMaterial color="#294e48" roughness={0.86} />
      </mesh>
      {[-3.7, -2.2, -0.7, 0.8, 2.65].map((x) => (
        <mesh key={x} position={[x, 2.25, x === 2.65 ? 2.25 : 2.13]}>
          <boxGeometry args={[0.78, 1.15, 0.08]} />
          <meshStandardMaterial color="#5f8790" roughness={0.56} />
        </mesh>
      ))}
      <mesh position={[-0.7, 0.88, 2.16]}>
        <boxGeometry args={[1.35, 1.76, 0.11]} />
        <meshStandardMaterial color="#214f48" roughness={0.78} />
      </mesh>
      <mesh position={[-0.7, 0.11, 2.48]} receiveShadow>
        <boxGeometry args={[2.5, 0.22, 0.68]} />
        <meshStandardMaterial color="#d8d4c1" roughness={1} />
      </mesh>
      <group position={[-0.75, 4.18, 2.62]}>
        <LandmarkLabel width="w-64">
          Bangladesh Army University · BAUST
        </LandmarkLabel>
      </group>
    </RigidBody>
  )
}

type CareerOfficeVariant = "codez" | "drra" | "multiversal" | "medical"

function CareerOffice({
  plot,
  variant,
  title,
}: {
  plot: BuildingPlot
  variant: CareerOfficeVariant
  title: string
}) {
  const config = {
    codez: {
      wall: "#c69a63",
      accent: "#8d563d",
      glass: "#66868b",
      height: 2.8,
    },
    drra: {
      wall: "#c6cbb7",
      accent: "#687d65",
      glass: "#78939a",
      height: 3.1,
    },
    multiversal: {
      wall: "#aebfc1",
      accent: "#496d73",
      glass: "#47747d",
      height: 3.35,
    },
    medical: {
      wall: "#c9d3c9",
      accent: "#2f6964",
      glass: "#5e8e94",
      height: 3.65,
    },
  }[variant]
  const [width, depth] = plot.footprint

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider
        args={[width / 2, config.height / 2, depth / 2]}
        position={[0, config.height / 2, 0]}
      />
      <mesh position={[0, config.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, config.height, depth]} />
        <meshStandardMaterial color={config.wall} roughness={0.9} />
      </mesh>

      {variant === "codez" && (
        <>
          <mesh position={[-2.1, config.height + 0.3, 0]} castShadow>
            <boxGeometry args={[3.6, 0.6, depth + 0.35]} />
            <meshStandardMaterial color={config.accent} roughness={0.9} />
          </mesh>
          <mesh position={[2, config.height + 0.16, 0]} castShadow>
            <boxGeometry args={[3.8, 0.32, depth + 0.35]} />
            <meshStandardMaterial color="#755548" roughness={0.92} />
          </mesh>
        </>
      )}

      {variant === "drra" && (
        <>
          <mesh
            position={[0, config.height + 0.42, 0]}
            rotation={[0, Math.PI / 4, 0]}
            castShadow
          >
            <coneGeometry args={[5.2, 0.9, 4]} />
            <meshStandardMaterial color={config.accent} roughness={0.92} />
          </mesh>
          {[-2.9, 2.9].map((x) => (
            <mesh key={x} position={[x, 1.45, depth / 2 + 0.28]} castShadow>
              <cylinderGeometry args={[0.16, 0.19, 2.9, 10]} />
              <meshStandardMaterial color="#e3deca" roughness={0.95} />
            </mesh>
          ))}
        </>
      )}

      {variant === "multiversal" && (
        <>
          <mesh position={[1.35, config.height + 0.58, -0.15]} castShadow>
            <boxGeometry args={[4.7, 1.16, depth - 0.3]} />
            <meshStandardMaterial color={config.accent} roughness={0.84} />
          </mesh>
          <mesh position={[-2.7, config.height + 0.18, 0]} castShadow>
            <boxGeometry args={[2.4, 0.36, depth + 0.4]} />
            <meshStandardMaterial color="#d4b66c" roughness={0.88} />
          </mesh>
        </>
      )}

      {variant === "medical" && (
        <>
          <mesh position={[3.35, config.height + 1.1, -0.1]} castShadow>
            <boxGeometry args={[2.8, 2.2, depth - 0.2]} />
            <meshStandardMaterial color={config.accent} roughness={0.84} />
          </mesh>
          <mesh position={[-1.5, config.height + 0.22, 0]} castShadow>
            <boxGeometry args={[7.5, 0.44, depth + 0.35]} />
            <meshStandardMaterial color="#31544f" roughness={0.86} />
          </mesh>
          <mesh position={[3.35, config.height + 2.35, 0]} castShadow>
            <octahedronGeometry args={[0.42]} />
            <meshStandardMaterial
              color="#d4b66c"
              emissive="#805b28"
              emissiveIntensity={0.18}
            />
          </mesh>
        </>
      )}

      <mesh position={[0, 0.92, depth / 2 + 0.055]}>
        <boxGeometry args={[1.22, 1.84, 0.1]} />
        <meshStandardMaterial color="#173f3b" roughness={0.78} />
      </mesh>
      {[-3, -1.65, 1.65, 3].map((x) =>
        Math.abs(x) < width / 2 - 0.25 ? (
          <mesh key={x} position={[x, 2.05, depth / 2 + 0.06]}>
            <boxGeometry args={[0.82, 0.92, 0.11]} />
            <meshStandardMaterial color={config.glass} roughness={0.58} />
          </mesh>
        ) : null
      )}
      <mesh position={[0, 0.12, depth / 2 + 0.4]} receiveShadow>
        <boxGeometry args={[2.3, 0.24, 0.78]} />
        <meshStandardMaterial color="#ded8c4" roughness={1} />
      </mesh>
      <group
        position={[
          variant === "medical" ? -1.35 : 0,
          variant === "codez"
            ? config.height + 0.95
            : variant === "drra"
              ? config.height + 1.28
              : variant === "multiversal"
                ? config.height + 1.55
                : config.height + 0.92,
          depth / 2 + 0.48,
        ]}
      >
        <LandmarkLabel width={variant === "medical" ? "w-60" : "w-52"}>
          {title}
        </LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function LearningLibrary({ plot }: { plot: BuildingPlot }) {
  const [width, depth] = plot.footprint
  const roomBays = [
    ["Frontend", "#537f86"],
    ["Backend", "#315f5a"],
    ["Databases", "#6d8f8b"],
    ["Cloud", "#4f7774"],
    ["AI", "#ad7659"],
    ["Real-time", "#3e696d"],
  ] as const

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider
        args={[width / 2, 1.65, depth / 2]}
        position={[0, 1.65, 0]}
      />
      <mesh position={[0, 1.65, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 3.3, depth]} />
        <meshStandardMaterial color="#d5d7c8" roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.42, 0]} castShadow>
        <boxGeometry args={[width + 0.45, 0.24, depth + 0.45]} />
        <meshStandardMaterial color="#234b47" roughness={0.86} />
      </mesh>
      <mesh position={[0, 4.05, -0.12]} castShadow receiveShadow>
        <boxGeometry args={[5.4, 1.02, depth - 0.55]} />
        <meshStandardMaterial color="#416e6c" roughness={0.8} />
      </mesh>
      <mesh position={[0, 4.62, -0.12]} castShadow>
        <boxGeometry args={[5.8, 0.16, depth - 0.2]} />
        <meshStandardMaterial color="#d0b56e" roughness={0.88} />
      </mesh>

      {roomBays.map(([room, color], index) => {
        const x = -5.3 + index * 2.12
        return (
          <group key={room} position={[x, 2.08, depth / 2 + 0.065]}>
            <mesh>
              <boxGeometry args={[1.46, 1.28, 0.1]} />
              <meshStandardMaterial color={color} roughness={0.58} />
            </mesh>
            <mesh position={[0, -0.82, 0.015]}>
              <boxGeometry args={[1.58, 0.12, 0.13]} />
              <meshStandardMaterial color="#b66a4d" roughness={0.9} />
            </mesh>
          </group>
        )
      })}

      <mesh position={[0, 0.94, depth / 2 + 0.075]}>
        <boxGeometry args={[1.32, 1.88, 0.12]} />
        <meshStandardMaterial color="#173f3b" roughness={0.76} />
      </mesh>
      <mesh position={[0, 0.12, depth / 2 + 0.48]} receiveShadow>
        <boxGeometry args={[2.65, 0.24, 0.95]} />
        <meshStandardMaterial color="#ded8c4" roughness={1} />
      </mesh>
      <group position={[0, 5.15, depth / 2 + 0.48]}>
        <LandmarkLabel width="w-60">Learning Library</LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function ProjectWorkshop({ plot }: { plot: BuildingPlot }) {
  const [width, depth] = plot.footprint
  const exhibitColors = [
    "#b65f47",
    "#d0b56e",
    "#537f86",
    "#789070",
    "#9f6953",
  ] as const

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider
        args={[width / 2, 2.25, depth / 2]}
        position={[0, 2.25, 0]}
      />
      <mesh position={[0, 1.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 3.5, depth]} />
        <meshStandardMaterial color="#bdc7ba" roughness={0.94} />
      </mesh>
      <mesh position={[0, 3.56, 0]} castShadow>
        <boxGeometry args={[width + 0.35, 0.16, depth + 0.35]} />
        <meshStandardMaterial color="#264d49" roughness={0.84} />
      </mesh>

      {exhibitColors.map((color, index) => {
        const x = -5.78 + index * 2.89
        return (
          <group key={color} position={[x, 0, 0]}>
            <mesh
              position={[0, 4.12, 0]}
              rotation={[0, 0, index % 2 === 0 ? -0.17 : 0.17]}
              castShadow
            >
              <boxGeometry args={[2.92, 0.18, depth + 0.42]} />
              <meshStandardMaterial color="#315f5a" roughness={0.8} />
            </mesh>
            <mesh position={[0, 3.83, depth / 2 + 0.08]}>
              <boxGeometry args={[2.42, 0.48, 0.12]} />
              <meshStandardMaterial color="#6f9698" roughness={0.5} />
            </mesh>
            <mesh position={[0, 1.66, depth / 2 + 0.07]}>
              <boxGeometry args={[1.6, 1.18, 0.12]} />
              <meshStandardMaterial color={color} roughness={0.82} />
            </mesh>
            <mesh position={[0, 0.78, depth / 2 + 0.48]} castShadow>
              <boxGeometry args={[1.8, 0.72, 0.72]} />
              <meshStandardMaterial color="#8a8070" roughness={0.98} />
            </mesh>
          </group>
        )
      })}

      <mesh position={[0, 1.08, depth / 2 + 0.13]}>
        <boxGeometry args={[3.25, 2.16, 0.2]} />
        <meshStandardMaterial color="#173a38" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.13, depth / 2 + 0.62]} receiveShadow>
        <boxGeometry args={[3.75, 0.24, 1.25]} />
        <meshStandardMaterial color="#ded8c4" roughness={1} />
      </mesh>
      <group position={[0, 5.16, depth / 2 + 0.5]}>
        <LandmarkLabel width="w-64">Project Workshop</LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function CommunityHall({ plot }: { plot: BuildingPlot }) {
  const [width, depth] = plot.footprint
  const noticePanels = [
    "#b65f47",
    "#d0b56e",
    "#537f86",
    "#789070",
    "#9f6953",
  ] as const

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      <CuboidCollider
        args={[width / 2, 2.15, depth / 2]}
        position={[0, 2.15, 0]}
      />
      <mesh position={[0, 1.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 3.44, depth]} />
        <meshStandardMaterial color="#d5d8c4" roughness={0.94} />
      </mesh>

      <mesh
        position={[0, 3.95, -depth * 0.24]}
        rotation={[-0.16, 0, 0]}
        castShadow
      >
        <boxGeometry args={[width + 0.9, 0.2, depth * 0.62]} />
        <meshStandardMaterial color="#315d57" roughness={0.86} />
      </mesh>
      <mesh
        position={[0, 3.95, depth * 0.24]}
        rotation={[0.16, 0, 0]}
        castShadow
      >
        <boxGeometry args={[width + 0.9, 0.2, depth * 0.62]} />
        <meshStandardMaterial color="#315d57" roughness={0.86} />
      </mesh>
      <mesh position={[0, 4.36, 0]} castShadow>
        <boxGeometry args={[width + 0.25, 0.12, 0.18]} />
        <meshStandardMaterial color="#d0b56e" roughness={0.8} />
      </mesh>

      <mesh position={[0, 1.2, depth / 2 + 0.11]}>
        <boxGeometry args={[3.25, 2.4, 0.2]} />
        <meshStandardMaterial color="#173a38" roughness={0.8} />
      </mesh>
      {[-5.35, -2.15, 2.15, 5.35].map((x) => (
        <mesh key={x} position={[x, 1.55, depth / 2 + 0.25]} castShadow>
          <cylinderGeometry args={[0.22, 0.27, 3.1, 8]} />
          <meshStandardMaterial color="#a95e46" roughness={0.9} />
        </mesh>
      ))}

      <mesh position={[0, 2.82, depth / 2 + 0.28]}>
        <boxGeometry args={[10.1, 0.08, 0.08]} />
        <meshStandardMaterial color="#c4a85f" roughness={0.72} />
      </mesh>
      {noticePanels.map((color, index) => {
        const x = -4.5 + index * 2.25
        return (
          <group key={color} position={[x, 2.82, depth / 2 + 0.34]}>
            <mesh>
              <boxGeometry args={[1.38, 0.72, 0.1]} />
              <meshStandardMaterial color={color} roughness={0.8} />
            </mesh>
            <mesh position={[0, 0, -0.04]}>
              <boxGeometry args={[1.62, 0.92, 0.04]} />
              <meshStandardMaterial color="#244743" roughness={0.9} />
            </mesh>
          </group>
        )
      })}

      <mesh position={[0, 0.13, depth / 2 + 0.68]} receiveShadow>
        <boxGeometry args={[3.85, 0.24, 1.35]} />
        <meshStandardMaterial color="#ded8c4" roughness={1} />
      </mesh>
      <group position={[0, 5.42, depth / 2 + 0.5]}>
        <LandmarkLabel width="w-60">Community Hall</LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function ContactPavilion({ plot }: { plot: BuildingPlot }) {
  const [width, depth] = plot.footprint
  const columnPositions = [
    [-4.15, -1.45],
    [4.15, -1.45],
    [-4.15, 1.45],
    [4.15, 1.45],
  ] as const

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[...plot.buildingPosition]}
      rotation={[0, plot.buildingRotationY, 0]}
    >
      {columnPositions.map(([x, z]) => (
        <CuboidCollider
          key={`${x}-${z}`}
          args={[0.18, 1.65, 0.18]}
          position={[x, 1.65, z]}
        />
      ))}

      <mesh
        position={[0, 0.12, 0]}
        scale={[width / 2, 1, depth / 2]}
        receiveShadow
      >
        <cylinderGeometry args={[1, 1.05, 0.24, 32]} />
        <meshStandardMaterial color="#d8d1b9" roughness={1} />
      </mesh>
      <mesh position={[0, 0.25, 0]} scale={[5.65, 1, 2.1]} receiveShadow>
        <cylinderGeometry args={[1, 1, 0.08, 32]} />
        <meshStandardMaterial color="#789070" roughness={1} />
      </mesh>

      {columnPositions.map(([x, z]) => (
        <mesh key={`column-${x}-${z}`} position={[x, 1.74, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 3.48, 8]} />
          <meshStandardMaterial color="#315d57" roughness={0.82} />
        </mesh>
      ))}

      <mesh position={[0, 3.62, 0]} castShadow>
        <boxGeometry args={[9.25, 0.18, 3.65]} />
        <meshStandardMaterial color="#537f86" roughness={0.88} />
      </mesh>
      <mesh position={[0, 3.75, 0]} castShadow>
        <boxGeometry args={[9.7, 0.08, 3.95]} />
        <meshStandardMaterial color="#d0b56e" roughness={0.78} />
      </mesh>

      {[-0.9, 0.9].map((z, index) => (
        <group key={z} position={[0, 0, z]} rotation={[0, index * Math.PI, 0]}>
          <mesh position={[0, 0.65, 0]} castShadow>
            <boxGeometry args={[3.35, 0.22, 0.72]} />
            <meshStandardMaterial color="#a8643d" roughness={0.92} />
          </mesh>
          <mesh position={[0, 1.1, 0.29]} rotation={[-0.08, 0, 0]} castShadow>
            <boxGeometry args={[3.35, 0.72, 0.16]} />
            <meshStandardMaterial color="#b87346" roughness={0.92} />
          </mesh>
          {[-1.25, 1.25].map((x) => (
            <mesh key={x} position={[x, 0.35, 0]} castShadow>
              <boxGeometry args={[0.18, 0.6, 0.55]} />
              <meshStandardMaterial color="#244743" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[0, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.58, 0.68, 0.18, 16]} />
        <meshStandardMaterial color="#d0b56e" roughness={0.86} />
      </mesh>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, 0.48, 10]} />
        <meshStandardMaterial color="#315d57" roughness={0.86} />
      </mesh>

      {[-5.25, 5.25].map((x) => (
        <group key={x} position={[x, 0, 0.15]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <cylinderGeometry args={[0.68, 0.78, 0.55, 12]} />
            <meshStandardMaterial color="#b65f47" roughness={0.94} />
          </mesh>
          <mesh position={[0, 1.35, 0]} castShadow>
            <icosahedronGeometry args={[0.92, 1]} />
            <meshStandardMaterial color="#607f69" roughness={0.96} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 0.13, depth / 2 + 0.7]} receiveShadow>
        <boxGeometry args={[3.8, 0.24, 1.4]} />
        <meshStandardMaterial color="#ded8c4" roughness={1} />
      </mesh>
      <group position={[0, 4.42, depth / 2 + 0.48]}>
        <LandmarkLabel width="w-60">Contact Pavilion</LandmarkLabel>
      </group>
    </RigidBody>
  )
}

function StreetRibbon({
  width,
  height,
  color,
  offset = 0,
}: {
  width: number
  height: number
  color: string
  offset?: number
}) {
  const geometry = React.useMemo(() => {
    const segments = 560
    const vertices: number[] = []
    const indices: number[] = []
    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments
      const point = journeyStreetCurve.getPointAt(progress)
      const tangent = journeyStreetCurve.getTangentAt(progress).normalize()
      const perpendicular = new THREE.Vector3(-tangent.z, 0, tangent.x)
      const center = point.clone().addScaledVector(perpendicular, offset)
      const edge = perpendicular.clone().multiplyScalar(width / 2)
      const left = center.clone().add(edge)
      const right = center.clone().sub(edge)
      vertices.push(left.x, height, left.z, right.x, height, right.z)
      if (index < segments) {
        const current = index * 2
        indices.push(
          current,
          current + 2,
          current + 1,
          current + 1,
          current + 2,
          current + 3
        )
      }
    }
    const ribbon = new THREE.BufferGeometry()
    ribbon.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3)
    )
    ribbon.setIndex(indices)
    ribbon.computeVertexNormals()
    return ribbon
  }, [height, offset, width])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

function SurfaceStrip({
  from,
  to,
  width,
  color,
  height = 0.045,
  lengthPadding = 0.18,
}: {
  from: WorldPosition
  to: WorldPosition
  width: number
  color: string
  height?: number
  lengthPadding?: number
}) {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const length = Math.hypot(dx, dz)
  const rotation = Math.atan2(dx, dz)
  return (
    <mesh
      position={[(from[0] + to[0]) / 2, height, (from[2] + to[2]) / 2]}
      rotation={[0, rotation, 0]}
      receiveShadow
    >
      <boxGeometry args={[width, 0.035, length + lengthPadding]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

function FlatSurfaceStrip({
  from,
  to,
  width,
  color,
  height,
}: {
  from: WorldPosition
  to: WorldPosition
  width: number
  color: string
  height: number
}) {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const length = Math.hypot(dx, dz)
  const rotation = Math.atan2(dx, dz)
  return (
    <group
      position={[(from[0] + to[0]) / 2, height, (from[2] + to[2]) / 2]}
      rotation={[0, rotation, 0]}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
    </group>
  )
}

function AccessConnection({ plot }: { plot: BuildingPlot }) {
  const isLandmark = plot.use !== "residential"
  const destination = isLandmark
    ? plot.checkpointPosition
    : plot.entrancePosition
  return (
    <group>
      <FlatSurfaceStrip
        from={plot.sidewalkAnchorPosition}
        to={destination}
        width={plot.accessWidth}
        color="#77756f"
        height={0.064}
      />
      {isLandmark && (
        <>
          <mesh
            position={[
              plot.checkpointPosition[0],
              0.075,
              plot.checkpointPosition[2],
            ]}
            receiveShadow
          >
            <cylinderGeometry
              args={[
                plot.forecourtRadius,
                plot.forecourtRadius + 0.12,
                0.08,
                32,
              ]}
            />
            <meshStandardMaterial color="#d5cfba" roughness={1} />
          </mesh>
          <SurfaceStrip
            from={plot.checkpointPosition}
            to={plot.entrancePosition}
            width={1.45}
            color={COLORS.sidewalk}
            height={0.09}
          />
          <FlatSurfaceStrip
            from={plot.sidewalkAnchorPosition}
            to={plot.checkpointPosition}
            width={0.11}
            color={COLORS.route}
            height={0.086}
          />
        </>
      )}
    </group>
  )
}

function RoadLaneMarkers() {
  const markers = React.useMemo(
    () =>
      Array.from({ length: 110 }, (_, index) => {
        const progress = 0.007 + index * 0.009
        const point = journeyStreetCurve.getPointAt(progress)
        const tangent = journeyStreetCurve.getTangentAt(progress).normalize()
        return {
          position: [point.x, 0.07, point.z] as [number, number, number],
          rotation: Math.atan2(tangent.x, tangent.z),
        }
      }),
    []
  )
  return (
    <group>
      {markers.map((marker, index) => (
        <mesh
          key={index}
          position={marker.position}
          rotation={[0, marker.rotation, 0]}
        >
          <boxGeometry args={[0.08, 0.025, 0.76]} />
          <meshStandardMaterial color="#eee7cf" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function Crosswalk({ progress }: { progress: number }) {
  const { center, tangent, normal } = getRoadFrame(progress)
  return (
    <group>
      {[-0.72, -0.36, 0, 0.36, 0.72].map((shift) => {
        const stripeCenter = center.clone().addScaledVector(tangent, shift)
        const from = stripeCenter.clone().addScaledVector(normal, -2.65)
        const to = stripeCenter.clone().addScaledVector(normal, 2.65)
        return (
          <SurfaceStrip
            key={shift}
            from={[from.x, 0, from.z]}
            to={[to.x, 0, to.z]}
            width={0.18}
            color="#e9e2cb"
            height={0.078}
          />
        )
      })}
    </group>
  )
}

function TownSquare() {
  const layout = JOURNEY_LANDMARK_LAYOUTS["town-square"]
  const { tangent, normal } = getRoadFrame(JOURNEY_TOWN_ROAD_PROGRESS)
  const center = new THREE.Vector3(...layout.checkpointPosition)
  const outward = normal.clone().multiplyScalar(-1)
  const parkRotation = Math.atan2(tangent.x, tangent.z)
  const parkPoint = (
    along: number,
    away: number,
    height = 0
  ): WorldPosition => {
    const point = center
      .clone()
      .addScaledVector(tangent, along)
      .addScaledVector(outward, away)
    return [point.x, height, point.z]
  }
  const benchPositions = [
    parkPoint(-4.85, -1.15, 0.14),
    parkPoint(4.85, -1.05, 0.14),
    parkPoint(-4.7, 3.15, 0.14),
    parkPoint(4.65, 3.05, 0.14),
    parkPoint(-2.2, 6.35, 0.14),
  ] as const
  const faceCenter = (position: THREE.Vector3) =>
    Math.atan2(center.x - position.x, center.z - position.z)

  return (
    <group>
      <SurfaceStrip
        from={layout.sidewalkAnchorPosition}
        to={layout.checkpointPosition}
        width={2.15}
        color={COLORS.sidewalk}
        height={0.05}
      />

      <mesh
        position={[center.x, 0.05, center.z]}
        rotation={[0, parkRotation, 0]}
        scale={[1.74, 1, 1.74]}
        receiveShadow
      >
        <cylinderGeometry args={[5, 5.12, 0.1, 48]} />
        <meshStandardMaterial color="#d9d2bb" roughness={0.98} />
      </mesh>

      <mesh
        position={parkPoint(-4.25, 1.15, 0.11)}
        rotation={[0, parkRotation, 0]}
        scale={[1.22, 1, 1.22]}
        receiveShadow
      >
        <cylinderGeometry args={[2.05, 2.12, 0.12, 32]} />
        <meshStandardMaterial color="#829c78" roughness={1} />
      </mesh>
      <mesh
        position={parkPoint(4.35, 1.4, 0.11)}
        rotation={[0, parkRotation, 0]}
        scale={[1.2, 1, 1.2]}
        receiveShadow
      >
        <cylinderGeometry args={[1.95, 2.02, 0.12, 32]} />
        <meshStandardMaterial color="#789070" roughness={1} />
      </mesh>
      <mesh position={[center.x, 0.13, center.z]} receiveShadow>
        <cylinderGeometry args={[1.72, 1.82, 0.16, 36]} />
        <meshStandardMaterial color="#e7e1cc" roughness={0.98} />
      </mesh>

      <mesh position={parkPoint(0, 7, 0.15)} receiveShadow>
        <cylinderGeometry args={[1.48, 1.58, 0.1, 28]} />
        <meshStandardMaterial color="#b65f47" roughness={0.94} />
      </mesh>
      <mesh position={parkPoint(0, 7, 0.21)} receiveShadow>
        <cylinderGeometry args={[1.08, 1.16, 0.08, 28]} />
        <meshStandardMaterial color="#667f68" roughness={0.96} />
      </mesh>

      <Tree
        position={parkPoint(-6.35, -2.25, 0.17)}
        scale={0.88}
        variant="rain-tree"
      />
      <Tree
        position={parkPoint(6.35, -1.95, 0.17)}
        scale={0.82}
        variant="broadleaf"
      />
      <Tree
        position={parkPoint(-6.15, 4.15, 0.17)}
        scale={0.82}
        variant="broadleaf"
      />
      <Tree
        position={parkPoint(6.25, 4.05, 0.17)}
        scale={0.84}
        variant="rain-tree"
      />
      <Tree
        position={parkPoint(-4.45, 7.05, 0.17)}
        scale={0.84}
        variant="palm"
      />
      <Tree
        position={parkPoint(0.3, 7.7, 0.17)}
        scale={0.8}
        variant="broadleaf"
      />
      <Tree
        position={parkPoint(6.65, 6.15, 0.17)}
        scale={0.76}
        variant="palm"
      />
      <Shrub position={parkPoint(-3.3, 5.35, 0.16)} scale={0.82} flowering />
      <Shrub position={parkPoint(3.15, 5.15, 0.16)} scale={0.76} />
      <Shrub position={parkPoint(-6.55, 0.5, 0.16)} scale={0.72} />
      <Shrub position={parkPoint(6.55, 0.65, 0.16)} scale={0.74} flowering />
      <GrassClump
        position={parkPoint(-5.4, -2.2, 0.16)}
        scale={0.82}
        rotation={1.2}
      />
      <GrassClump
        position={parkPoint(5.25, -2, 0.16)}
        scale={0.76}
        rotation={2.3}
      />
      {benchPositions.map((position, index) => {
        const benchPosition = new THREE.Vector3(...position)
        return (
          <ParkBench
            key={`town-bench-${index}`}
            position={position}
            rotation={faceCenter(benchPosition)}
          />
        )
      })}
      <ParkSwing
        position={parkPoint(4.45, 7.15, 0.16)}
        rotation={parkRotation}
      />

      <Crosswalk progress={JOURNEY_TOWN_ROAD_PROGRESS} />
    </group>
  )
}

function LandmarkCheckpoint({
  landmark,
  active,
  discovered,
  reducedMotion,
}: {
  landmark: JourneyLandmark
  active: boolean
  discovered: boolean
  reducedMotion: boolean
}) {
  const pulse = React.useRef<THREE.Group>(null)
  const isTownSquare = landmark.id === "town-square"
  const height = isTownSquare ? 0.235 : 0.125
  const color = active ? COLORS.route : discovered ? "#386b58" : "#70857b"
  useFrame(({ clock }) => {
    if (!pulse.current) return
    const scale =
      active && !reducedMotion
        ? 1 + Math.sin(clock.elapsedTime * 2.2) * 0.035
        : 1
    pulse.current.scale.setScalar(scale)
  })
  return (
    <group position={[landmark.position[0], height, landmark.position[2]]}>
      <group ref={pulse}>
        {!isTownSquare && (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.12, 36]} />
            <meshStandardMaterial
              color={active ? "#ead7c6" : "#d7dfd3"}
              transparent
              opacity={active ? 0.92 : discovered ? 0.72 : 0.5}
              roughness={1}
            />
          </mesh>
        )}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
          <ringGeometry args={[0.91, 1.16, 36]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={active ? 1 : discovered ? 0.86 : 0.58}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {discovered && !active && (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.16, 20]} />
          <meshBasicMaterial color="#386b58" />
        </mesh>
      )}
      {active && (
        <mesh position={[0, 2.45, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.29, 0.72, 8]} />
          <meshStandardMaterial
            color={COLORS.route}
            emissive="#713021"
            emissiveIntensity={0.22}
          />
        </mesh>
      )}
    </group>
  )
}

const houseColors = [
  "#d5bf9f",
  "#b9c8ba",
  "#d5b4a6",
  "#c0c9b0",
  "#d4c5a7",
  "#cbb4a9",
] as const
interface RoadsideTreeLayout {
  progress: number
  side: -1 | 1
  distance: number
  scale: number
  variant: TreeVariant
}

const treeLayouts: readonly RoadsideTreeLayout[] = [
  {
    progress: educationRoadProgress(0.13),
    side: 1,
    distance: 8.4,
    scale: 0.95,
    variant: "rain-tree",
  },
  {
    progress: educationRoadProgress(0.18),
    side: 1,
    distance: 12.6,
    scale: 0.78,
    variant: "palm",
  },
  {
    progress: educationRoadProgress(0.25),
    side: -1,
    distance: 10.4,
    scale: 0.82,
    variant: "broadleaf",
  },
  {
    progress: educationRoadProgress(0.31),
    side: 1,
    distance: 11.2,
    scale: 0.9,
    variant: "rain-tree",
  },
  {
    progress: educationRoadProgress(0.4),
    side: -1,
    distance: 13.2,
    scale: 0.8,
    variant: "palm",
  },
  {
    progress: educationRoadProgress(0.47),
    side: -1,
    distance: 10.2,
    scale: 1.05,
    variant: "broadleaf",
  },
  {
    progress: educationRoadProgress(0.55),
    side: 1,
    distance: 8.8,
    scale: 0.92,
    variant: "rain-tree",
  },
  {
    progress: educationRoadProgress(0.62),
    side: 1,
    distance: 13.6,
    scale: 0.76,
    variant: "palm",
  },
  {
    progress: educationRoadProgress(0.67),
    side: -1,
    distance: 10.4,
    scale: 1.08,
    variant: "broadleaf",
  },
  {
    progress: educationRoadProgress(0.73),
    side: 1,
    distance: 9.3,
    scale: 0.88,
    variant: "rain-tree",
  },
  {
    progress: educationRoadProgress(0.8),
    side: -1,
    distance: 13.4,
    scale: 0.84,
    variant: "palm",
  },
  {
    progress: educationRoadProgress(0.86),
    side: -1,
    distance: 10.8,
    scale: 1.02,
    variant: "broadleaf",
  },
  {
    progress: educationRoadProgress(0.94),
    side: 1,
    distance: 8.9,
    scale: 0.9,
    variant: "rain-tree",
  },
  {
    progress: careerRoadProgress(0.57),
    side: -1,
    distance: 13.2,
    scale: 0.82,
    variant: "palm",
  },
  {
    progress: careerRoadProgress(0.59),
    side: 1,
    distance: 9.6,
    scale: 0.92,
    variant: "broadleaf",
  },
  {
    progress: careerRoadProgress(0.66),
    side: -1,
    distance: 10.7,
    scale: 1.04,
    variant: "rain-tree",
  },
  {
    progress: careerRoadProgress(0.7),
    side: -1,
    distance: 8.8,
    scale: 0.82,
    variant: "broadleaf",
  },
  {
    progress: careerRoadProgress(0.74),
    side: 1,
    distance: 13.1,
    scale: 0.78,
    variant: "palm",
  },
  {
    progress: careerRoadProgress(0.77),
    side: 1,
    distance: 10.2,
    scale: 0.98,
    variant: "rain-tree",
  },
  {
    progress: careerRoadProgress(0.85),
    side: 1,
    distance: 9.4,
    scale: 0.88,
    variant: "broadleaf",
  },
  {
    progress: careerRoadProgress(0.88),
    side: -1,
    distance: 10.6,
    scale: 1.02,
    variant: "rain-tree",
  },
  {
    progress: careerRoadProgress(0.92),
    side: 1,
    distance: 13.4,
    scale: 0.8,
    variant: "palm",
  },
  {
    progress: careerRoadProgress(0.96),
    side: -1,
    distance: 9.2,
    scale: 0.9,
    variant: "broadleaf",
  },
  {
    progress: learningRoadProgress(0.78),
    side: 1,
    distance: 10.4,
    scale: 0.94,
    variant: "rain-tree",
  },
  {
    progress: learningRoadProgress(0.83),
    side: 1,
    distance: 9.2,
    scale: 0.84,
    variant: "broadleaf",
  },
  {
    progress: learningRoadProgress(0.88),
    side: -1,
    distance: 13.6,
    scale: 0.76,
    variant: "palm",
  },
  {
    progress: learningRoadProgress(0.91),
    side: 1,
    distance: 10.5,
    scale: 1.02,
    variant: "rain-tree",
  },
  {
    progress: learningRoadProgress(0.97),
    side: -1,
    distance: 9.5,
    scale: 0.9,
    variant: "broadleaf",
  },
  {
    progress: projectRoadProgress(0.78),
    side: -1,
    distance: 10.2,
    scale: 0.9,
    variant: "rain-tree",
  },
  {
    progress: projectRoadProgress(0.83),
    side: -1,
    distance: 9.4,
    scale: 0.82,
    variant: "broadleaf",
  },
  {
    progress: projectRoadProgress(0.87),
    side: 1,
    distance: 13.2,
    scale: 0.8,
    variant: "palm",
  },
  {
    progress: projectRoadProgress(0.9),
    side: -1,
    distance: 10.6,
    scale: 1.04,
    variant: "rain-tree",
  },
  {
    progress: projectRoadProgress(0.96),
    side: 1,
    distance: 9.2,
    scale: 0.88,
    variant: "broadleaf",
  },
  {
    progress: communityRoadProgress(0.79),
    side: 1,
    distance: 10.2,
    scale: 0.88,
    variant: "rain-tree",
  },
  {
    progress: communityRoadProgress(0.84),
    side: 1,
    distance: 9.3,
    scale: 0.96,
    variant: "broadleaf",
  },
  {
    progress: communityRoadProgress(0.88),
    side: -1,
    distance: 13.5,
    scale: 0.78,
    variant: "palm",
  },
  {
    progress: communityRoadProgress(0.92),
    side: 1,
    distance: 10.5,
    scale: 1.04,
    variant: "rain-tree",
  },
  {
    progress: communityRoadProgress(0.96),
    side: -1,
    distance: 9.4,
    scale: 0.86,
    variant: "broadleaf",
  },
  { progress: 0.79, side: 1, distance: 10.1, scale: 0.9, variant: "rain-tree" },
  {
    progress: 0.84,
    side: -1,
    distance: 10.7,
    scale: 0.96,
    variant: "broadleaf",
  },
  { progress: 0.88, side: 1, distance: 13.6, scale: 0.78, variant: "palm" },
  { progress: 0.93, side: 1, distance: 9.5, scale: 1.02, variant: "rain-tree" },
  {
    progress: 0.97,
    side: -1,
    distance: 9.8,
    scale: 0.88,
    variant: "broadleaf",
  },
]

const shrubLayouts = [
  [educationRoadProgress(0.14), -1, 7.1, 0.88, true],
  [educationRoadProgress(0.23), 1, 7.6, 0.72, false],
  [educationRoadProgress(0.41), 1, 8.2, 0.82, true],
  [educationRoadProgress(0.52), -1, 7.4, 0.76, false],
  [educationRoadProgress(0.7), -1, 7.2, 0.86, true],
  [educationRoadProgress(0.82), 1, 7.8, 0.74, false],
  [careerRoadProgress(0.58), -1, 7.4, 0.78, true],
  [careerRoadProgress(0.64), 1, 7.8, 0.84, false],
  [careerRoadProgress(0.73), -1, 7.2, 0.74, true],
  [careerRoadProgress(0.81), 1, 7.6, 0.88, false],
  [careerRoadProgress(0.9), -1, 7.5, 0.8, true],
  [learningRoadProgress(0.8), -1, 7.6, 0.82, false],
  [learningRoadProgress(0.94), 1, 7.2, 0.76, true],
  [projectRoadProgress(0.8), 1, 7.4, 0.86, false],
  [projectRoadProgress(0.92), -1, 7.7, 0.78, true],
  [communityRoadProgress(0.81), -1, 7.5, 0.82, false],
  [communityRoadProgress(0.94), 1, 7.2, 0.76, true],
  [0.81, -1, 7.4, 0.86, false],
  [0.9, -1, 7.8, 0.8, true],
  [0.98, 1, 7.5, 0.74, false],
] as const

const grassLayouts = [
  [educationRoadProgress(0.17), -1, 6.2, 0.76, 0.2],
  [educationRoadProgress(0.24), 1, 6.6, 0.9, 1.4],
  [educationRoadProgress(0.38), -1, 6.4, 0.82, 2.2],
  [educationRoadProgress(0.45), 1, 6.8, 0.72, 0.8],
  [educationRoadProgress(0.58), -1, 6.3, 0.92, 1.8],
  [educationRoadProgress(0.76), 1, 6.5, 0.78, 2.7],
  [educationRoadProgress(0.88), -1, 6.2, 0.86, 1.1],
  [careerRoadProgress(0.57), 1, 6.5, 0.84, 0.4],
  [careerRoadProgress(0.62), -1, 6.3, 0.76, 2.4],
  [careerRoadProgress(0.69), 1, 6.7, 0.9, 1.2],
  [careerRoadProgress(0.76), -1, 6.2, 0.8, 2.8],
  [careerRoadProgress(0.84), 1, 6.6, 0.74, 0.7],
  [careerRoadProgress(0.94), -1, 6.4, 0.88, 1.9],
  [learningRoadProgress(0.82), 1, 6.3, 0.82, 0.6],
  [learningRoadProgress(0.91), -1, 6.6, 0.76, 2.1],
  [projectRoadProgress(0.81), -1, 6.4, 0.88, 1.3],
  [projectRoadProgress(0.94), 1, 6.2, 0.78, 2.5],
  [communityRoadProgress(0.82), 1, 6.5, 0.84, 0.9],
  [communityRoadProgress(0.93), -1, 6.3, 0.74, 2.3],
  [0.8, 1, 6.4, 0.9, 1.5],
  [0.88, -1, 6.2, 0.8, 2.9],
  [0.96, 1, 6.6, 0.86, 0.5],
] as const

const streetLampProgress = [
  educationRoadProgress(0.13),
  educationRoadProgress(0.31),
  educationRoadProgress(0.5),
  educationRoadProgress(0.69),
  educationRoadProgress(0.87),
  careerRoadProgress(0.61),
  careerRoadProgress(0.7),
  careerRoadProgress(0.8),
  careerRoadProgress(0.89),
  careerRoadProgress(0.96),
  learningRoadProgress(0.78),
  learningRoadProgress(0.86),
  learningRoadProgress(0.95),
  projectRoadProgress(0.79),
  projectRoadProgress(0.87),
  projectRoadProgress(0.95),
  communityRoadProgress(0.79),
  communityRoadProgress(0.87),
  communityRoadProgress(0.95),
  0.8,
  0.89,
  0.97,
] as const

const StaticJourneyWorld = React.memo(function StaticJourneyWorld({
  renderTier,
}: {
  renderTier: JourneyRenderTier
}) {
  const renderConfig = JOURNEY_RENDER_CONFIG[renderTier]
  return (
    <>
      <color attach="background" args={["#bcd3d6"]} />
      <fog attach="fog" args={["#bcd3d6", 56, 108]} />
      <ambientLight intensity={1.08} color="#edf3df" />
      <hemisphereLight args={["#dcecef", "#6f695b", 1.05]} />
      <directionalLight
        position={[12, 18, 9]}
        intensity={2.15}
        color="#fff0bf"
        castShadow={renderConfig.shadows}
        shadow-mapSize={[
          renderConfig.shadowMapSize,
          renderConfig.shadowMapSize,
        ]}
        shadow-camera-far={100}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={46}
        shadow-camera-bottom={-46}
      />

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[85, 0.1, 275]} position={[5, -0.1, -145]} />
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[5, -0.02, -145]}
          receiveShadow
        >
          <planeGeometry args={[170, 550]} />
          <meshStandardMaterial color={COLORS.grass} roughness={1} />
        </mesh>
      </RigidBody>

      <StreetRibbon width={6.36} height={0.008} color={COLORS.asphaltEdge} />
      <StreetRibbon
        width={JOURNEY_STREET.roadwayWidth}
        height={0.025}
        color={COLORS.asphalt}
      />
      <StreetRibbon
        width={0.3}
        height={0.036}
        color={COLORS.drain}
        offset={JOURNEY_STREET.drainOffset}
      />
      <StreetRibbon
        width={0.3}
        height={0.036}
        color={COLORS.drain}
        offset={-JOURNEY_STREET.drainOffset}
      />
      <StreetRibbon
        width={0.18}
        height={0.052}
        color={COLORS.sidewalkEdge}
        offset={JOURNEY_STREET.curbOffset}
      />
      <StreetRibbon
        width={0.18}
        height={0.052}
        color={COLORS.sidewalkEdge}
        offset={-JOURNEY_STREET.curbOffset}
      />
      <StreetRibbon
        width={1.48}
        height={0.038}
        color={COLORS.sidewalkEdge}
        offset={JOURNEY_STREET.sidewalkOffset}
      />
      <StreetRibbon
        width={1.3}
        height={0.058}
        color={COLORS.sidewalk}
        offset={JOURNEY_STREET.sidewalkOffset}
      />
      <StreetRibbon
        width={1.48}
        height={0.038}
        color={COLORS.sidewalkEdge}
        offset={-JOURNEY_STREET.sidewalkOffset}
      />
      <StreetRibbon
        width={1.3}
        height={0.058}
        color={COLORS.sidewalk}
        offset={-JOURNEY_STREET.sidewalkOffset}
      />
      <StreetRibbon
        width={0.12}
        height={0.108}
        color={COLORS.route}
        offset={1.28}
      />
      <RoadLaneMarkers />

      <TownSquare />
      {JOURNEY_CROSSWALK_PROGRESS.slice(1).map((progress) => (
        <Crosswalk key={progress} progress={progress} />
      ))}

      {Object.values(JOURNEY_BUILDING_PLOTS).map((plot) => (
        <React.Fragment key={plot.id}>
          <PlotGround
            plot={plot}
            color={
              plot.id === "carmichael-college"
                ? "#789374"
                : plot.id === "contact-pavilion"
                  ? "#789070"
                  : "#839b7d"
            }
          />
          <AccessConnection plot={plot} />
        </React.Fragment>
      ))}
      {JOURNEY_HOUSE_PLOTS.map((plot) => (
        <AccessConnection key={`drive-${plot.id}`} plot={plot} />
      ))}

      <RangpurZillaSchool
        plot={JOURNEY_BUILDING_PLOTS["rangpur-zilla-school"]}
      />
      <CarmichaelCollege plot={JOURNEY_BUILDING_PLOTS["carmichael-college"]} />
      <BaustCampus plot={JOURNEY_BUILDING_PLOTS.baust} />
      <CareerOffice
        plot={JOURNEY_BUILDING_PLOTS["codez-info-tech"]}
        variant="codez"
        title="Codez Info Tech"
      />
      <CareerOffice
        plot={JOURNEY_BUILDING_PLOTS.drra}
        variant="drra"
        title="DRRA"
      />
      <CareerOffice
        plot={JOURNEY_BUILDING_PLOTS["multiversal-software"]}
        variant="multiversal"
        title="Multiversal Software"
      />
      <CareerOffice
        plot={JOURNEY_BUILDING_PLOTS.mymedicalhub}
        variant="medical"
        title="MyMedicalHub"
      />
      <LearningLibrary plot={JOURNEY_BUILDING_PLOTS["learning-library"]} />
      <ProjectWorkshop plot={JOURNEY_BUILDING_PLOTS["project-workshop"]} />
      <CommunityHall plot={JOURNEY_BUILDING_PLOTS["community-hall"]} />
      <ContactPavilion plot={JOURNEY_BUILDING_PLOTS["contact-pavilion"]} />

      {JOURNEY_HOUSE_PLOTS.map((plot, index) => (
        <TownHouse
          key={plot.id}
          plot={plot}
          color={houseColors[index]}
          height={2.35 + (index % 3) * 0.25}
        />
      ))}

      {treeLayouts
        .filter((_, index) => index % renderConfig.sceneryStride === 0)
        .map(({ progress, side, distance, scale, variant }, index) => (
          <Tree
            key={`tree-${progress}-${side}-${index}`}
            position={positionBesideRoad(progress, side, distance)}
            scale={scale}
            variant={variant}
          />
        ))}
      {shrubLayouts
        .filter((_, index) => index % renderConfig.sceneryStride === 0)
        .map(([progress, side, distance, scale, flowering], index) => (
          <Shrub
            key={`shrub-${progress}-${side}-${index}`}
            position={positionBesideRoad(progress, side, distance)}
            scale={scale}
            flowering={flowering}
          />
        ))}
      {grassLayouts
        .filter((_, index) => index % renderConfig.sceneryStride === 0)
        .map(([progress, side, distance, scale, rotation], index) => (
          <GrassClump
            key={`grass-${progress}-${side}-${index}`}
            position={positionBesideRoad(progress, side, distance)}
            scale={scale}
            rotation={rotation}
          />
        ))}
      {streetLampProgress
        .filter((_, index) => index % renderConfig.sceneryStride === 0)
        .flatMap((progress) =>
          ([-1, 1] as const).map((side) => (
            <StreetLamp
              key={`${progress}-${side}`}
              progress={progress}
              side={side}
            />
          ))
        )}
      <ParkedRickshaw progress={educationRoadProgress(0.29)} side={1} />
      {renderTier === "high" && (
        <StreetBench progress={educationRoadProgress(0.58)} side={1} />
      )}
    </>
  )
})

const JourneyCheckpoints = React.memo(function JourneyCheckpoints({
  landmarks,
  activeLandmark,
  discoveredIds,
  reducedMotion,
}: {
  landmarks: readonly JourneyLandmark[]
  activeLandmark: JourneyLandmark
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  reducedMotion: boolean
}) {
  return (
    <>
      {landmarks.map((landmark) => (
        <LandmarkCheckpoint
          key={landmark.id}
          landmark={landmark}
          active={landmark.id === activeLandmark.id}
          discovered={discoveredIds.has(landmark.id)}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  )
})

interface JourneyWorldProps {
  landmarks: readonly JourneyLandmark[]
  activeLandmark: JourneyLandmark
  discoveredIds: ReadonlySet<JourneyLandmarkId>
  renderTier: JourneyRenderTier
  reducedMotion: boolean
}

function JourneyWorldComponent({
  landmarks,
  activeLandmark,
  discoveredIds,
  renderTier,
  reducedMotion,
}: JourneyWorldProps) {
  return (
    <>
      <StaticJourneyWorld renderTier={renderTier} />
      <JourneyCheckpoints
        landmarks={landmarks}
        activeLandmark={activeLandmark}
        discoveredIds={discoveredIds}
        reducedMotion={reducedMotion}
      />
    </>
  )
}

export const JourneyWorld = React.memo(JourneyWorldComponent)
