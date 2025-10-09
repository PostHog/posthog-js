import { spawn } from 'child_process'
import { resolveBinaryPath } from './utils'

export async function callBinary(
  binaryName: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    verbose: boolean
    // We start traversing the file system tree from this directory and we go up until we find the binary
    resolveFrom: string
    cwd: string
  }
): Promise<void> {
  let binaryLocation
  try {
    binaryLocation = resolveBinaryPath(options.env.PATH ?? '', options.resolveFrom, binaryName)
  } catch (e) {
    console.error(e)
    throw new Error(
      `Binary ${binaryName} not found. Make sure postinstall script was allowed if it installs the binary`
    )
  }

  if (options.verbose) {
    console.log(`running ${binaryName} from `, binaryLocation)
  }

  const child = spawn(binaryLocation, [...args], {
    shell: true,
    stdio: options.verbose ? 'inherit' : 'ignore',
    env: options.env,
    cwd: options.cwd,
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
