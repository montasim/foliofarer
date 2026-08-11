"use client"

import * as React from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

interface MontasimAvatarProps {
  movingRef: React.MutableRefObject<boolean>
  runningRef: React.MutableRefObject<boolean>
  reducedMotion: boolean
}

export function MontasimAvatar({
  movingRef,
  runningRef,
  reducedMotion,
}: MontasimAvatarProps) {
  const leftArm = React.useRef<THREE.Group>(null)
  const rightArm = React.useRef<THREE.Group>(null)
  const leftLeg = React.useRef<THREE.Group>(null)
  const rightLeg = React.useRef<THREE.Group>(null)
  const avatar = React.useRef<THREE.Group>(null)

  useFrame(({ clock }, delta) => {
    const strideRate = runningRef.current ? 13 : 9
    const strideLength = runningRef.current ? 0.68 : 0.55
    const target =
      movingRef.current && !reducedMotion
        ? Math.sin(clock.elapsedTime * strideRate) * strideLength
        : 0
    const damping = 1 - Math.exp(-delta * 12)

    if (leftArm.current)
      leftArm.current.rotation.x +=
        (-target - leftArm.current.rotation.x) * damping
    if (rightArm.current)
      rightArm.current.rotation.x +=
        (target - rightArm.current.rotation.x) * damping
    if (leftLeg.current)
      leftLeg.current.rotation.x +=
        (target - leftLeg.current.rotation.x) * damping
    if (rightLeg.current)
      rightLeg.current.rotation.x +=
        (-target - rightLeg.current.rotation.x) * damping
    if (avatar.current) {
      const bob =
        movingRef.current && !reducedMotion
          ? Math.abs(Math.sin(clock.elapsedTime * strideRate)) *
            (runningRef.current ? 0.055 : 0.035)
          : 0
      avatar.current.position.y += (bob - avatar.current.position.y) * damping
    }
  })

  return (
    <group ref={avatar} position={[0, 0, 0]}>
      <group ref={leftLeg} position={[-0.19, -0.34, 0]}>
        <mesh position={[0, -0.28, 0]} castShadow>
          <boxGeometry args={[0.25, 0.58, 0.27]} />
          <meshStandardMaterial color="#263331" roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.59, 0.055]} castShadow>
          <boxGeometry args={[0.28, 0.13, 0.38]} />
          <meshStandardMaterial color="#17211f" roughness={0.95} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.19, -0.34, 0]}>
        <mesh position={[0, -0.28, 0]} castShadow>
          <boxGeometry args={[0.25, 0.58, 0.27]} />
          <meshStandardMaterial color="#263331" roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.59, 0.055]} castShadow>
          <boxGeometry args={[0.28, 0.13, 0.38]} />
          <meshStandardMaterial color="#17211f" roughness={0.95} />
        </mesh>
      </group>

      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.72, 0.78, 0.35]} />
        <meshStandardMaterial color="#263f50" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.13, 0.19]} castShadow>
        <boxGeometry args={[0.32, 0.55, 0.025]} />
        <meshStandardMaterial color="#f2f0e9" roughness={0.8} />
      </mesh>
      <mesh
        position={[0, 0.08, 0.215]}
        rotation={[0, 0, Math.PI / 4]}
        castShadow
      >
        <boxGeometry args={[0.1, 0.1, 0.035]} />
        <meshStandardMaterial color="#a6574b" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.08, 0.215]} castShadow>
        <boxGeometry args={[0.065, 0.26, 0.035]} />
        <meshStandardMaterial color="#a6574b" roughness={0.8} />
      </mesh>

      <group ref={leftArm} position={[-0.48, 0.29, 0]}>
        <mesh position={[0, -0.28, 0]} castShadow>
          <boxGeometry args={[0.22, 0.66, 0.27]} />
          <meshStandardMaterial color="#263f50" roughness={0.78} />
        </mesh>
        <mesh position={[0, -0.64, 0]} castShadow>
          <sphereGeometry args={[0.13, 8, 6]} />
          <meshStandardMaterial color="#a66f57" roughness={0.9} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.48, 0.29, 0]}>
        <mesh position={[0, -0.28, 0]} castShadow>
          <boxGeometry args={[0.22, 0.66, 0.27]} />
          <meshStandardMaterial color="#263f50" roughness={0.78} />
        </mesh>
        <mesh position={[0, -0.64, 0]} castShadow>
          <sphereGeometry args={[0.13, 8, 6]} />
          <meshStandardMaterial color="#a66f57" roughness={0.9} />
        </mesh>
      </group>

      <mesh position={[0, 0.79, 0]} castShadow>
        <sphereGeometry args={[0.36, 12, 8]} />
        <meshStandardMaterial color="#a66f57" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.67, 0.16]} scale={[1, 0.65, 0.55]} castShadow>
        <sphereGeometry args={[0.37, 12, 8]} />
        <meshStandardMaterial color="#2b211d" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.83, 0.14]} scale={[0.91, 0.72, 0.55]} castShadow>
        <sphereGeometry args={[0.34, 12, 8]} />
        <meshStandardMaterial color="#a66f57" roughness={0.92} />
      </mesh>
      <mesh position={[0, 1.06, -0.02]} scale={[1.08, 0.46, 1]} castShadow>
        <sphereGeometry args={[0.35, 12, 8]} />
        <meshStandardMaterial color="#1d1917" roughness={0.96} />
      </mesh>
    </group>
  )
}
