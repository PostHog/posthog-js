// Each failure starts in its own named click handler. Native clicks have no script caller,
// so stack frames reference only this file in every engine.
const handlers = {
    uncaught: function compatUncaught() {
        throw new TypeError('compat-uncaught')
    },
    rejection: function compatRejection() {
        Promise.reject(new RangeError('compat-rejection'))
    },
    consoleError: function compatConsoleError() {
        console.error(new Error('compat-console')) // eslint-disable-line no-console
    },
    manual: function compatManual() {
        window.__compat.phase = 'exception-manual'
        window.__compat.call('captureException', [new SyntaxError('compat-manual'), { compat_source: 'manual' }])
    },
}
const container = document.createElement('div')
for (const [trigger, handler] of Object.entries(handlers)) {
    const button = document.createElement('button')
    button.id = `compat-error-${trigger}`
    button.textContent = trigger
    button.addEventListener('click', handler) // eslint-disable-line posthog-js/no-add-event-listener
    container.appendChild(button)
}
document.body.appendChild(container)
