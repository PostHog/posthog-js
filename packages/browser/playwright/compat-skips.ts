import { satisfies } from 'compare-versions'

/**
 * Tests to skip for specific NPM versions during backward compatibility testing.
 *
 * When a compat test fails because a NEW feature isn't available in older versions
 * (not a breaking change), add it here to skip the test for those versions.
 *
 * IMPORTANT: Only skip tests for NEW features. If an EXISTING feature breaks,
 * that's a real bug that needs fixing, not skipping.
 *
 * Format: Map of version ranges to test patterns with required reasons
 *
 * Example:
 *   '<1.335.0': [
 *     {
 *       test: 'web_vitals_attribution: true includes attribution data',
 *       reason: 'web_vitals_attribution option added in #2953',
 *     },
 *   ]
 */
export const compatSkips: { range: string; test: string; reason: string }[] = [
    {
        range: '<1.335.0',
        test: 'web_vitals_attribution: true includes attribution data',
        reason: 'web_vitals_attribution option added in #2953',
    },
]

export function shouldSkipForVersion(testTitle: string, npmVersion: string | undefined): string | null {
    if (!npmVersion) {
        return null
    }

    for (const skip of compatSkips) {
        if (new RegExp(skip.test).test(testTitle) && satisfies(npmVersion, skip.range)) {
            return `Skipped for ${skip.range}: ${skip.reason}`
        }
    }

    return null
}
