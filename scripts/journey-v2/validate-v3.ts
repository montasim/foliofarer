import { compileJourneyWorldV3 } from "../../lib/journey-v2/generator/compiler-v3.ts"
import { validateWorldManifestV3 } from "../../lib/journey-v2/generator/validation-v3.ts"

const first = validateWorldManifestV3(compileJourneyWorldV3())
const second = validateWorldManifestV3(compileJourneyWorldV3())

if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error("Journey V3 compiler output is not deterministic")
}

console.log(
  `Journey V3 valid: ${first.portfolioRecords.length} record references, ` +
    `${first.checkpoints.length} active checkpoints, ` +
    `${first.bridges.length} derived bridges, ` +
    `${first.validation.counts.uniqueTrees} trees`
)
