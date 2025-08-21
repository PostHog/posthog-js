import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import nextPackage from 'next/package.json' with { type: 'json' }
import semver from 'semver'
import { PostHogNextConfigComplete } from './config'

export function resolveBinaryPath(envPath: string, cwd: string, binName: string): string {
  const envLocations = envPath.split(path.delimiter)
  const localLocations = buildLocalBinaryPaths(cwd)
  const directories = [...new Set([...envLocations, ...localLocations])]
  for (const directory of directories) {
    const binaryPath = path.join(directory, binName)
    if (fs.existsSync(binaryPath)) {
      return binaryPath
    }
  }
  throw new Error(`Binary ${binName} not found`)
}

export const buildLocalBinaryPaths = (cwd: string): string[] => {
  const localPaths = getLocalPaths(path.resolve(cwd)).map((localPath: string) =>
    path.join(localPath, 'node_modules/.bin')
  )
  return localPaths
}

const getLocalPaths = (startPath: string): string[] => {
  const paths: string[] = []
  let currentPath = startPath

  while (true) {
    paths.push(currentPath)
    const parentPath = path.resolve(currentPath, '..')

    // If we've reached the root directory, stop
    if (parentPath === currentPath) {
      break
    }

    currentPath = parentPath
  }

  return paths
}

export function getNextJsVersion(): string {
  return nextPackage.version
}

export function hasCompilerHook(): boolean {
  const nextJsVersion = getNextJsVersion()
  return semver.gte(nextJsVersion, '15.4.1')
}

export async function processSourceMaps(posthogOptions: PostHogNextConfigComplete, directory: string) {
  const cliOptions = []
  if (posthogOptions.host) {
    cliOptions.push('--host', posthogOptions.host)
  }
  cliOptions.push('sourcemap', 'process')
  cliOptions.push('--directory', directory)
  if (posthogOptions.sourcemaps.project) {
    cliOptions.push('--project', posthogOptions.sourcemaps.project)
  }
  if (posthogOptions.sourcemaps.version) {
    cliOptions.push('--version', posthogOptions.sourcemaps.version)
  }
  if (posthogOptions.sourcemaps.deleteAfterUpload) {
    cliOptions.push('--delete-after')
  }
  // Add env variables
  const envVars = {
    ...process.env,
    POSTHOG_CLI_TOKEN: posthogOptions.personalApiKey,
    POSTHOG_CLI_ENV_ID: posthogOptions.envId,
  }
  await callPosthogCli(cliOptions, envVars, posthogOptions.verbose)
}

async function callPosthogCli(args: string[], env: NodeJS.ProcessEnv, verbose: boolean): Promise<void> {
  let binaryLocation
  try {
    binaryLocation = resolveBinaryPath(process.env.PATH ?? '', __dirname, 'posthog-cli')
  } catch (e) {
    throw new Error(`Binary ${e} not found. Make sure postinstall script has been allowed for @posthog/cli`)
  }

  if (verbose) {
    console.log('running posthog-cli from ', binaryLocation)
  }

  const child = spawn(binaryLocation, [...args], {
    stdio: verbose ? 'inherit' : 'ignore',
    env,
    cwd: process.cwd(),
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

// Helper to detect if Turbopack is enabled
export function isTurbopackEnabled(): boolean {
  // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
  return process.env.TURBOPACK === '1'
}
