import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir, getNuxtVersion } from '@nuxt/kit'
import type { Nitro, NitroConfig } from 'nitropack/types'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import type {} from 'nuxt/app'
import { resolveBinaryPath, spawnLocal } from '@posthog/plugin-utils'
import { fileURLToPath } from 'node:url'
import { dirname, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'

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
  /**
   * Fail the build when PostHog cannot process or upload the sourcemaps, for example because the
   * personal API key is invalid. Defaults to `true`; set it to `false` to log the error and continue the build.
   */
  failOnError?: boolean
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

export type PostHogServerConfig = PostHogOptions & { requestContext?: boolean }
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
    const deleteAfterUpload = sourcemapsConfig.deleteAfterUpload ?? true
    let publicDir: string | undefined
    let serverDir: string | undefined

    nuxt.hook('nitro:init', (nitro: Nitro) => {
      publicDir = nitro.options.output?.publicDir
      serverDir = nitro.options.output?.serverDir
    })

    nuxt.hook('nitro:config', (nitroConfig: NitroConfig) => {
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
    let publicSourcemapsError: unknown
    let sourcemapsError: unknown

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
        // Upload here in both deletion modes: this hook runs before Nitro writes the server
        // bundle, so a preset that nests the server directory inside the public one
        // (`cloudflare-pages`) never sends the server chunks through this upload as well.
        // With `deleteAfterUpload` the upload also has to run before Nitro generates its
        // asset manifest.
        await cliRunner(getUploadArgs(publicDir, sourcemapsConfig))
        publicSourcemapsUploaded = true
      } catch (error) {
        publicSourcemapsError = error
        console.error('Failed to process public sourcemaps:', error)
        // Nitro lists the maps in its public-asset manifest after this hook, so they cannot be
        // deleted later without breaking the server (#4275). Delete them now so they don't ship.
        if (deleteAfterUpload) await deleteSourcemaps(publicDir)
      }
    })

    nuxt.hook('close', async () => {
      // We don't want to run this process during prepare and friends
      if (!isBuildProcess || !serverDir || !publicDir) return
      // Each directory is handled on its own: a failing server command must not skip the
      // public upload retry, which runs when the early upload failed and the maps were kept.
      let serverSourcemapsError: unknown
      try {
        // Nitro reports a serverDir for every build but only writes one when it builds a
        // server bundle. `ssr: false` still builds one, so read the directory on disk
        // instead of `nuxt.options.ssr` (#3005). Only injected directories are uploaded:
        // the CLI fails an upload of chunks that carry no chunk id.
        if (existsSync(serverDir)) {
          await cliRunner(getInjectArgs(serverDir, sourcemapsConfig))
          await cliRunner(getUploadArgs(serverDir, sourcemapsConfig))
        }
      } catch (error) {
        serverSourcemapsError = error
        console.error(`Failed to process or upload server sourcemaps (${serverDir}):`, error)
      }
      if (!publicSourcemapsUploaded && !deleteAfterUpload) {
        try {
          await cliRunner(getUploadArgs(publicDir, sourcemapsConfig))
          publicSourcemapsError = undefined
        } catch (error) {
          console.error(`Failed to upload public sourcemaps (${publicDir}):`, error)
        }
      }
      sourcemapsError = serverSourcemapsError ?? publicSourcemapsError
    })

    if (sourcemapsConfig.failOnError ?? true) {
      // A throwing close hook skips the close hooks after it, such as the one that disposes Nitro's
      // storage, so the build fails once every close hook has run.
      nuxt.hooks.afterEach((event: { name: string }) => {
        if (event.name !== 'close' || !sourcemapsError) return
        const error = sourcemapsError
        sourcemapsError = undefined
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `PostHog sourcemap processing failed (set sourcemaps.failOnError to false to continue the build): ${message}`,
          {
            cause: error,
          }
        )
      })
    }
  },
})

async function deleteSourcemaps(directory: string) {
  try {
    const files = await readdir(directory, { recursive: true })
    const fileSet = new Set(files)
    // Like the CLI's `--delete-after` fallback, only delete maps named after a sibling file.
    const sourcemaps = files.filter(
      (file) => file.endsWith('.map') && fileSet.has(file.slice(0, -4)) && !file.split(sep).includes('node_modules')
    )
    const results = await Promise.allSettled(sourcemaps.map((file) => rm(`${directory}${sep}${file}`, { force: true })))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to delete sourcemap (${sourcemaps[index]}):`, result.reason)
      }
    })
    console.warn(
      `Deleted ${results.filter((result) => result.status === 'fulfilled').length} public sourcemaps because the sourcemap upload failed and deleteAfterUpload is enabled.`
    )
  } catch (error) {
    console.error(`Failed to delete sourcemaps (${directory}):`, error)
  }
}

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
