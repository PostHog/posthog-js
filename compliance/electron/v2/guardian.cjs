// Fixture process-group leader. While it lives the group id cannot be reused, so killing the whole
// group is unambiguous even after the Electron leader has exited. fds 0-3 pass straight through to
// the fixture; fd 4 is the owner's control pipe. Descendants that leave the group are not covered.
const { spawn } = require('node:child_process')
const { closeSync, createReadStream } = require('node:fs')

const [command, ...args] = process.argv.slice(2)
const killGroup = () => {
    try {
        process.kill(-process.pid, 'SIGKILL')
    } catch {}
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, killGroup)
const control = createReadStream(null, { fd: 4 })
control.on('data', (data) => {
    if (data.toString().includes('stop')) killGroup()
})
// The owner exited or crashed: nothing else will clean up this fixture.
control.on('end', killGroup)
control.on('error', killGroup)
const child = spawn(command, args, { stdio: ['inherit', 'inherit', 'inherit', 'inherit'] })
// The fixture now holds the protocol pipes; release ours so the owner sees EOF when the leader exits.
for (const fd of [0, 3]) {
    try {
        closeSync(fd)
    } catch {}
}
child.on('error', killGroup)
