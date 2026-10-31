import type { Metadata } from 'next'
import { Barlow_Condensed, Inter, JetBrains_Mono } from 'next/font/google'
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
      <body>{children}</body>
    </html>
  )
}
