import * as fs from 'node:fs'
// The testcafe tests hit the production posthog instance, and we want to assert that the events are received.
// The problem with this is that ingestion lag can cause these events to take a while to show up. Instead of waiting
// for 10 minutes per test, instead we run the entire suite without asserting on the events, and then run this script.

// Mock testcafe so that we can import the asserts from the test file without running the tests
const testCafeMock = {
    test: () => testCafeMock,
    page: () => testCafeMock,
    fixture: () => testCafeMock,
    requestHooks: () => testCafeMock,
    afterEach: () => testCafeMock,
}
// @ts-expect-error globalThis property
globalThis.fixture = () => testCafeMock
// @ts-expect-error globalThis property
globalThis.test = () => testCafeMock
import * as asserts from './e2e.spec'

async function main() {
    // each test will put a results.json file in this folder, so let's list all the files in this folder
    const files = fs.readdirSync(__dirname).filter((file) => file.endsWith('.results.json'))
    if (files.length !== 3) {
        throw new Error(`Expected 3 results files, got ${JSON.stringify(files)}`)
    }

    // the deadline is the same for each assert, as the ingestion lag will be happening in parallel
    const deadline = Date.now() + 1000 * 60 * 20 // 20 minutes

    for (const file of files) {
        const results = JSON.parse(fs.readFileSync(file).toString())
        const testSessionId = results.testSessionId
        const assertFunction = asserts[results.assert as keyof typeof asserts]
        if (!testSessionId || !assertFunction) {
            throw new Error(`Invalid results file: ${JSON.stringify(results)}`)
        }
        await assertFunction(testSessionId, deadline)
    }
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error)
    process.exit(1)
})
