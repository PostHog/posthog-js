import type { NextConfig } from 'next'

// Extend Next.js compiler type to include runAfterProductionCompile
type ExtendedCompiler = NextConfig['compiler'] & {
  runAfterProductionCompile?: () => void | Promise<void>
}

// Create extended NextConfig type
export interface ExtendedNextConfig extends Omit<NextConfig, 'compiler'> {
  compiler?: ExtendedCompiler
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
