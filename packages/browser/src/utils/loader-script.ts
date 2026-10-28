import { version } from '../../package.json'

export function getVersionedScriptURL(url: HTMLAnchorElement, filename: 'loader.js' | 'array.js'): string {
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    const versionedDirectory = /\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/$/.test(directory)
        ? directory
        : directory.replace(/\/static\/\d+\/$/, '/static/') + version + '/'
    url.pathname = versionedDirectory + filename
    url.search = ''
    url.hash = ''
    return url.href
}
