// This script checks the events produced by running the testcafe tests and asserts that the events have shown up in
// our production US cloud posthog. The actual assert functions live alongside the tests themselves, which save the test
// information to a file. This script reads those files, and then runs relevant assert functions.

// This happens after the testcafe tests have all finished, so that we are not waiting on ingestion lag per test, only
// once when all tests have finished.

import {
    assertConfigOptionsChangeAutocaptureBehaviourAccordingly,
    assertAutocapturedEventsWorkAndAreAccessibleViaApi,
    assertCustomEventsWorkAndAreAccessibleViaApi,
} from './checks'
// end of hackiness

import { getResultsJsonFiles, log, error, POSTHOG_API_PROJECT } from './helpers'
const asserts = {
    assertConfigOptionsChangeAutocaptureBehaviourAccordingly,
    assertAutocapturedEventsWorkAndAreAccessibleViaApi,
    assertCustomEventsWorkAndAreAccessibleViaApi,
}

async function main() {
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
    const maxDurationSeconds = 60 * 30 // 30 minutes

    for (const file of files) {
        const testSessionId = file.testSessionId
        const assertFunction = asserts[file.assert]
        log(`Asserting ${file.assert} for test session ${testSessionId}`, assertFunction, file)
        if (!testSessionId || !assertFunction) {
            throw new Error(`Invalid results file: ${file}`)
        }
        await assertFunction(testSessionId, maxDurationSeconds)
    }
}

main().catch((e) => {
    error(e)
    process.exit(1)
})
