'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reads a crane label with the camera (slice 44).
 *
 * `BarcodeDetector` is native in Android Chrome, including inside an installed PWA, so this needs no
 * dependency — where it is absent the whole button stays off the screen (`detectorSupported`), which
 * is the honest answer rather than a camera that never finds anything. A damaged label is typed in
 * instead: the manual box is always there.
 *
 * The camera stream is stopped in `finally` on every exit, including cancel and unmount — a tablet
 * that keeps its camera light on after a cancelled scan drains a shift's battery.
 */

type DetectedBarcode = { rawValue: string }
type Detector = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> }

const DetectedBarcodeCtor = (
  globalThis as unknown as {
    BarcodeDetector?: { new (options?: { formats?: string[] }): Detector }
  }
).BarcodeDetector

/** Cheap feature test for the action's visibility — no camera is touched to answer it. */
export function detectorSupported(): boolean {
  return typeof DetectedBarcodeCtor === 'function'
}

export function QrScanner({
  onScan,
  onCancel,
}: {
  /** Every raw value the camera reads; the caller decides whether it is a crane label. */
  onScan: (raw: string) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // The camera effect must not restart because the parent re-rendered and handed over a new
  // callback; it reads the latest one through a ref instead.
  const onScanRef = useRef(onScan)
  useEffect(() => {
    onScanRef.current = onScan
  })
  const [error, setError] = useState<string | null>(
    DetectedBarcodeCtor ? null : 'This browser cannot scan labels. Type the code instead.',
  )
  const [manual, setManual] = useState('')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (!DetectedBarcodeCtor) return
    const Ctor: NonNullable<typeof DetectedBarcodeCtor> = DetectedBarcodeCtor
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    let detector: Detector | null = null

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        streamRef.current = stream
        if (cancelled) {
          stop()
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const formats = await (
          Ctor as unknown as { getSupportedFormats?: () => Promise<string[]> }
        ).getSupportedFormats?.()
        detector = new Ctor(
          formats?.includes('qr_code') ? { formats: ['qr_code'] } : undefined,
        )

        timer = setInterval(() => {
          if (!detector || !videoRef.current || videoRef.current.readyState < 2) return
          void detector
            .detect(videoRef.current)
            .then((codes) => {
              const value = codes[0]?.rawValue
              if (value) {
                stop()
                onScanRef.current(value)
              }
            })
            .catch(() => {
              // A frame the detector cannot read is a frame, not a failure — keep scanning.
            })
        }, 250)
      } catch (cause) {
        const denied = cause instanceof DOMException && cause.name === 'NotAllowedError'
        setError(
          denied
            ? 'The camera is blocked. Allow camera access (and use HTTPS) or type the code.'
            : 'The camera could not start. Type the code instead.',
        )
      }
    }

    void start()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      stop()
    }
  }, [stop])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-anchor p-4">
      <div className="relative flex-1 overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          aria-label="Camera view"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1/2 w-2/3 rounded-xl border-2 border-hivis" />
        </div>
      </div>

      <p className="mt-3 text-sm text-white">
        Point the camera at the label on the crane.
      </p>
      {error ? <p className="mt-1 text-sm font-medium text-hivis">{error}</p> : null}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (manual.trim()) onScan(manual.trim())
        }}
      >
        <input
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          placeholder="Or type the code"
          autoCapitalize="characters"
          autoComplete="off"
          className="w-full rounded-lg border border-line px-3 py-2 font-mono"
          aria-label="Crane label code"
        />
        <button
          type="submit"
          className="rounded-lg bg-hivis px-3 py-2 font-medium text-ink disabled:opacity-60"
          disabled={!manual.trim()}
        >
          Use
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          stop()
          onCancel()
        }}
        className="mt-3 w-full rounded-xl border border-white/40 px-4 py-3 text-lg font-semibold text-white"
      >
        Cancel
      </button>
    </div>
  )
}
