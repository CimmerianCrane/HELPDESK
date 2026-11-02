'use client'

import { useEffect, useRef } from 'react'

/**
 * A signature, drawn with a finger or a stylus.
 *
 * The canvas has a fixed drawing buffer and is stretched with CSS: resizing a canvas clears it, and a
 * phone rotating half way through a signature is not worth the restore logic. The export is a PNG on
 * white, because a transparent signature renders as black-on-black in some PDF viewers.
 */

const WIDTH = 600
const HEIGHT = 200

export function SignaturePad({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string | null
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  // Paint the saved signature back onto the pad when the form loads it from Dexie.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, WIDTH, HEIGHT)
    if (!value) return

    const image = new Image()
    image.onload = () => context.drawImage(image, 0, 0, WIDTH, HEIGHT)
    image.src = value
  }, [value])

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const { x, y } = point(event)
    context.lineWidth = 2.5
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#0f172a'
    context.beginPath()
    context.moveTo(x, y)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const { x, y } = point(event)
    context.lineTo(x, y)
    context.stroke()
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, WIDTH, HEIGHT)
    onChange(null)
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        {(value || !disabled) && (
          <button
            type="button"
            onClick={clear}
            className="text-sm font-medium text-info underline"
          >
            Clear
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`${label} signature pad`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        className="mt-1 h-32 w-full touch-none rounded-lg border border-line bg-field md:h-40"
      />
      <p className="mt-1 text-xs text-muted">
        {value ? 'Signed.' : 'Sign with a finger or a stylus.'}
      </p>
    </div>
  )
}
