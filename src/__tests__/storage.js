import { sessionStore } from '../storage'

describe('sessionStore', () => {
    it('stores objects as strings', () => {
        const obj = { bar: 'baz' }
        sessionStore.set('foo', obj)
        expect(sessionStore.get('foo')).toEqual('{"bar":"baz"}')
    })
    it('stores and retrieves an object untouched', () => {
        const obj = { bar: 'baz' }
        sessionStore.set('foo', obj)
        expect(sessionStore.parse('foo')).toEqual(obj)
    })
    it('stores and retrieves a string untouched', () => {
        const str = 'hey hey'
        sessionStore.set('foo', str)
        expect(sessionStore.parse('foo')).toEqual(str)
    })
    it('returns null if the key does not exist', () => {
        expect(sessionStore.parse('baz')).toEqual(null)
    })
    it('remove deletes an item from storage', () => {
        const str = 'hey hey'
        sessionStore.set('foo', str)
        expect(sessionStore.parse('foo')).toEqual(str)
        sessionStore.remove('foo')
        expect(sessionStore.parse('foo')).toEqual(null)
    })
    it('is_supported returns true by default', () => {
        expect(sessionStore.is_supported()).toEqual(true)
    })
})
