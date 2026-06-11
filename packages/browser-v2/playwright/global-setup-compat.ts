import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const DIST_DIR = path.join(__dirname, '../dist')
const NPM_ARRAY_FILE = path.join(DIST_DIR, 'array.npm-latest.js')
const NPM_ARRAY_FULL_FILE = path.join(DIST_DIR, 'array.full.npm-latest.js')

async function downloadFile(url: string, dest: string): Promise<void> {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
    }
    fs.writeFileSync(dest, await response.text())
}

async function downloadNpmVersion(): Promise<void> {
    const targetVersion = process.env.COMPAT_VERSION || 'latest'

    const registryUrl =
        targetVersion === 'latest'
            ? 'https://registry.npmjs.org/posthog-js/latest'
            : `https://registry.npmjs.org/posthog-js/${targetVersion}`
    const registryResponse = await fetch(registryUrl)
    if (!registryResponse.ok) {
        throw new Error(`Failed to fetch NPM registry: ${registryResponse.status}`)
    }
    const packageInfo = await registryResponse.json()
    const version = packageInfo.version

    // eslint-disable-next-line no-console
    console.log(`Compat tests using posthog-js@${version} from NPM`)

    await Promise.all([
        downloadFile(`https://unpkg.com/posthog-js@${version}/dist/array.js`, NPM_ARRAY_FILE),
        downloadFile(`https://unpkg.com/posthog-js@${version}/dist/array.full.js`, NPM_ARRAY_FULL_FILE),
    ])
}

async function globalSetup(): Promise<void> {
    if (!fs.existsSync(DIST_DIR)) {
        execSync('pnpm build', { stdio: 'inherit', cwd: path.join(__dirname, '..') })
    }

    await downloadNpmVersion()
}

export default globalSetup
