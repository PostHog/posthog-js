import { PostHogNextConfigComplete } from './config'
import { spawn } from 'child_process'
import path from 'path'

type NextRuntime = 'edge' | 'nodejs' | undefined

export class SourcemapWebpackPlugin {
  directory: string

  constructor(
    private posthogOptions: PostHogNextConfigComplete,
    private isServer: boolean,
    private nextRuntime: NextRuntime
  ) {
    this.directory = this.isServer ? `./.next/server` : `./.next/static/chunks`
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

async function callPosthogCli(args: string[], env: NodeJS.ProcessEnv, verbose: boolean): Promise<void> {
  const cwd = path.resolve('.')
  const child = spawn('posthog-cli', [...args], {
    stdio: verbose ? 'inherit' : 'ignore',
    env: addLocalPath(env ?? process.env, cwd),
  })

  await new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with code ${code}`))
      }
    })

    child.on('error', (error) => {
      reject(error)
    })
  })
}

const addLocalPath = ({ Path = '', PATH = Path, ...env }: NodeJS.ProcessEnv, cwd: string): NodeJS.ProcessEnv => {
  const pathParts = PATH.split(path.delimiter)
  const localPaths = getLocalPaths([], path.resolve(cwd))
    .map((localPath: string) => path.join(localPath, 'node_modules/.bin'))
    .filter((localPath: string) => !pathParts.includes(localPath))
  return { ...env, PATH: [...localPaths, PATH].filter(Boolean).join(path.delimiter) }
}

const getLocalPaths = (localPaths: string[], localPath: string): string[] =>
  localPaths.at(-1) === localPath
    ? localPaths
    : getLocalPaths([...localPaths, localPath], path.resolve(localPath, '..'))
