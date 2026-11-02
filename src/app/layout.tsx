import type { Metadata } from 'next'
import { Barlow_Condensed, Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cimmerian Crane Services — Helpdesk',
  description: 'Job management, servicing and compliance records for Cimmerian Crane Services.',
}

// Self-hosted by Next at build time, so a phone with no signal still has the app's own face.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

// Headings. Condensed and heavy enough to read across a workshop floor.
const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
})

// Document numbers, asset tags, measurements in tables.
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG" className={`${inter.variable} ${barlow.variable} ${jetbrains.variable}`}>
      <body>
        {/* `beforeinstallprompt` fires once, early, and cannot be re-asked for — so it is caught
            here, before anything hydrates, for the field app's install card to use.

            It lives in the root layout, not the field one: a `<Link>` from the dashboard into
            `/m/jobs` is a client-side navigation, so `(tech)/layout.tsx` mounts inside React. React
            19 warns about a `<script>` there and skips it, and `beforeInteractive` does not help —
            Next only hoists it out of the server HTML. The root layout is the one component that
            never re-renders on a navigation. */}
        <Script
          id="tech-install-prompt"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__techInstallPrompt=e;(window.__techInstallListeners||[]).forEach(function(f){f()})})`,
          }}
        />
        {children}
      </body>
    </html>
  )
}
