"use client"

import * as React from "react"
import type { MovementInput } from "@/lib/journey/types"

interface MobileJoystickProps {
  movementRef: React.MutableRefObject<MovementInput>
}

export function MobileJoystick({ movementRef }: MobileJoystickProps) {
  const padRef = React.useRef<HTMLDivElement>(null)
  const knobRef = React.useRef<HTMLDivElement>(null)
  const pointerId = React.useRef<number | null>(null)
  const keyboardKeys = React.useRef(new Set<string>())

  const positionKnob = React.useCallback((x: number, y: number) => {
    if (!knobRef.current) return
    knobRef.current.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
  }, [])

  const update = React.useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current
      if (!pad) return
      const rect = pad.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const limit = rect.width * 0.31
      const rawX = clientX - centerX
      const rawY = clientY - centerY
      const distance = Math.hypot(rawX, rawY)
      const scale = distance > limit ? limit / distance : 1
      const x = rawX * scale
      const y = rawY * scale
      positionKnob(x, y)
      movementRef.current.x = x / limit
      movementRef.current.z = y / limit
    },
    [movementRef, positionKnob]
  )

  const updateKeyboardMovement = React.useCallback(() => {
    movementRef.current.x =
      (keyboardKeys.current.has("ArrowRight") ? 1 : 0) -
      (keyboardKeys.current.has("ArrowLeft") ? 1 : 0)
    movementRef.current.z =
      (keyboardKeys.current.has("ArrowDown") ? 1 : 0) -
      (keyboardKeys.current.has("ArrowUp") ? 1 : 0)
  }, [movementRef])

  const release = React.useCallback(() => {
    pointerId.current = null
    positionKnob(0, 0)
    updateKeyboardMovement()
  }, [positionKnob, updateKeyboardMovement])

  const reset = React.useCallback(() => {
    keyboardKeys.current.clear()
    movementRef.current.x = 0
    movementRef.current.z = 0
    release()
  }, [movementRef, release])

  React.useEffect(() => reset, [reset])

  return (
    <div
      ref={padRef}
      data-journey-ui
      aria-label="Movement joystick"
      aria-describedby="journey-joystick-instructions"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      role="group"
      tabIndex={0}
      className="absolute bottom-5 left-5 z-20 size-24 touch-none rounded-full border-2 border-[#e7e1cc]/75 bg-[#173a38]/84 shadow-[5px_6px_0_rgba(196,95,63,0.65)] backdrop-blur-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c45f3f] sm:bottom-7 sm:left-7 sm:size-28"
      onKeyDown={(event) => {
        if (!event.key.startsWith("Arrow")) return
        event.preventDefault()
        keyboardKeys.current.add(event.key)
        updateKeyboardMovement()
      }}
      onKeyUp={(event) => {
        if (!event.key.startsWith("Arrow")) return
        keyboardKeys.current.delete(event.key)
        updateKeyboardMovement()
      }}
      onBlur={reset}
      onPointerDown={(event) => {
        pointerId.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        update(event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (pointerId.current !== event.pointerId) return
        update(event.clientX, event.clientY)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span id="journey-joystick-instructions" className="sr-only">
        Drag to move, or focus this control and use the arrow keys.
      </span>
      <span
        aria-hidden="true"
        className="absolute top-2 left-1/2 -translate-x-1/2 font-mono text-[8px] tracking-[0.12em] text-[#e7e1cc]/75 uppercase"
      >
        Forward
      </span>
      <div className="absolute inset-3 rounded-full border border-[#e7e1cc]/20" />
      <div
        ref={knobRef}
        className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#e7e1cc] bg-[#c45f3f] shadow-lg transition-[transform] duration-75 sm:size-12"
        style={{ transform: "translate(-50%, -50%)" }}
      />
    </div>
  )
}
