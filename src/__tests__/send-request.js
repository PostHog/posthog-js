import { encodePostData } from '../send-request'

describe('encodePostData()', () => {
    given('subject', () => encodePostData(given.data, given.options))

    given('data', () => ({ data: 'content' }))
    given('options', () => ({ method: 'POST' }))

    beforeEach(() => {
        jest.spyOn(global, 'Blob').mockImplementation((...args) => ['Blob', ...args])
    })

    it('handles objects', () => {
        expect(given.subject).toMatchSnapshot()
    })

    it('handles arrays', () => {
        given('data', () => ['foo', 'bar'])

        expect(given.subject).toMatchSnapshot()
    })

    it('handles data with compression', () => {
        given('data', () => ({ data: 'content', compression: 'base64' }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles GET requests', () => {
        given('options', () => ({ method: 'GET' }))

        expect(given.subject).toEqual(null)
    })

    it('handles blob', () => {
        given('options', () => ({ method: 'POST', blob: true }))
        given('data', () => ({ buffer: 'buffer' }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles sendBeacon', () => {
        given('options', () => ({ method: 'POST', sendBeacon: true }))

        expect(given.subject).toMatchSnapshot()
    })
})
