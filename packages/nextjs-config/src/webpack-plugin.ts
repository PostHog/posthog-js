import { PostHogNextConfigComplete } from './config'
import path from 'path'
import { processSourceMaps } from './utils'

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
        this.posthogOptions.verbose && console.log('Processing source maps from webpack plugin...')
        await processSourceMaps(this.posthogOptions, this.directory, this.isServer)
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
}
