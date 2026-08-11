import { createNoise2D } from "simplex-noise"

import { createSeededRandom, hashString } from "./random.ts"

export interface CompilerRandom {
  int(): number
  float(max?: number): number
  probability(probability: number): boolean
  minmax(minimum: number, maximum: number): number
  minmaxInt(minimum: number, maximum: number): number
  minmaxUint(minimum: number, maximum: number): number
  norm(scale?: number): number
  normMinMax(minimum: number, maximum: number): number
}

export function createCompilerRandom(seed: number): CompilerRandom {
  const random = createSeededRandom(seed)
  return {
    int: () => Math.floor(random() * 0x1_0000_0000) >>> 0,
    float: (maximum = 1) => random() * maximum,
    probability: (probability) => random() < probability,
    minmax: (minimum, maximum) => minimum + random() * (maximum - minimum),
    minmaxInt: (minimum, maximum) =>
      Math.floor(minimum + random() * (maximum - minimum)),
    minmaxUint: (minimum, maximum) =>
      Math.floor(minimum + random() * (maximum - minimum)) >>> 0,
    norm: (scale = 1) => (random() * 2 - 1) * scale,
    normMinMax: (minimum, maximum) => {
      const magnitude = minimum + random() * (maximum - minimum)
      return random() < 0.5 ? -magnitude : magnitude
    },
  }
}

export function createWorldNoise(seed: number, channel: string) {
  return createNoise2D(
    createSeededRandom(seed ^ hashString(`journey-v3:${channel}`))
  )
}
