import type { NextConfig } from 'next'

// Helper to detect if Turbopack is enabled
export function isTurbopackEnabled(resolvedUserConfig: NextConfig): boolean {
  return (
    // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
    process.env.TURBOPACK === '1' ||
    // Next.js 13+ experimental config: { experimental: { turbo: true } }
    (resolvedUserConfig.experimental as any)?.turbo ||
    // Next.js 14+ stable config: { turbo: true }
    (resolvedUserConfig as any).turbo === true
  )
}
