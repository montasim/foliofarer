import { hashString } from "./random.ts"

export function checksumJson(value: unknown) {
  return hashString(JSON.stringify(value)).toString(16).padStart(8, "0")
}
