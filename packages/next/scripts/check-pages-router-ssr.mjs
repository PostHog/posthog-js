import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useFeatureFlag } from '@posthog/next'
import { PostHogProvider } from '@posthog/next/pages'

const flagKey = 'node-esm-pages-ssr'
let flagResult

function FlagResult() {
    flagResult = useFeatureFlag(flagKey)
    return React.createElement('span', null, JSON.stringify(flagResult))
}

renderToStaticMarkup(
    React.createElement(
        PostHogProvider,
        {
            apiKey: 'phc_test',
            bootstrap: {
                distinctID: 'ssr-user',
                isIdentifiedID: false,
                featureFlags: { [flagKey]: 'variant-a' },
                featureFlagPayloads: {},
            },
        },
        React.createElement(FlagResult)
    )
)

assert.equal(flagResult?.enabled, true)
assert.equal(flagResult?.variant, 'variant-a')
