import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize, differences } from './normalize.mjs'
import { assertReplayLifecycleProof } from './replay-cases.mjs'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const context = { origin: 'http://fixture.test', version: '1.0.0' }
const stream = (sessionId) => ({
    properties: {
        $session_id: sessionId,
        $snapshot_data: [
            { type: 4, data: {} },
            { type: 2, data: { text: 'Original' } },
        ],
    },
})
const baseline = () => ({ events: [], snapshots: [stream(first)] })

test('replay idle, bounce and minimum-duration proofs reject lost lifecycle evidence', () => {
    const network = baseline()
    network.snapshots[0].properties.$snapshot_data.push(
        { type: 5, data: { tag: 'sessionIdle' } },
        { type: 5, data: { tag: 'sessionNoLongerIdle' } }
    )
    const idle = { idleMutationSuppressed: true, sessionUnchanged: true, rebuiltText: 'Changed while idle' }
    assertReplayLifecycleProof('replay-idle', network, idle)
    for (const key of Object.keys(idle))
        assert.throws(() => assertReplayLifecycleProof('replay-idle', network, { ...idle, [key]: false }))
    const bounce = { beforeUnloadSnapshots: 0, navigated: true }
    assertReplayLifecycleProof('replay-bounce', network, bounce)
    assert.throws(() => assertReplayLifecycleProof('replay-bounce', network, { ...bounce, beforeUnloadSnapshots: 1 }))
    assert.throws(() => assertReplayLifecycleProof('replay-bounce', network, { ...bounce, navigated: false }))
    const minimum = { belowMinimumSnapshots: 0, rebuiltText: 'Qualified visit' }
    assertReplayLifecycleProof('replay-minimum-duration', network, minimum)
    assert.throws(() =>
        assertReplayLifecycleProof('replay-minimum-duration', network, { ...minimum, belowMinimumSnapshots: 1 })
    )
    network.snapshots[0].properties.$snapshot_data[1].data.text = 'Qualified visit'
    assert.throws(
        () => assertReplayLifecycleProof('replay-minimum-duration', network, minimum),
        /initial full snapshot/
    )
})

test('replay rotation proof requires distinct analytics sessions with metadata and full snapshots', () => {
    const network = baseline()
    network.snapshots.push(stream(second))
    network.events.push(
        { event: 'compat-replay-before-rotation', properties: { $session_id: first } },
        { event: 'compat-replay-after-rotation', properties: { $session_id: second } }
    )
    const replay = { rebuiltText: 'New session' }
    assertReplayLifecycleProof('replay-rotation', network, replay)
    const same = structuredClone(network)
    same.events[1].properties.$session_id = first
    assert.throws(() => assertReplayLifecycleProof('replay-rotation', same, replay), /did not rotate/)
    network.snapshots[1].properties.$snapshot_data.reverse()
    assert.throws(() => assertReplayLifecycleProof('replay-rotation', network, replay), /metadata/)
})

test('replay proofs reject missing full snapshots and leaked private content', () => {
    const network = baseline(),
        replay = { beforeUnloadSnapshots: 0, navigated: true }
    network.snapshots[0].properties.$snapshot_data[1].data.text = 'secret-password'
    assert.throws(() => assertReplayLifecycleProof('replay-bounce', network, replay), /leaked/)
    network.snapshots[0].properties.$snapshot_data.pop()
    assert.throws(() => assertReplayLifecycleProof('replay-bounce', network, replay), /full snapshot/)
})

test('SDK replay markers and historical flush diagnostics retain session identity without normalizing app data', () => {
    const sample = (id, bytes) => ({
        network: {
            events: [
                {
                    event: 'fixture',
                    properties: {
                        $session_id: id,
                        $sess_rec_flush_size: { sessionId: id, size: bytes },
                        $sdk_debug_replay_flushed_size: bytes,
                    },
                },
            ],
            snapshots: [
                {
                    properties: {
                        $session_id: id,
                        $snapshot_data: [
                            {
                                type: 5,
                                data: {
                                    tag: 'sessionNoLongerIdle',
                                    payload: { sessionId: id, flushed_size: bytes, application: { sessionId: first } },
                                },
                            },
                        ],
                    },
                },
            ],
        },
    })
    const before = sample(first, 200),
        after = sample(second, 201)
    assert.deepEqual(normalize(before, context), normalize(after, context))
    const properties = normalize(before, context).network.events[0].properties
    assert.equal(properties.$session_id, properties.$sess_rec_flush_size.sessionId)
    after.network.snapshots[0].properties.$snapshot_data[0].data.payload.application.sessionId = second
    assert(differences(normalize(before, context), normalize(after, context)).length > 0)
    const unknown = sample(second, 201)
    unknown.network.snapshots[0].properties.$snapshot_data[0].data.tag = 'application-marker'
    assert.equal(
        normalize(unknown, context).network.snapshots[0].properties.$snapshot_data[0].data.payload.sessionId,
        second
    )
})
