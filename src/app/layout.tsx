import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Variant Lab',
  description: 'Generate page variants, run the experiment, see which one converts.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
