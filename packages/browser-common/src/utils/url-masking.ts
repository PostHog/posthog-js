// Pure URL masking helpers, kept free of browser globals so importing them has no side effects.

export const MASKED = '<masked>'

// The list of campaign parameters that could be considered personal data under e.g. GDPR.
// These can be masked in URLs and properties before being sent to posthog.
export const PERSONAL_DATA_CAMPAIGN_PARAMS = [
    'gclid', // google ads
    'gclsrc', // google ads 360
    'dclid', // google display ads
    'gbraid', // google ads, web to app
    'wbraid', // google ads, app to web
    'fbclid', // facebook
    'msclkid', // microsoft
    'twclid', // twitter
    'li_fat_id', // linkedin
    'igshid', // instagram
    'ttclid', // tiktok
    'rdt_cid', // reddit
    'epik', // pinterest
    'qclid', // quora
    'sccid', // snapchat
    'oppref', // openai ads
    'bfcid', // freebuff
    'irclid', // impact
    '_kx', // klaviyo
]

// replace any query params in the url with the provided mask value. Tries to keep the URL as instant as possible,
// including preserving malformed text in most cases
export const maskQueryParams = function <T extends string | undefined>(
    url: T,
    maskedParams: string[] | undefined,
    mask: string
): T extends string ? string : undefined {
    if (!url || !maskedParams || !maskedParams.length) {
        return url as any
    }

    // Split only on the first # and the first ?, so a hash or query containing another # or ?
    // is kept whole instead of being cut off
    const splitHash = url.split(/#(.*)/)
    const withoutHash: string = splitHash[0] || ''
    const hash = splitHash[1]

    const splitQuery: string[] = withoutHash.split(/\?(.*)/)
    const queryString: string = splitQuery[1]!
    const urlWithoutQueryAndHash: string = splitQuery[0]!
    const queryParts = (queryString || '').split('&')

    // use an array of strings rather than an object to preserve ordering and duplicates
    const paramStrings: string[] = []

    for (let i = 0; i < queryParts.length; i++) {
        // Check nested keys too, but mask a listed value through to the next &.
        const pieces = queryParts[i]!.split('?')
        let j = 0
        while (j < pieces.length && !maskedParams.includes(pieces[j]!.split('=')[0]!)) {
            j++
        }
        if (j < pieces.length) {
            paramStrings.push(
                pieces
                    .slice(0, j)
                    .concat(pieces[j]!.split('=')[0] + '=' + mask)
                    .join('?')
            )
        } else {
            paramStrings.push(queryParts[i]!)
        }
    }

    let result = urlWithoutQueryAndHash
    if (queryString != null) {
        result += '?' + paramStrings.join('&')
    }
    if (hash != null) {
        result += '#' + hash
    }

    return result as any
}
