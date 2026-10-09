// Bound a local command and its descendants. The compliance caller runs on POSIX hosts.
import { spawn } from 'node:child_process'

const [milliseconds, command, ...args] = process.argv.slice(2)
const duration = Number(milliseconds)
if (!command || !Number.isSafeInteger(duration) || duration <= 0) throw new Error('Positive command deadline required')
const child = spawn(command, args, { stdio: 'inherit', detached: true })
let failureCode
function terminate() {
    if (!child.pid) return
    try {
        process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
        if (error.code !== 'ESRCH') throw error
    }
}
const timer = setTimeout(() => {
    failureCode = 124
    process.stderr.write(`Command deadline exceeded after ${duration}ms: ${command}\n`)
    terminate()
}, duration)
for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
])
    process.once(signal, () => {
        failureCode = code
        terminate()
    })
child.once('error', (error) => {
    clearTimeout(timer)
    process.stderr.write(`Command could not start: ${error.message}\n`)
    process.exitCode = 1
})
child.once('exit', (code) => {
    clearTimeout(timer)
    process.exitCode = failureCode ?? code ?? 1
})
