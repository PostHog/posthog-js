import { document } from './globals'

export const getCookieValue = (name: string): string | null | undefined => {
    if (!document) {
        return
    }

    try {
        const nameEQ = name + '='
        const cookies = document.cookie.split(';').filter((cookie) => cookie.length)
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i]!
            while (cookie.charAt(0) == ' ') {
                cookie = cookie.substring(1, cookie.length)
            }
            if (cookie.indexOf(nameEQ) === 0) {
                return decodeURIComponent(cookie.substring(nameEQ.length, cookie.length))
            }
        }
    } catch {}
    return null
}
