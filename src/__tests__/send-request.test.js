import { formEncodePostData } from '../send-request'

describe('formEncodePostData()', () => {
    given('subject', () => formEncodePostData(given.data))

    it('handles arrays', () => {
        given('data', () => ['foo', 'bar'])

        expect(given.subject).toMatchSnapshot()
    })

    it('handles objects', () => {
        given('data', () => ({ data: 'content' }))

        expect(given.subject).toMatchSnapshot()
    })

    it('handles data with compression', () => {
        given('data', () => ({ data: 'content', compression: 'lz64' }))

        expect(given.subject).toMatchSnapshot()
    })
})
