'use client'

import { useEffect } from 'react'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        message: 'unhandled route error',
        digest: error.digest,
        detail: error.message,
      }),
    )
  }, [error])

  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-slate-600">
        The error has been logged. Nothing you entered has been lost — try again.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-slate-400">reference: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Try again
      </button>
    </main>
  )
}
