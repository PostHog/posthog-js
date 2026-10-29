import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { trackReplayCompression } from './replay-compression.mjs'

function fixture() {
    class Blob {
        constructor(read) {
            this.read = read
        }
        arrayBuffer(...args) {
            return this.read(...args)
        }
    }
    class Response {
        constructor(read) {
            this.read = read
        }
        blob(...args) {
            return this.read(...args)
        }
    }
    const window = {}
    runInNewContext(`(${trackReplayCompression.toString()})()`, { window, Blob, Response })
    return { Blob, Response, pending: window.__compatPendingBlobReads }
}

for (const [type, method] of [
    ['Blob', 'arrayBuffer'],
    ['Response', 'blob'],
]) {
    test(`tracks concurrent ${type}.${method} reads without changing their results`, async () => {
        const { [type]: Reader, pending } = fixture()
        const first = Promise.withResolvers()
        const second = Promise.withResolvers()
        const value = new Uint8Array([1, 2, 3])
        const a = new Reader((argument) => {
            assert.equal(argument, value)
            return first.promise
        })[method](value)
        const b = new Reader(() => second.promise)[method]()
        assert.equal(pending(), 2)
        first.resolve(value)
        assert.equal(await a, value)
        assert.equal(pending(), 1)
        second.resolve(value)
        assert.equal(await b, value)
        assert.equal(pending(), 0)
    })

    test(`preserves rejected and synchronously throwing ${type}.${method} reads`, async () => {
        const { [type]: Reader, pending } = fixture()
        const error = new Error('native read failed')
        await assert.rejects(new Reader(() => Promise.reject(error))[method](), (actual) => actual === error)
        assert.equal(pending(), 0)
        const throwing = new Reader(() => {
            throw error
        })
        assert.throws(
            () => throwing[method](),
            (actual) => actual === error
        )
        assert.equal(pending(), 0)
    })
}
