import path from 'path'
import fs from 'fs'

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
