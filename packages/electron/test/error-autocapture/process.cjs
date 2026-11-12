const assert = require('node:assert/strict')
const enabled = process.env.FIXTURE_ENABLED === 'true'
const scenario = process.argv[2]
const before = {
    uncaught: process.rawListeners('uncaughtException'),
    rejection: process.rawListeners('unhandledRejection'),
    exit: process.exit,
}
if (enabled) {
    const { startProcessExceptionAutocapture } = require('./process-observer.cjs')
    startProcessExceptionAutocapture(
        () => true,
        async (_error, properties, hint) => {
            console.log(JSON.stringify({ capture: properties.$exception_source, mechanism: hint.mechanism }))
        }
    )
}
assert.deepEqual(process.rawListeners('uncaughtException'), before.uncaught)
assert.deepEqual(process.rawListeners('unhandledRejection'), before.rejection)
assert.equal(process.exit, before.exit)
if (scenario === 'throw') {
    setTimeout(() => {
        throw new Error('actual fatal throw')
    }, 0)
} else if (scenario === 'host-once') {
    const host = () => console.log('host handled first rejection')
    process.once('unhandledRejection', host)
    assert.equal(process.rawListeners('unhandledRejection')[0].listener, host)
    void Promise.reject(new Error('host-owned rejection'))
    setTimeout(() => {
        void Promise.reject(new Error('fatal rejection after host removal'))
    }, 20)
} else {
    void Promise.reject(new Error('actual unhandled rejection'))
}
