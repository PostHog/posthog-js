import path from 'node:path'
import fs from 'node:fs'

const getLocalPaths = (startPath: string): string[] => {
  const paths: string[] = []
  let currentPath = startPath

  while (currentPath !== path.resolve(currentPath, '..')) {
    paths.push(currentPath)
    currentPath = path.resolve(currentPath, '..')
  }
  // Add the root directory
  paths.push(currentPath)

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
