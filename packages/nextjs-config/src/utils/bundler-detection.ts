import type { NextConfig } from 'next'

// Extend NextConfig to include turbo properties that may not be in all Next.js versions
interface TurbopackConfig extends NextConfig {
  experimental?: NextConfig['experimental'] & {
    turbo?: boolean
  }
  turbo?: boolean
}

// Helper to detect if Turbopack is enabled
export function isTurbopackEnabled(resolvedUserConfig: NextConfig): boolean {
  const config = resolvedUserConfig as TurbopackConfig
  return (
    // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
    process.env.TURBOPACK === '1' ||
    // Next.js 13+ experimental config: { experimental: { turbo: true } }
    config.experimental?.turbo === true ||
    // Next.js 14+ stable config: { turbo: true }
    config.turbo === true
  )
}
