// oxlint-disable compat/compat -- Node-only watcher lifecycle fixture
// A real Vite watcher with graceful close, allowing the parent to detect leaked handles.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../../../tooling/rrweb-build/package.json', import.meta.url))
const { build } = await import(pathToFileURL(require.resolve('vite')).href)
const watcher = await build({
    configFile: process.argv[2],
    build: { watch: {}, emptyOutDir: false },
})
watcher.on('event', (event) => {
    if (event.code === 'START') process.send('building')
    if (event.code === 'END') process.send('built')
})
process.on('message', async (message) => {
    if (message === 'close') {
        await watcher.close()
        process.disconnect()
    }
})
