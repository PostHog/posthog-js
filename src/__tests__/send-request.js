import { encodePostData } from '../send-request'

describe('encodePostData()', () => {
    given('subject', () => encodePostData(given.data, given.options))

    given('data', () => ({ data: 'content' }))
    given('options', () => ({ method: 'POST' }))

    it('handles objects', () => {
        expect(given.subject).toMatchSnapshot()
    })

    it('handles arrays', () => {
        given('data', () => ['foo', 'bar'])

        expect(given.subject).toMatchSnapshot()
    })

    it('handles data with compression', () => {
        given('data', () => ({ data: 'content', compression: 'lz64' }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles GET requests', () => {
        given('options', () => ({ method: 'GET' }))

        expect(given.subject).toEqual(null)
    })

    it('handles plainJSON', () => {
        given('options', () => ({ method: 'POST', plainJSON: true }))

        expect(given.subject).toMatchSnapshot()
    })
})
