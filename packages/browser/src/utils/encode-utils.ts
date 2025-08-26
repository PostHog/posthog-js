import { isNull } from '@posthog/core'

export function _base64Encode(data: null): null
export function _base64Encode(data: undefined): undefined
export function _base64Encode(data: string): string
export function _base64Encode(data: string | null | undefined): string | null | undefined {
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
    let o1,
        o2,
        o3,
        h1,
        h2,
        h3,
        h4,
        bits,
        i = 0,
        ac = 0,
        enc = ''
    const tmp_arr: string[] = []

    if (!data) {
        return data
    }

    data = utf8Encode(data)

    do {
        // pack three octets into four hexets
        o1 = data.charCodeAt(i++)
        o2 = data.charCodeAt(i++)
        o3 = data.charCodeAt(i++)

        bits = (o1 << 16) | (o2 << 8) | o3

        h1 = (bits >> 18) & 0x3f
        h2 = (bits >> 12) & 0x3f
        h3 = (bits >> 6) & 0x3f
        h4 = bits & 0x3f

        // use hexets to index into b64, and append result to encoded string
        tmp_arr[ac++] = b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4)
    } while (i < data.length)

    enc = tmp_arr.join('')

    switch (data.length % 3) {
        case 1:
            enc = enc.slice(0, -2) + '=='
            break
        case 2:
            enc = enc.slice(0, -1) + '='
            break
    }

    return enc
}

export const utf8Encode = function (string: string): string {
    string = (string + '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    let utftext = '',
        start,
        end
    let stringl = 0,
        n

    start = end = 0
    stringl = string.length

    for (n = 0; n < stringl; n++) {
        const c1 = string.charCodeAt(n)
        let enc = null

        if (c1 < 128) {
            end++
        } else if (c1 > 127 && c1 < 2048) {
            enc = String.fromCharCode((c1 >> 6) | 192, (c1 & 63) | 128)
        } else {
            enc = String.fromCharCode((c1 >> 12) | 224, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128)
        }
        if (!isNull(enc)) {
            if (end > start) {
                utftext += string.substring(start, end)
            }
            utftext += enc
            start = end = n + 1
        }
    }

    if (end > start) {
        utftext += string.substring(start, string.length)
    }

    return utftext
}
