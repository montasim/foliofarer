import type * as THREE from "three"

export interface CameraOccluderVolume {
  centerX: number
  centerY: number
  centerZ: number
  radiusXZ: number
  radiusY: number
}

const MINIMUM_CAMERA_TARGET_DISTANCE = 2.75
const CAMERA_OCCLUDER_CLEARANCE = 0.38

/**
 * Finds the first point where a target-to-camera segment enters an
 * axis-aligned canopy ellipsoid. A zero result means the target begins inside
 * the volume; null means the segment remains clear.
 */
export function segmentEllipsoidEntryFraction(
  from: Pick<THREE.Vector3, "x" | "y" | "z">,
  to: Pick<THREE.Vector3, "x" | "y" | "z">,
  volume: CameraOccluderVolume
) {
  const radiusXZ = Math.max(0.01, volume.radiusXZ)
  const radiusY = Math.max(0.01, volume.radiusY)
  const fromX = (from.x - volume.centerX) / radiusXZ
  const fromY = (from.y - volume.centerY) / radiusY
  const fromZ = (from.z - volume.centerZ) / radiusXZ
  const directionX = (to.x - from.x) / radiusXZ
  const directionY = (to.y - from.y) / radiusY
  const directionZ = (to.z - from.z) / radiusXZ
  const a =
    directionX * directionX + directionY * directionY + directionZ * directionZ
  const c = fromX * fromX + fromY * fromY + fromZ * fromZ - 1
  if (c <= 0) return 0
  if (a <= Number.EPSILON) return null

  const b = 2 * (fromX * directionX + fromY * directionY + fromZ * directionZ)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const squareRoot = Math.sqrt(discriminant)
  const entry = (-b - squareRoot) / (2 * a)
  const exit = (-b + squareRoot) / (2 * a)
  if (exit < 0 || entry > 1) return null
  return Math.max(0, entry)
}

export function minimumSafeCameraFraction(
  from: Pick<THREE.Vector3, "x" | "y" | "z">,
  to: Pick<THREE.Vector3, "x" | "y" | "z">
) {
  const segmentLength = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  if (segmentLength <= Number.EPSILON) return 1
  return Math.min(1, MINIMUM_CAMERA_TARGET_DISTANCE / segmentLength)
}

/**
 * Foliage avoidance is additive to the existing structural camera collision.
 * In particular, its avatar-safe lower bound must never make a building or
 * bridge collider less restrictive.
 */
export function combineCameraVisibilityFractions(
  structuralFraction: number,
  vegetationFraction: number
) {
  return Math.min(structuralFraction, vegetationFraction)
}

/**
 * Returns how much of a target-to-camera segment can be used while stopping
 * just before one canopy. The minimum fraction keeps the third-person camera
 * outside the avatar even when vegetation begins unusually close to the
 * target.
 */
export function cameraOccluderVisibilityFraction(
  from: Pick<THREE.Vector3, "x" | "y" | "z">,
  to: Pick<THREE.Vector3, "x" | "y" | "z">,
  volume: CameraOccluderVolume
) {
  const entry = segmentEllipsoidEntryFraction(from, to, volume)
  if (entry === null) return 1
  const segmentLength = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  const clearanceFraction =
    segmentLength <= Number.EPSILON
      ? 0
      : CAMERA_OCCLUDER_CLEARANCE / segmentLength
  return Math.max(
    minimumSafeCameraFraction(from, to),
    Math.min(1, entry - clearanceFraction)
  )
}
