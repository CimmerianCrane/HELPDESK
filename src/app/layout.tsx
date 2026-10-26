import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cimmerian Crane Services — Helpdesk',
  description: 'Job management, servicing and compliance records for Cimmerian Crane Services.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG">
      <body>{children}</body>
    </html>
  )
}
