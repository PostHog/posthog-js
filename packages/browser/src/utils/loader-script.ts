import { version } from '../../package.json'

export function getVersionedScriptURL(url: HTMLAnchorElement): string {
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    const versionedDirectory = /\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/$/.test(directory)
        ? directory
        : directory.replace(/\/static\/\d+\/$/, '/static/') + version + '/'
    url.pathname = versionedDirectory + 'array.js'
    url.search = ''
    url.hash = ''
    return url.href
}
