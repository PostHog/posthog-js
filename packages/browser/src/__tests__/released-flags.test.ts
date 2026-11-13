import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runAll, type Shape } from './released-flags-scenarios'

// Flag results, events and stored state pinned to what posthog-js 1.448.0 returned, sent and
// stored, from the v2 response it requests. `released-flags-scenarios.ts` says how the recording
// was made.

type Results = Record<string, Record<string, any>>

const RELEASED_VERSION = '1.448.0'
const recordingOf = (version: string): string => path.resolve(__dirname, `fixtures/released-flags-${version}.json`)
const RECORDING = recordingOf(RELEASED_VERSION)
const recordVersion = process.env.RECORD_RELEASED_FLAGS

const run = async (shape: Shape): Promise<Results> => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
        return await runAll(shape)
    } finally {
        vi.restoreAllMocks()
        vi.useRealTimers()
    }
}

describe.runIf(recordVersion)('recording the released flag results', () => {
    it('writes the recording', async () => {
        const results = await run('v2')
        writeFileSync(
            recordingOf(recordVersion!),
            JSON.stringify({ version: recordVersion, shape: 'v2', results }, null, 2) + '\n'
        )
    })
})

describe.skipIf(recordVersion || !existsSync(RECORDING))('flag results from the v2 response', () => {
    const released: Results = existsSync(RECORDING) ? JSON.parse(readFileSync(RECORDING, 'utf8')).results : {}
    let results: Results

    beforeAll(async () => {
        results = await run('v2')
    })

    it.each(Object.keys(released))(`match ${RELEASED_VERSION}: %s`, (scenario) => {
        expect(results[scenario]).toEqual(released[scenario])
    })
})
