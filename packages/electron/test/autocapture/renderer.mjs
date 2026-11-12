import { init } from '../../dist/renderer.mjs'

window.setup = async (options) => {
    window.posthog = await init(options)
    window.repeatInit = () => init(options)
}
window.interact = () => {
    document.querySelector('#safe').click()
    document.querySelector('#plain').dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('#form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
window.privateInteractions = () => {
    for (const id of ['blocked', 'sensitive']) document.querySelector('#' + id).click()
    for (const id of ['password', 'email']) {
        document.querySelector('#' + id).dispatchEvent(new Event('change', { bubbles: true }))
    }
}
