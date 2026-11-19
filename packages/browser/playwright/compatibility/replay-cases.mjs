import assert from 'node:assert/strict'
import { decodeReplay } from './normalize.mjs'
import { settleReplayCompression } from './replay-compression.mjs'

export const replayLifecycleScenarios = [
    'replay-idle',
    'replay-rotation',
    'replay-bounce',
    'replay-minimum-duration',
    'replay-event-trigger',
    'replay-url-trigger',
    'replay-linked-flag',
]
// The linked flag is evaluated with a nonmatching variant first, then switched to the linked one.
export const replayLinkedFlag = { flag: 'compat-replay-variant', before: 'red', variant: 'blue' }
// Start conditions the lazy recorder evaluates from the core's persisted remote config.
export const replayTriggerConfig = {
    'replay-event-trigger': { sampleRate: '0', eventTriggers: ['compat-replay-trigger'], triggerMatchType: 'any' },
    'replay-url-trigger': {
        urlTriggers: [{ url: 'compat-url-trigger', matching: 'regex' }],
        urlBlocklist: [{ url: 'compat-url-blocked', matching: 'regex' }],
    },
    'replay-linked-flag': { linkedFlag: { flag: replayLinkedFlag.flag, variant: replayLinkedFlag.variant } },
}
export const replayMinimumDurationMs = 5000
const idleThresholdMs = 5 * 60 * 1000
const sessionTimeoutMs = 30 * 60 * 1000
const eventsFor = (network, sessionId) =>
    decodeReplay(network.snapshots)
        .filter((snapshot) => sessionId === undefined || snapshot.properties.$session_id === sessionId)
        .flatMap((snapshot) => snapshot.properties.$snapshot_data ?? [])

export function assertReplayLifecycleProof(scenario, network, replay) {
    const events = eventsFor(network)
    assert(
        events.some((event) => event.type === 2),
        'Replay lifecycle did not deliver a full snapshot'
    )
    const serialized = JSON.stringify(events)
    for (const secret of ['secret-password', 'private-compat-text'])
        assert(!serialized.includes(secret), `Replay lifecycle leaked ${secret}`)
    if (scenario === 'replay-idle') {
        assert.equal(replay.idleMutationSuppressed, true, 'DOM mutation was delivered during recording idle')
        assert.equal(replay.sessionUnchanged, true, 'Recording idle incorrectly rotated the analytics session')
        const tags = events.map((event) => event.data?.tag)
        assert(tags.includes('sessionIdle'), 'Missing recording-idle marker')
        assert(tags.indexOf('sessionNoLongerIdle') > tags.indexOf('sessionIdle'), 'Missing wake marker after idle')
        assert.equal(replay.rebuiltText, 'Changed while idle', 'Wake replay did not reconstruct the current DOM')
    }
    if (scenario === 'replay-rotation') {
        const before = network.events.find((event) => event.event === 'compat-replay-before-rotation')
        const after = network.events.find((event) => event.event === 'compat-replay-after-rotation')
        assert(before && after, 'Missing rotation analytics markers')
        assert.notEqual(before.properties.$session_id, after.properties.$session_id, 'Session did not rotate')
        for (const marker of [before, after]) {
            const stream = eventsFor(network, marker.properties.$session_id).filter((event) => event.type !== 6)
            assert.equal(stream[0]?.type, 4, 'Session replay did not begin with metadata')
            assert.equal(stream[1]?.type, 2, 'Session replay did not begin with a full snapshot')
        }
        assert.equal(replay.rebuiltText, 'New session', 'Rotated replay did not reconstruct the new session')
    }
    if (scenario === 'replay-bounce') {
        assert.equal(replay.beforeUnloadSnapshots, 0, 'Passive visit uploaded replay before clean unload')
        assert.equal(replay.navigated, true, 'Bounce did not use real navigation')
    }
    if (replayTriggerConfig[scenario]) {
        assert.equal(replay.beforeTriggerSnapshots, 0, 'Replay uploaded before its trigger matched')
        assert(serialized.includes('After trigger'), 'Replay lost activity after its trigger matched')
    }
    if (scenario === 'replay-url-trigger') {
        assert.equal(replay.blockedMutationSuppressed, true, 'Replay uploaded activity on a blocked URL')
        assert(!serialized.includes('On blocked URL'), 'Replay delivered activity from a blocked URL after resuming')
        assert(serialized.includes('After blocked URL'), 'Replay did not resume after leaving a blocked URL')
    }
    if (scenario === 'replay-linked-flag') {
        assert.equal(replay.variantBeforeTrigger, replayLinkedFlag.before, 'Replay flag did not start unmatched')
        assert.equal(replay.variantAfterTrigger, replayLinkedFlag.variant, 'Replay flag did not switch to its variant')
    }
    if (scenario === 'replay-minimum-duration') {
        assert.equal(replay.belowMinimumSnapshots, 0, 'Replay uploaded below the configured minimum duration')
        assert.equal(replay.rebuiltText, 'Qualified visit', 'Minimum-duration replay lost its content')
        assert(
            events.some((event) => event.type === 2 && JSON.stringify(event.data).includes('Original')),
            'Minimum-duration replay lost its initial full snapshot'
        )
    }
}

async function rebuild({ page, network, sessionId, expect, origin, text }) {
    const events = eventsFor(network, sessionId)
    const player = await page.context().newPage()
    try {
        await player.goto(origin + '/player')
        await player.evaluate((events) => {
            const root = document.createElement('div')
            document.body.appendChild(root)
            window.__player = new window.__CompatReplayer(events, { root, showWarning: false, showDebug: false })
            window.__player.pause(events.at(-1).timestamp - events[0].timestamp)
        }, events)
        const reconstructedText = () =>
            player.evaluate(
                () =>
                    document.querySelector('.replayer-wrapper iframe')?.contentDocument?.querySelector('#change')
                        ?.textContent
            )
        await expect.poll(reconstructedText).toBe(text)
        return await reconstructedText()
    } finally {
        await player.close()
    }
}

export async function exerciseReplayLifecycle({ scenario, page, server, received, expect, origin }) {
    const marker = (phase) =>
        page.evaluate((phase) => {
            window.__compat.phase = phase
            window.__compat.call('capture', [`compat-replay-${phase}`])
            return window.__compat.call('get_session_id')
        }, phase)
    const pending = new Set()
    const started = (request) => pending.add(request)
    const finished = (request) => pending.delete(request)
    page.on('request', started)
    page.on('requestfinished', finished)
    page.on('requestfailed', finished)
    // Native HTTP and gzip run outside the mocked clock. Finish compression
    // before a flush can inspect the buffer, and drain HTTP before its timeout.
    const advance = async (duration, fast = false) => {
        await settleReplayCompression(page, expect)
        while (duration > 0) {
            const step = Math.min(duration, 1000)
            if (fast) await page.clock.fastForward(step)
            else await page.clock.runFor(step)
            await expect.poll(() => pending.size).toBe(0)
            await settleReplayCompression(page, expect)
            duration -= step
        }
    }
    const interact = async () => {
        assert.equal(
            await page.evaluate(() => document.elementFromPoint(20, 30)?.id),
            'action',
            'Replay interaction point missed the action button'
        )
        await page.mouse.click(20, 30)
        await advance(100)
    }
    const mutate = async (text) => {
        await page.evaluate((text) => {
            document.querySelector('#change').textContent = text
        }, text)
        await advance(100)
    }
    const waitForSnapshots = (sessionId) =>
        expect.poll(async () => eventsFor(await received(), sessionId).some((event) => event.type === 2)).toBe(true)
    let api
    const replay = {}
    await advance(100)
    await page.waitForLoadState('networkidle')
    if (scenario === 'replay-bounce') {
        await advance(3000)
        replay.beforeUnloadSnapshots = (await received()).snapshots.length
        assert.equal(replay.beforeUnloadSnapshots, 0, 'Passive visit uploaded replay before clean unload')
        await marker('before-bounce')
        api = await page.evaluate(() => window.__compat.finish())
        await page.goto(origin + '/after')
        replay.navigated = new URL(page.url()).pathname === '/after'
        await waitForSnapshots()
    } else if (replayTriggerConfig[scenario]) {
        const status = () => page.evaluate(() => window.__compat.ph.sessionRecording?.status)
        const navigate = (query) => page.evaluate((query) => history.pushState(history.state, '', `/?${query}`), query)
        const snapshotText = async () => JSON.stringify(eventsFor(await received()))
        // The recorder treats sessions without user input as idle, so pair each change with a click.
        const activity = async (text) => {
            await mutate(text)
            await interact()
        }
        await activity('Before trigger')
        await advance(3000)
        replay.statusBeforeTrigger = await status()
        replay.beforeTriggerSnapshots = (await received()).snapshots.length
        assert.equal(replay.beforeTriggerSnapshots, 0, 'Replay uploaded before its trigger matched')
        if (scenario === 'replay-event-trigger') await marker('trigger')
        else if (scenario === 'replay-url-trigger') await navigate('compat-url-trigger')
        else {
            const replayFlag = () =>
                page.evaluate(
                    (flag) => window.__compat.ph.getFeatureFlag(flag, { send_event: false }),
                    replayLinkedFlag.flag
                )
            replay.variantBeforeTrigger = await replayFlag()
            server.updateState({ flags: { [replayLinkedFlag.flag]: replayLinkedFlag.variant } })
            await page.evaluate(() => window.__compat.call('reloadFeatureFlags'))
            await advance(100)
            await expect.poll(replayFlag).toBe(replayLinkedFlag.variant)
            replay.variantAfterTrigger = await replayFlag()
        }
        await activity('After trigger')
        await advance(3000)
        replay.statusAfterStart = await status()
        await waitForSnapshots()
        if (scenario === 'replay-url-trigger') {
            await navigate('compat-url-blocked')
            await activity('On blocked URL')
            await advance(3000)
            replay.statusWhileBlocked = await status()
            replay.blockedMutationSuppressed = !(await snapshotText()).includes('On blocked URL')
            // Resuming takes a full snapshot of the live DOM, so remove the blocked-only text first.
            // The destination matches neither the trigger nor the blocklist.
            await mutate('Leaving blocked URL')
            await navigate('compat-url-resumed')
            await activity('After blocked URL')
            await advance(3000)
            replay.statusAfterBlocked = await status()
            await expect.poll(async () => (await snapshotText()).includes('After blocked URL')).toBe(true)
        }
        await page.evaluate(() => window.__compat.call('stopSessionRecording'))
    } else if (scenario === 'replay-minimum-duration') {
        await interact()
        await advance(2000)
        replay.belowMinimumSnapshots = (await received()).snapshots.length
        assert.equal(replay.belowMinimumSnapshots, 0, 'Replay uploaded below the configured minimum duration')
        await advance(replayMinimumDurationMs)
        await mutate('Qualified visit')
        await interact()
        await advance(3000)
        await waitForSnapshots()
        await expect
            .poll(async () => JSON.stringify(eventsFor(await received())).includes('Qualified visit'))
            .toBe(true)
        replay.rebuiltText = await rebuild({ page, network: await received(), expect, origin, text: 'Qualified visit' })
    } else {
        const before = await marker('before-rotation')
        await interact()
        await advance(3000)
        await waitForSnapshots(before)
        if (scenario === 'replay-idle') {
            await advance(idleThresholdMs + 1, true)
            await mutate('Changed while idle')
            await advance(3000)
            replay.idleMutationSuppressed = !JSON.stringify(eventsFor(await received())).includes('Changed while idle')
            assert.equal(replay.idleMutationSuppressed, true, 'DOM mutation was delivered during recording idle')
            await interact()
            const after = await marker('after-idle')
            replay.sessionUnchanged = before === after
            await advance(3000)
            await expect
                .poll(async () =>
                    eventsFor(await received()).some(
                        (event) => event.type === 2 && JSON.stringify(event.data).includes('Changed while idle')
                    )
                )
                .toBe(true)
            replay.rebuiltText = await rebuild({
                page,
                network: await received(),
                expect,
                origin,
                text: 'Changed while idle',
            })
        } else {
            await advance(sessionTimeoutMs + 1, true)
            const after = await marker('after-rotation')
            assert.notEqual(before, after, 'Session did not rotate after inactivity')
            await mutate('New session')
            await interact()
            await advance(3000)
            await waitForSnapshots(after)
            await expect
                .poll(async () => JSON.stringify(eventsFor(await received(), after)).includes('New session'))
                .toBe(true)
            replay.rebuiltText = await rebuild({
                page,
                network: await received(),
                sessionId: after,
                expect,
                origin,
                text: 'New session',
            })
        }
        await page.evaluate(() => window.__compat.call('stopSessionRecording'))
    }
    page.off('request', started)
    page.off('requestfinished', finished)
    page.off('requestfailed', finished)
    assertReplayLifecycleProof(scenario, await received(), replay)
    return { replay, api }
}
