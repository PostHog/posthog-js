import type { PostHogNextConfigComplete } from './types'
import * as path from 'path'
import { processSourcemaps } from './sourcemap-processor'

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
      await this.processSourcemaps()
      return callback()
    }

    if (compiler.hooks) {
      compiler.hooks.done.tapAsync('SourcemapWebpackPlugin', onDone)
    } else {
      compiler.plugin('done', onDone)
    }
  }

  async processSourcemaps(): Promise<void> {
    await processSourcemaps(this.directory, this.posthogOptions, this.isServer)
  }
}
