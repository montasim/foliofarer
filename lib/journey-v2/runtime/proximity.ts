import * as THREE from "three"

export function distancePointToSegment2D(
  pointX: number,
  pointZ: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
) {
  const segmentX = toX - fromX
  const segmentZ = toZ - fromZ
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ
  const fraction =
    lengthSquared <= Number.EPSILON
      ? 0
      : THREE.MathUtils.clamp(
          ((pointX - fromX) * segmentX + (pointZ - fromZ) * segmentZ) /
            lengthSquared,
          0,
          1
        )
  return Math.hypot(
    pointX - (fromX + segmentX * fraction),
    pointZ - (fromZ + segmentZ * fraction)
  )
}

export function checkpointArrivalDistance(interactionRadius: number) {
  return THREE.MathUtils.clamp(interactionRadius * 0.42, 1.35, 2.65)
}
