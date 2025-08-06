import type { NextConfig } from 'next'

// Extend Next.js types to include runAfterProductionCompile
declare module 'next' {
  interface NextConfig {
    runAfterProductionCompile?: () => void | Promise<void>
  }
}

export type NextFuncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => NextConfig
export type NextAsyncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => Promise<NextConfig>
export type UserProvidedConfig = NextConfig | NextFuncConfig | NextAsyncConfig

export type PostHogNextConfig = {
  personalApiKey: string
  envId: string
  host?: string
  verbose?: boolean
  sourcemaps?: {
    enabled?: boolean
    project?: string
    version?: string
    deleteAfterUpload?: boolean
    failOnError?: boolean
  }
}

export type PostHogNextConfigComplete = {
  personalApiKey: string
  envId: string
  host: string
  verbose: boolean
  sourcemaps: {
    enabled: boolean
    project?: string
    version?: string
    deleteAfterUpload: boolean
    failOnError: boolean
  }
}
