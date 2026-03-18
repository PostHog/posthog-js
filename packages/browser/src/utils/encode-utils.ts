/**
 * UTF-8 safe base64 encoding.
 * Uses encodeURIComponent to handle Unicode, then converts percent-encoded bytes
 * back to characters that btoa can handle.
 */
export function _base64Encode(data: null): null
export function _base64Encode(data: undefined): undefined
export function _base64Encode(data: string): string
export function _base64Encode(data: string | null | undefined): string | null | undefined {
    if (!data) {
        return data
    }
    return btoa(
        encodeURIComponent(data).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))
    )
}
