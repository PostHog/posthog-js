export function getSDKScriptURL(url: HTMLAnchorElement): string {
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    url.pathname = directory + 'array.js'
    url.search = ''
    url.hash = ''
    return url.href
}
