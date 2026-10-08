import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import packageJson from '../package.json'

const versionPath = fileURLToPath(new URL('../src/component/version.ts', import.meta.url))

export default function setupVersion(): () => void {
  const previousContents = existsSync(versionPath) ? readFileSync(versionPath, 'utf8') : undefined
  writeFileSync(versionPath, `export const version = '${packageJson.version}'\n`)

  return () => {
    if (previousContents === undefined) {
      rmSync(versionPath, { force: true })
    } else {
      writeFileSync(versionPath, previousContents)
    }
  }
}
