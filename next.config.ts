import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon; it must stay a real require() at runtime
  // rather than being traced into the server bundle.
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
