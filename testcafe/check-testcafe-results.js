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
// eslint-disable-next-line no-undef
if (!globalThis.fixture) {
    // eslint-disable-next-line no-undef
    globalThis.fixture = () => testCafeMock
    // eslint-disable-next-line no-undef
    globalThis.test = () => testCafeMock
} else {
    isTestCafe = true
}
import {
    assertConfigOptionsChangeAutocaptureBehaviourAccordingly,
    assertAutocapturedEventsWorkAndAreAccessibleViaApi,
    assertCustomEventsWorkAndAreAccessibleViaApi,
} from './e2e.spec'
import { getResultsJsonFiles, log, error, POSTHOG_API_PROJECT } from './helpers'
const asserts = {
    assertConfigOptionsChangeAutocaptureBehaviourAccordingly,
    assertAutocapturedEventsWorkAndAreAccessibleViaApi,
    assertCustomEventsWorkAndAreAccessibleViaApi,
}
async function main() {
    // eslint-disable-next-line no-console
    log(`
Waiting for events from tests to appear in PostHog.
You can manually confirm whether the events have shown up at https://us.posthog.com/project/${POSTHOG_API_PROJECT}/activity/explore
If they seem to be failing unexpectedly, check grafana for ingestion lag at https://grafana.prod-us.posthog.dev/d/homepage/homepage
`)
    // each test will put a results.json file in this folder, so let's list all the files in this folder
    const files = getResultsJsonFiles()

    if (files.length !== 3) {
        throw new Error(`Expected 3 results files, got ${JSON.stringify(files)}`)
    }
    log(JSON.stringify(files, null, 2))

    // the deadline is the same for each assert, as the ingestion lag will be happening in parallel
    const deadline = Date.now() + 1000 * 60 * 30 // 30 minutes

    for (const file of files) {
        const testSessionId = file.testSessionId
        const assertFunction = asserts[file.assert]
        log(`Asserting ${file.assert} for test session ${testSessionId}`, assertFunction, file)
        if (!testSessionId || !assertFunction) {
            throw new Error(`Invalid results file: ${file}`)
        }
        await assertFunction(testSessionId, deadline)
    }
}

if (!isTestCafe) {
    main().catch((e) => {
        error(e)
        // eslint-disable-next-line no-undef
        process.exit(1)
    })
}
