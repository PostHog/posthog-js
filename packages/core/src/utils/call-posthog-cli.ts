import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

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

export const buildLocalBinaryPaths = (cwd: string): string[] => {
  const localPaths = getLocalPaths(path.resolve(cwd)).map((localPath: string) =>
    path.join(localPath, 'node_modules/.bin')
  )
  return localPaths
}

export function resolveBinaryPath(envPath: string, cwd: string, binName: string): string {
  const envLocations = envPath.split(path.delimiter)
  const localLocations = buildLocalBinaryPaths(cwd)
  const directories = [...new Set([...localLocations, ...envLocations])]
  for (const directory of directories) {
    const binaryPath = path.join(directory, binName)
    if (fs.existsSync(binaryPath)) {
      return binaryPath
    }
  }
  throw new Error(`Binary ${binName} not found`)
}

export async function callPosthogCli(args: string[], env: NodeJS.ProcessEnv, verbose: boolean): Promise<void> {
  let binaryLocation
  try {
    binaryLocation = resolveBinaryPath(process.env.PATH ?? '', __dirname, 'posthog-cli')
  } catch (e) {
    console.error(e)
    throw new Error(`Binary posthog-cli not found. Make sure postinstall script has been allowed for @posthog/cli`)
  }

  if (verbose) {
    console.log('running posthog-cli from ', binaryLocation)
  }

  const child = spawn(binaryLocation, [...args], {
    shell: true,
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
