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
window.composedPrivateInteractions = () => {
    for (const marker of ['ph-no-capture', 'ph-sensitive']) {
        for (const boundary of ['host', 'slot']) {
            const host = document.createElement('div')
            const shadow = host.attachShadow({ mode: 'open' })
            document.body.append(host)
            const button = document.createElement('button')
            button.textContent = 'ELECTRON_COMPOSED_PRIVATE_CANARY'
            button.setAttribute('data-ph-capture-attribute-private', 'ELECTRON_COMPOSED_PRIVATE_CANARY')
            if (boundary === 'host') {
                host.className = marker
                shadow.append(button)
            } else {
                shadow.innerHTML = `<div class="${marker}"><slot></slot></div>`
                host.append(button)
            }
            button.click()
            host.remove()
        }
    }
}
window.privateInteractions = () => {
    for (const id of ['blocked', 'sensitive']) document.querySelector('#' + id).click()
    for (const id of ['password', 'email']) {
        document.querySelector('#' + id).dispatchEvent(new Event('change', { bubbles: true }))
    }
}
