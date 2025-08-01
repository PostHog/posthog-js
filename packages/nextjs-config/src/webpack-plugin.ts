import { PostHogNextConfigComplete } from './config'
import path from 'path'
import { callPosthogCli } from './utils'

type NextRuntime = 'edge' | 'nodejs' | undefined

export class SourcemapWebpackPlugin {
  directory: string

  constructor(
    private posthogOptions: PostHogNextConfigComplete,
    private isServer: boolean,
    private nextRuntime: NextRuntime,
    distDir?: string
  ) {
    const resolvedDistDir = path.resolve(distDir ?? '.next')
    if (!this.posthogOptions.personalApiKey) {
      throw new Error(
        `Personal API key not provided. If you are using turbo, make sure to add env variables to your turbo config`
      )
    }
    if (!this.posthogOptions.envId) {
      throw new Error(
        `Environment ID not provided. If you are using turbo, make sure to add env variables to your turbo config`
      )
    }
    this.directory = this.isServer ? path.join(resolvedDistDir, 'server') : path.join(resolvedDistDir, 'static/chunks')
  }

  apply(compiler: any): void {
    if (this.nextRuntime === 'edge') {
      // TODO: edge and nodejs runtime output files in the same location
      // to support edge runtime we need a way to pass a list of files to the cli
      return
    }

    const onDone = async (_: any, callback: any): Promise<void> => {
      callback = callback || (() => {})
      try {
        await this.runInject()
        await this.runUpload()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : error
        return console.error('Error running PostHog sourcemap plugin:', errorMessage)
      }
      return callback()
    }

    if (compiler.hooks) {
      compiler.hooks.done.tapAsync('SourcemapWebpackPlugin', onDone)
    } else {
      compiler.plugin('done', onDone)
    }
  }

  async runInject(): Promise<void> {
    const cliOptions = []
    cliOptions.push('sourcemap', 'inject', '--directory', this.directory)
    await callPosthogCli(cliOptions, process.env, this.posthogOptions.verbose)
  }

  async runUpload(): Promise<void> {
    const cliOptions = []
    if (this.posthogOptions.host) {
      cliOptions.push('--host', this.posthogOptions.host)
    }
    cliOptions.push('sourcemap', 'upload')
    cliOptions.push('--directory', this.directory)
    if (this.posthogOptions.sourcemaps.project) {
      cliOptions.push('--project', this.posthogOptions.sourcemaps.project)
    }
    if (this.posthogOptions.sourcemaps.version) {
      cliOptions.push('--version', this.posthogOptions.sourcemaps.version)
    }
    if (this.posthogOptions.sourcemaps.deleteAfterUpload && !this.isServer) {
      cliOptions.push('--delete-after')
    }
    // Add env variables
    const envVars = {
      ...process.env,
      POSTHOG_CLI_TOKEN: this.posthogOptions.personalApiKey,
      POSTHOG_CLI_ENV_ID: this.posthogOptions.envId,
    }
    await callPosthogCli(cliOptions, envVars, this.posthogOptions.verbose)
  }
}
