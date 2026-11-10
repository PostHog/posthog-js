export const utf8Bytes = (value: string): number => {
    let bytes = 0
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index)
        if (code < 0x80) {
            bytes++
        } else if (code < 0x800) {
            bytes += 2
        } else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00) {
            bytes += 4
            index++
        } else {
            bytes += 3
        }
    }
    return bytes
}
