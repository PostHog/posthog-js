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
let isTestCafe = false
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
if (!globalThis.fixture) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    globalThis.fixture = () => testCafeMock
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    globalThis.test = () => testCafeMock
} else {
    isTestCafe = true
}
import * as asserts from './e2e.spec'
import { getResultsJsonFiles } from './helpers'

async function main() {
    // each test will put a results.json file in this folder, so let's list all the files in this folder
    const files = getResultsJsonFiles()
    if (files.length !== 3) {
        throw new Error(`Expected 3 results files, got ${JSON.stringify(files)}`)
    }

    // the deadline is the same for each assert, as the ingestion lag will be happening in parallel
    const deadline = Date.now() + 1000 * 60 * 20 // 20 minutes

    for (const file of files) {
        const testSessionId = file.testSessionId
        const assertFunction = asserts[file.assert as keyof typeof asserts]
        if (!testSessionId || !assertFunction) {
            throw new Error(`Invalid results file: ${file}`)
        }
        await assertFunction(testSessionId, deadline)
    }
}

if (!isTestCafe) {
    main().catch((error) => {
        // eslint-disable-next-line no-console
        console.error(error)
        process.exit(1)
    })
}
