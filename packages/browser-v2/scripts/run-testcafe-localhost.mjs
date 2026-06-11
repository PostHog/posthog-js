/* eslint-disable no-console */
/* eslint-disable no-undef */
import * as child_process from 'child_process'

const currentEnv = process.env
export const {
    POSTHOG_PROJECT_API_KEY,
    POSTHOG_PERSONAL_API_KEY,
    POSTHOG_API_HOST = 'http://localhost:8000',
    POSTHOG_PROJECT_ID = '1',
} = currentEnv

const browser = process.argv[2] || 'chrome'
const args = process.argv.slice(3)

async function main() {
    if (!POSTHOG_PERSONAL_API_KEY) {
        throw new Error(
            'POSTHOG_PERSONAL_API_KEY env variable is required (create a new all access API key at http://localhost:8000/project/1/settings/user-api-keys)'
        )
    }
    if (!POSTHOG_PROJECT_API_KEY) {
        throw new Error(
            'POSTHOG_PROJECT_API_KEY env variable is required (see Project API Key http://localhost:8000/project/1/settings/project)'
        )
    }

    console.log('Running testcafe tests on localhost')
    child_process.execSync(`pnpm testcafe ${browser} ${args.join(' ')}`, {
        env: {
            ...currentEnv,
            POSTHOG_PERSONAL_API_KEY,
            POSTHOG_PROJECT_API_KEY,
            POSTHOG_API_HOST,
            POSTHOG_PROJECT_ID,
        },
        stdio: 'inherit',
    })
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
