import test from 'node:test'
import assert from 'node:assert/strict'
import {
    exceptionCases,
    assertExceptionDelivery,
    toolbarState,
    assertToolbarHandoff,
    assertConversationDelivery,
    expectedPageErrors,
    expectedRejections,
    withoutDeliberateErrors,
} from './extension-cases.mjs'

const fixtureFrame = { filename: 'http://fixture.test/errors.js', function: 'compatUncaught' }
const exceptions = () => ({
    events: exceptionCases.map(({ trigger, type, value }) => ({
        event: '$exception',
        properties: {
            $exception_list: [{ type, value, stacktrace: { frames: [fixtureFrame] } }],
            ...(trigger === 'manual' ? { compat_source: 'manual' } : {}),
        },
    })),
})

test('exception proof requires every trigger once, in order, with its type, value, fixture frame and properties', () => {
    assertExceptionDelivery(exceptions())
    assert.throws(() => assertExceptionDelivery({ events: [] }), /Missing or duplicate/)
    const missing = exceptions()
    missing.events.pop()
    assert.throws(() => assertExceptionDelivery(missing), /Missing or duplicate/)
    const duplicate = exceptions()
    duplicate.events.push(duplicate.events[0])
    assert.throws(() => assertExceptionDelivery(duplicate), /Missing or duplicate/)
    const reordered = exceptions()
    reordered.events.reverse()
    assert.throws(() => assertExceptionDelivery(reordered), /exception type/)
    const wrongType = exceptions()
    wrongType.events[0].properties.$exception_list[0].type = 'Error'
    assert.throws(() => assertExceptionDelivery(wrongType), /uncaught exception type/)
    const wrongValue = exceptions()
    wrongValue.events[1].properties.$exception_list[0].value = 'other'
    assert.throws(() => assertExceptionDelivery(wrongValue), /rejection exception value/)
    const emptyList = exceptions()
    emptyList.events[2].properties.$exception_list = []
    assert.throws(() => assertExceptionDelivery(emptyList), /consoleError exception type/)
    const sdkFrame = exceptions()
    sdkFrame.events[3].properties.$exception_list[0].stacktrace.frames = [{ filename: 'http://fixture.test/array.js' }]
    assert.throws(() => assertExceptionDelivery(sdkFrame), /fixture stack frame for manual/)
    const noSource = exceptions()
    delete noSource.events.at(-1).properties.compat_source
    assert.throws(() => assertExceptionDelivery(noSource), /manual exception properties/)
})

const toolbar = () => ({
    handoff: { calls: 1, sameInstance: true, params: { ...toolbarState } },
    hash: '',
    state: undefined,
})
const toolbarNetwork = (count = 1) => ({
    requests: [{ path: '/static/array.js' }, ...Array.from({ length: count }, () => ({ path: '/static/toolbar.js' }))],
})

test('toolbar proof requires one handoff to the same instance with its credentials, a cleared hash and one script', () => {
    assertToolbarHandoff(toolbar(), toolbarNetwork())
    for (const [mutate, message] of [
        [(t) => (t.handoff.calls = 2), /more than once/],
        [(t) => (t.handoff.sameInstance = false), /different SDK instance/],
        [(t) => delete t.handoff.params.token, /project token/],
        [(t) => (t.handoff.params.temporaryToken = 'other'), /credential/],
        [(t) => (t.hash = '#__posthog=state'), /remained in the URL/],
    ]) {
        const bad = toolbar()
        mutate(bad)
        assert.throws(() => assertToolbarHandoff(bad, toolbarNetwork()), message)
    }
    for (const count of [0, 2])
        assert.throws(() => assertToolbarHandoff(toolbar(), toolbarNetwork(count)), /toolbar script request/)
})

const conversationUi = () => ({
    opened: 'Compat greeting',
    conversation: 'Compat greeting\nCompat question\nCompat agent\nCompat reply',
})
const sendRequest = (body = {}) => ({
    method: 'POST',
    path: '/api/conversations/v1/widget/message',
    body: { message: 'Compat question', ticket_id: null, ...body },
})
const conversationNetwork = (sends = [sendRequest()]) => ({
    requests: [{ method: 'GET', path: '/api/conversations/v1/widget/tickets' }, ...sends],
})

test('conversation proof requires one new-ticket message and one rendered question and reply', () => {
    assertConversationDelivery(conversationUi(), conversationNetwork())
    for (const sends of [[], [sendRequest(), sendRequest()]])
        assert.throws(
            () => assertConversationDelivery(conversationUi(), conversationNetwork(sends)),
            /Missing or duplicate conversation message/
        )
    assert.throws(
        () => assertConversationDelivery(conversationUi(), conversationNetwork([sendRequest({ message: 'other' })])),
        /Incorrect conversation message/
    )
    assert.throws(
        () =>
            assertConversationDelivery(
                conversationUi(),
                conversationNetwork([sendRequest({ ticket_id: 'compat-ticket' })])
            ),
        /new ticket/
    )
    // A widget that omits its token is rejected by the mock backend, so the reply never renders.
    assert.throws(
        () =>
            assertConversationDelivery(
                { ...conversationUi(), conversation: 'Compat greeting\nCompat question' },
                conversationNetwork()
            ),
        /reply was not rendered/
    )
    assert.throws(
        () =>
            assertConversationDelivery(
                { ...conversationUi(), conversation: `${conversationUi().conversation}\nCompat question` },
                conversationNetwork()
            ),
        /rendered more than once/
    )
})

const errors = (...messages) => messages.map((message) => ({ name: 'Error', message }))

test('deliberate fixture errors are expected once per engine, and other scenarios expect none', () => {
    assert.deepEqual(expectedPageErrors('exceptions', 'chromium'), ['compat-uncaught'])
    assert.deepEqual(expectedPageErrors('exceptions', 'webkit'), ['compat-uncaught'])
    assert.deepEqual(expectedPageErrors('exceptions', 'firefox'), ['compat-uncaught', 'compat-rejection'])
    assert.deepEqual(expectedRejections('exceptions'), ['compat-rejection'])
    for (const engine of ['chromium', 'firefox', 'webkit']) assert.deepEqual(expectedPageErrors('core', engine), [])
    assert.deepEqual(expectedRejections('core'), [])
})

test('deliberate errors must occur exactly once while other errors remain unexpected', () => {
    const firefox = expectedPageErrors('exceptions', 'firefox')
    assert.deepEqual(withoutDeliberateErrors(errors('compat-uncaught', 'compat-rejection'), firefox, 'page errors'), [])
    assert.deepEqual(withoutDeliberateErrors(errors('compat-rejection', 'compat-uncaught'), firefox, 'page errors'), [])
    assert.deepEqual(
        withoutDeliberateErrors(errors('compat-uncaught', 'compat-rejection', 'sdk-error'), firefox, 'page errors'),
        errors('sdk-error')
    )
    assert.deepEqual(withoutDeliberateErrors(errors('sdk-error'), [], 'page errors'), errors('sdk-error'))
    for (const observed of [
        errors(),
        errors('compat-uncaught'),
        errors('compat-uncaught', 'compat-uncaught', 'compat-rejection'),
        errors('compat-uncaught', 'compat-rejection', 'compat-rejection'),
    ])
        assert.throws(
            () => withoutDeliberateErrors(observed, firefox, 'page errors'),
            /Missing or duplicate deliberate page errors/
        )
    const rejections = expectedRejections('exceptions')
    for (const observed of [errors(), errors('compat-rejection', 'compat-rejection')])
        assert.throws(
            () => withoutDeliberateErrors(observed, rejections, 'rejections'),
            /Missing or duplicate deliberate rejections/
        )
    // The SDK cancels the rejection event, so Chromium and WebKit don't report it as a page error;
    // one there is unexpected.
    assert.deepEqual(
        withoutDeliberateErrors(
            errors('compat-uncaught', 'compat-rejection'),
            expectedPageErrors('exceptions', 'chromium'),
            'page errors'
        ),
        errors('compat-rejection')
    )
})
