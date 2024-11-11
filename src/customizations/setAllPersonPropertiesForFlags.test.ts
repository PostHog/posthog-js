import { uuidv7 } from '../uuidv7'
import { createPosthogInstance } from '../__tests__/helpers/posthog-instance'
import { setAllPersonProfilePropertiesAsPersonPropertiesForFlags } from './setAllPersonProfilePropertiesAsPersonPropertiesForFlags'
import { STORED_PERSON_PROPERTIES_KEY } from '../constants'

jest.mock('../utils/globals', () => {
    const orig = jest.requireActual('../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        document: {
            ...orig.document,
            createElement: (...args: any[]) => orig.document.createElement(...args),
            get referrer() {
                return mockReferrerGetter()
            },
            get URL() {
                return mockURLGetter()
            },
        },
        get location() {
            const url = mockURLGetter()
            return {
                href: url,
                toString: () => url,
            }
        },
    }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockURLGetter, mockReferrerGetter } = require('../utils/globals')

describe('setAllPersonPropertiesForFlags', () => {
    beforeEach(() => {
        mockReferrerGetter.mockReturnValue('https://referrer.com')
        mockURLGetter.mockReturnValue('https://example.com?utm_source=foo')
    })

    it('should called setPersonPropertiesForFlags with all saved properties that are used for person properties', async () => {
        // arrange
        const token = uuidv7()
        const posthog = await createPosthogInstance(token)

        // act
        setAllPersonProfilePropertiesAsPersonPropertiesForFlags(posthog)

        // assert
        expect(posthog.persistence?.props[STORED_PERSON_PROPERTIES_KEY]).toMatchInlineSnapshot(`
            Object {
              "$browser": "Safari",
              "$browser_version": null,
              "$current_url": "https://example.com?utm_source=foo",
              "$device_type": "Desktop",
              "$referrer": "https://referrer.com",
              "$referring_domain": "referrer.com",
              "dclid": null,
              "fbclid": null,
              "gad_source": null,
              "gbraid": null,
              "gclid": null,
              "gclsrc": null,
              "igshid": null,
              "li_fat_id": null,
              "mc_cid": null,
              "msclkid": null,
              "rdt_cid": null,
              "ttclid": null,
              "twclid": null,
              "utm_campaign": null,
              "utm_content": null,
              "utm_medium": null,
              "utm_source": "foo",
              "utm_term": null,
              "wbraid": null,
            }
        `)
    })
})
