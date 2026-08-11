"use client"

import * as React from "react"
import {
  resolveJourneyV2Quality,
  type JourneyV2Quality,
} from "@/lib/journey-v2/design"
import { supportsJourneyWebGL } from "@/lib/journey-v2/runtime/webgl-support"

interface JourneyNavigatorConnection {
  effectiveType?: string
  saveData?: boolean
}

interface JourneyNavigator extends Navigator {
  connection?: JourneyNavigatorConnection
  deviceMemory?: number
}

export function useDialogFocusTrap(
  open: boolean,
  dialogRef: React.RefObject<HTMLElement | null>,
  onClose: () => void
) {
  const onCloseRef = React.useRef(onClose)

  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open || !dialogRef.current) return

    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusableElements = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "summary",
            '[tabindex]:not([tabindex="-1"])',
          ].join(",")
        )
      ).filter((element) => {
        const style = window.getComputedStyle(element)
        return (
          !element.hasAttribute("hidden") &&
          !element.closest('[inert], [aria-hidden="true"]') &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        )
      })

    const focusFirstElement = () => {
      const first = focusableElements()[0]
      if (first) first.focus()
      else dialog.focus()
    }
    const animationFrame = window.requestAnimationFrame(focusFirstElement)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return

      const elements = focusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog.addEventListener("keydown", handleKeyDown)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      dialog.removeEventListener("keydown", handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [dialogRef, open])
}

export function useJourneyV2Environment() {
  const [environment, setEnvironment] = React.useState({
    reducedMotion: false,
    coarsePointer: false,
    quality: "balanced" as JourneyV2Quality,
    webglAvailable: true,
    checked: false,
  })

  React.useEffect(() => {
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    )
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)")
    const reducedDataQuery = window.matchMedia(
      "(prefers-reduced-data: reduce)"
    )
    const journeyNavigator = navigator as JourneyNavigator
    const webglAvailable = supportsJourneyWebGL()

    const readEnvironment = () => {
      const reducedMotion = reducedMotionQuery.matches
      const coarsePointer =
        coarsePointerQuery.matches || window.innerWidth < 768
      setEnvironment({
        reducedMotion,
        coarsePointer,
        quality: resolveJourneyV2Quality({
          coarsePointer,
          viewportWidth: window.innerWidth,
          reducedMotion,
          reducedData: reducedDataQuery.matches,
          saveData: journeyNavigator.connection?.saveData,
          effectiveConnectionType:
            journeyNavigator.connection?.effectiveType,
          deviceMemory: journeyNavigator.deviceMemory,
          hardwareConcurrency: journeyNavigator.hardwareConcurrency,
        }),
        webglAvailable,
        checked: true,
      })
    }

    readEnvironment()
    reducedMotionQuery.addEventListener("change", readEnvironment)
    coarsePointerQuery.addEventListener("change", readEnvironment)
    reducedDataQuery.addEventListener("change", readEnvironment)
    window.addEventListener("resize", readEnvironment)
    return () => {
      reducedMotionQuery.removeEventListener("change", readEnvironment)
      coarsePointerQuery.removeEventListener("change", readEnvironment)
      reducedDataQuery.removeEventListener("change", readEnvironment)
      window.removeEventListener("resize", readEnvironment)
    }
  }, [])

  return environment
}
