import { initPosthog } from './helpers'

// eslint-disable-next-line no-undef
fixture`Subdomain detection`

const testCases = [
    {
        location: 'www.google.co.uk',
        expected: '.google.co.uk',
    },
    {
        location: 'www.google.com',
        expected: '.google.com',
    },
    {
        location: 'www.google.com.au',
        expected: '.google.com.au',
    },
    {
        location: 'localhost',
        expected: 'localhost',
    },
]

testCases.forEach(({ location, expected }) => {
    test(`location ${location} is detected as having subdomain ${expected}`, async (t) => {
        const { seekFirstNonPublicSubDomainFn } = await initPosthog()
        await t.expect(seekFirstNonPublicSubDomainFn(location)).eql(expected)
    })
})
