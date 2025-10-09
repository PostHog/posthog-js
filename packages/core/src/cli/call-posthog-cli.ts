import { spawn } from 'child_process'
import { resolveBinaryPath } from './utils'

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
