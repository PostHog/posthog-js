import { uuidv7 } from '../../uuidv7'
import { createPosthogInstance } from '../helpers/posthog-instance'
import { setAllPersonProfilePropertiesAsPersonPropertiesForFlags } from '../../customizations/setAllPersonProfilePropertiesAsPersonPropertiesForFlags'
import { STORED_PERSON_PROPERTIES_KEY } from '../../constants'

jest.mock('../../utils/globals', () => {
    const orig = jest.requireActual('../../utils/globals')
    const mockURLGetter = jest.fn()
    const mockReferrerGetter = jest.fn()
    return {
        ...orig,
        mockURLGetter,
        mockReferrerGetter,
        userAgent: 'Mozilla/5.0 (Android 4.4; Mobile; rv:41.0) Gecko/41.0 Firefox/41.0',
        navigator: {
            vendor: '',
        },
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
const { mockURLGetter, mockReferrerGetter } = require('../../utils/globals')

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
              "$browser": "Mobile Safari",
              "$browser_version": null,
              "$current_url": "https://example.com?utm_source=foo",
              "$device_type": "Mobile",
              "$os": "Android",
              "$os_version": "4.4.0",
              "$raw_user_agent": "Mozilla/5.0 (Android 4.4; Mobile; rv:41.0) Gecko/41.0 Firefox/41.0",
              "$referrer": "https://referrer.com",
              "$referring_domain": "referrer.com",
              "$screen_height": 0,
              "$screen_width": 0,
              "$viewport_height": 768,
              "$viewport_width": 1024,
              "_kx": null,
              "dclid": null,
              "epik": null,
              "fbclid": null,
              "gad_source": null,
              "gbraid": null,
              "gclid": null,
              "gclsrc": null,
              "igshid": null,
              "irclid": null,
              "li_fat_id": null,
              "mc_cid": null,
              "msclkid": null,
              "qclid": null,
              "rdt_cid": null,
              "sccid": null,
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
