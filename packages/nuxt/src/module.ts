import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import type {} from 'nuxt/app'
import { resolveBinaryPath, spawnLocal } from '@posthog/core/process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const filename = fileURLToPath(import.meta.url)
const resolvedDirname = dirname(filename)

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
    addPlugin(resolver.resolve('./runtime/vue-plugin'))
    addServerPlugin(resolver.resolve('./runtime/nitro-plugin'))
    addImportsDir(resolver.resolve('./runtime/composables'))

    Object.assign(nuxt.options.runtimeConfig.public, {
      posthog: {
        publicKey: options.publicKey,
        host: options.host,
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
    let outputDir: string | undefined
    let publicDir: string | undefined
    let serverDir: string | undefined

    nuxt.hook('nitro:init', (nitro) => {
      publicDir = nitro.options.output?.publicDir
      serverDir = nitro.options.output?.serverDir
      outputDir = nitro.options.output?.dir
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
        POSTHOG_CLI_HOST: options.host,
        POSTHOG_CLI_PROJECT_ID: projectId,
        POSTHOG_CLI_API_KEY: sourcemapsConfig.personalApiKey,
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
      } catch (error) {
        console.error('Failed to process public sourcemaps:', error)
      }
    })

    nuxt.hook('close', async () => {
      // We don't want to run this process during prepare and friends
      if (!isBuildProcess || !serverDir || !outputDir) return
      try {
        // Inject server sourcemaps
        await cliRunner(getInjectArgs(serverDir, sourcemapsConfig))
        // Upload all assets
        await cliRunner(getUploadArgs(outputDir, sourcemapsConfig))
      } catch (error) {
        console.error('Failed to process server sourcemaps:', error)
      }
    })
  },
})

function getInjectArgs(directory: string, sourcemapsConfig: SourcemapsConfig) {
  const processOptions: string[] = ['sourcemap', 'inject', '--ignore', '**/node_modules/**', '--directory', directory]

  const releaseName = sourcemapsConfig.releaseName ?? sourcemapsConfig.project
  if (releaseName) {
    processOptions.push('--release-name', releaseName)
  }

  const releaseVersion = sourcemapsConfig.releaseVersion ?? sourcemapsConfig.version
  if (releaseVersion) {
    processOptions.push('--release-version', releaseVersion)
  }

  return processOptions
}

function getUploadArgs(directory: string, sourcemapsConfig: SourcemapsConfig) {
  const processOptions: string[] = ['sourcemap', 'upload', '--ignore', '**/node_modules/**', '--directory', directory]

  if (sourcemapsConfig.deleteAfterUpload ?? true) {
    processOptions.push('--delete-after')
  }

  if (sourcemapsConfig.batchSize) {
    processOptions.push('--batch-size', sourcemapsConfig.batchSize.toString())
  }

  return processOptions
}
