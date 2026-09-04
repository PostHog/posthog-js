import { execFileSync } from 'node:child_process'

const NPM_LOOKUP_TIMEOUT_MS = 30_000

export async function waitForPackages(
  packages,
  { attempts = 30, execute = execFileSync, log = console.log, retryDelayMs = 30_000, sleep = defaultSleep } = {}
) {
  const pending = new Map(packages)

  for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const [name, version] of pending) {
      let publishedVersion
      try {
        publishedVersion = execute('pnpm', ['view', `${name}@${version}`, 'version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: NPM_LOOKUP_TIMEOUT_MS,
        }).trim()
      } catch {
        // Keep polling while npm propagates the package.
      }

      if (publishedVersion === version) {
        log(`${name}@${version} is available on npm.`)
        pending.delete(name)
      }
    }

    if (pending.size === 0) {
      return
    }
    if (attempt === attempts) {
      throw new Error(`${formatPackages(pending)} did not become available on npm after ${attempts} attempts`)
    }

    log(
      `${formatPackages(pending)} not available on npm yet (attempt ${attempt}/${attempts}). Retrying in ${retryDelayMs / 1000} seconds...`
    )
    await sleep(retryDelayMs)
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function formatPackages(packages) {
  return [...packages].map(([name, version]) => `${name}@${version}`).join(', ')
}
