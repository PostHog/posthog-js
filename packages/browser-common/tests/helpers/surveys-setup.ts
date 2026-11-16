import { beforeEach } from 'vitest'
import Config from '../../src/config'

const failOnUnexpectedConsoleOutput = () => {
    for (const method of ['debug', 'error', 'info', 'log', 'warn'] as const) {
        console[method] = (...args) => {
            throw new Error(`Unexpected console.${method}: ${args}`)
        }
    }
}

failOnUnexpectedConsoleOutput()

beforeEach(() => {
    Config.DEBUG = false
    if (typeof window !== 'undefined') {
        delete (window as Window & { POSTHOG_DEBUG?: boolean }).POSTHOG_DEBUG
        localStorage.removeItem('ph_debug')
    }
    failOnUnexpectedConsoleOutput()
})
