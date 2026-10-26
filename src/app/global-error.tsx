'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en-SG">
      <body>
        <main style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>The application failed to start</h1>
          <p style={{ color: '#475569' }}>
            This is usually a configuration problem — check the server logs and your .env file.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#94a3b8' }}>
              reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: '#0f172a',
              color: 'white',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
