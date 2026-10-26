import type { Metadata } from 'next'
import { OfflineShell } from '@/components/tech/offline-shell'

export const metadata: Metadata = { title: 'Offline — Cimmerian Crane' }

/**
 * What the service worker serves when a phone asks for a page it has never cached and has no
 * network.
 *
 * Static on purpose, and outside both shells: it has to render with no database and no session, so
 * anything that reads the server would defeat it. The component inside reads the phone's own copy
 * and works out from `window.location` which page it was asked to be, so a tap on a job link opens
 * that job rather than a generic apology.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <OfflineShell />
    </main>
  )
}
