interface JourneyWebGLSupportGlobal {
  __montasimJourneyWebGLSupportV1?: boolean
}

/**
 * Probe WebGL once for the lifetime of the browser page.
 *
 * React development mode intentionally mounts effects twice. Keeping the
 * result on globalThis makes the probe survive those mounts and hot reloads.
 * The probe must not call WEBGL_lose_context: explicitly losing several
 * temporary contexts can evict the renderer we are about to create on
 * constrained browsers.
 */
export function supportsJourneyWebGL() {
  if (typeof document === "undefined") return true

  const browserGlobal = globalThis as typeof globalThis &
    JourneyWebGLSupportGlobal
  if (typeof browserGlobal.__montasimJourneyWebGLSupportV1 === "boolean") {
    return browserGlobal.__montasimJourneyWebGLSupportV1
  }

  let supported = false
  try {
    const canvas = document.createElement("canvas")
    const attributes: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
    }
    supported = Boolean(
      canvas.getContext("webgl2", attributes) ??
        canvas.getContext("webgl", attributes)
    )
  } catch {
    supported = false
  }

  browserGlobal.__montasimJourneyWebGLSupportV1 = supported
  return supported
}
