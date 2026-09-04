import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir, getNuxtVersion } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import type {} from 'nuxt/app'
import { resolveBinaryPath, spawnLocal } from '@posthog/plugin-utils'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'

const filename = fileURLToPath(import.meta.url)
const resolvedDirname = dirname(filename)
const DEFAULT_NUXT_HOST = 'https://us.i.posthog.com'

function normalizeApiKey(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePersonalApiKey(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value?: unknown): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || DEFAULT_NUXT_HOST
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface SourcemapsConfig {
  enabled: boolean
  personalApiKey: string
  /** @deprecated Use projectId instead */
  envId?: string
  projectId?: string
  /** @deprecated Use releaseVersion instead */
  version?: string
  releaseVersion?: string
  /** @deprecated Use releaseName instead */
  project?: string
  releaseName?: string
  build?: string | number
  logLevel?: LogLevel
  deleteAfterUpload?: boolean
  batchSize?: number
}

export interface ModuleOptions {
  host: string
  publicKey: string
  debug?: boolean
  cliBinaryPath?: string
  clientConfig?: PostHogClientConfig
  serverConfig?: PostHogServerConfig
  sourcemaps: SourcemapsConfig | undefined
}

declare module '@nuxt/schema' {
  interface NuxtConfig {
    posthogConfig?: Partial<ModuleOptions>
  }
  interface NuxtOptions {
    posthogConfig?: ModuleOptions
  }
}

export interface PostHogCommon {
  publicKey: string
  host: string
  debug?: boolean
}

export type PostHogServerConfig = PostHogOptions
export type PostHogClientConfig = Partial<PostHogConfig>

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@posthog/nuxt',
    configKey: 'posthogConfig',
    compatibility: {
      nuxt: '>=3.7.0',
    },
  },
  defaults: () => ({
    host: 'https://us.i.posthog.com',
    debug: false,
    clientConfig: {},
    serverConfig: {},
  }),

  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const normalizedPublicKey = normalizeApiKey(options.publicKey)
    const normalizedHost = normalizeHost(options.host)
    addPlugin({ src: resolver.resolve('./runtime/vue-plugin'), mode: 'client' })
    const nitroPlugin = Number.parseInt(getNuxtVersion(nuxt), 10) >= 5 ? 'nitro-plugin-v3' : 'nitro-plugin-v2'
    addServerPlugin(resolver.resolve(`./runtime/${nitroPlugin}`))
    addImportsDir(resolver.resolve('./runtime/composables'))

    Object.assign(nuxt.options.runtimeConfig.public, {
      posthog: {
        publicKey: normalizedPublicKey,
        host: normalizedHost,
        debug: options.debug,
      },
      posthogClientConfig: options.clientConfig,
    })

    Object.assign(nuxt.options.runtimeConfig, {
      posthogServerConfig: options.serverConfig,
    })

    if (!options.sourcemaps?.enabled || nuxt.options.dev) {
      return
    }

    const sourcemapsConfig = options.sourcemaps
    let publicDir: string | undefined
    let serverDir: string | undefined

    nuxt.hook('nitro:init', (nitro) => {
      publicDir = nitro.options.output?.publicDir
      serverDir = nitro.options.output?.serverDir
    })

    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.rollupConfig = {
        ...(nitroConfig.rollupConfig || {}),
        output: {
          ...(nitroConfig.rollupConfig?.output || {}),
          sourcemapExcludeSources: false, // Make sure to set it (otherwise server sourcemaps will not be generated)
        },
      }
    })

    nuxt.hook('build:before', () => {
      nuxt.options.sourcemap = {
        client: 'hidden',
        server: 'hidden',
      }
    })

    let isBuildProcess = false
    let publicSourcemapsUploaded = false

    const posthogCliRunner = () => {
      const cliBinaryPath =
        options.cliBinaryPath ||
        resolveBinaryPath('posthog-cli', {
          path: process.env.PATH ?? '',
          cwd: resolvedDirname,
        })
      const logLevel = sourcemapsConfig.logLevel || 'info'
      const projectId = sourcemapsConfig.projectId ?? sourcemapsConfig.envId
      const cliEnv = {
        ...process.env,
        RUST_LOG: `posthog_cli=${logLevel}`,
        POSTHOG_CLI_HOST: normalizedHost,
        POSTHOG_CLI_PROJECT_ID: projectId,
        POSTHOG_CLI_API_KEY: normalizePersonalApiKey(sourcemapsConfig.personalApiKey),
      }
      return (args: string[]) => {
        return spawnLocal(cliBinaryPath, args, {
          env: cliEnv,
          cwd: process.cwd(),
          stdio: 'inherit',
        })
      }
    }

    const cliRunner = posthogCliRunner()

    nuxt.hook('nitro:build:public-assets', async () => {
      isBuildProcess = true
      if (!publicDir) return
      try {
        // Inject public sourcemaps
        // This cannot be done in the close hook. https://github.com/PostHog/posthog/issues/30957#issuecomment-2824545454
        await cliRunner(getInjectArgs(publicDir, sourcemapsConfig))
        if (sourcemapsConfig.deleteAfterUpload ?? true) {
          // Delete public sourcemaps before Nitro generates its asset manifest.
          await cliRunner(getUploadArgs(publicDir, sourcemapsConfig))
          publicSourcemapsUploaded = true
        }
      } catch (error) {
        console.error('Failed to process public sourcemaps:', error)
      }
    })

    nuxt.hook('close', async () => {
      // We don't want to run this process during prepare and friends
      if (!isBuildProcess || !serverDir || !publicDir) return
      try {
        // Nitro reports a serverDir for every build but only writes one when it builds a
        // server bundle. `ssr: false` still builds one, so read the directory on disk
        // instead of `nuxt.options.ssr` (#3005). Only injected directories are uploaded:
        // the CLI fails an upload of chunks that carry no chunk id.
        if (existsSync(serverDir)) {
          await cliRunner(getInjectArgs(serverDir, sourcemapsConfig))
          await cliRunner(getUploadArgs(serverDir, sourcemapsConfig))
        }
        // Keep the public sourcemaps on disk here: Nitro's asset manifest already lists them.
        if (!publicSourcemapsUploaded) {
          await cliRunner(getUploadArgs(publicDir, { ...sourcemapsConfig, deleteAfterUpload: false }))
        }
      } catch (error) {
        console.error('Failed to process or upload sourcemaps:', error)
      }
    })
  },
})

function getReleaseArgs(sourcemapsConfig: SourcemapsConfig) {
  const processOptions: string[] = []

  const releaseName = sourcemapsConfig.releaseName ?? sourcemapsConfig.project
  if (releaseName) {
    processOptions.push('--release-name', releaseName)
  }

  const releaseVersion = sourcemapsConfig.releaseVersion ?? sourcemapsConfig.version
  if (releaseVersion) {
    processOptions.push('--release-version', releaseVersion)
  }

  if (sourcemapsConfig.build !== undefined && sourcemapsConfig.build !== '') {
    processOptions.push('--build', String(sourcemapsConfig.build))
  }

  return processOptions
}

function getInjectArgs(directory: string, sourcemapsConfig: SourcemapsConfig) {
  return [
    'sourcemap',
    'inject',
    '--ignore',
    '**/node_modules/**',
    '--directory',
    directory,
    ...getReleaseArgs(sourcemapsConfig),
  ]
}

function getUploadArgs(directory: string, sourcemapsConfig: SourcemapsConfig) {
  // Without the release flags the CLI derives a release from the checkout directory, so each
  // upload creates a second release next to the configured one.
  const processOptions: string[] = [
    'sourcemap',
    'upload',
    '--ignore',
    '**/node_modules/**',
    '--directory',
    directory,
    ...getReleaseArgs(sourcemapsConfig),
  ]

  if (sourcemapsConfig.deleteAfterUpload ?? true) {
    processOptions.push('--delete-after')
  }

  if (sourcemapsConfig.batchSize) {
    processOptions.push('--batch-size', sourcemapsConfig.batchSize.toString())
  }

  return processOptions
}
