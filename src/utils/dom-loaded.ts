import { _each, _register_event } from '.'
import { document, window } from './globals'

let DOM_LOADED: number | undefined = undefined
const callbacks: (() => void)[] = []

const addHandler = function () {
    DOM_LOADED = 0
    // Cross browser DOM Loaded support
    function dom_loaded_handler() {
        // function flag since we only want to execute this once
        if (DOM_LOADED) {
            return
        }
        ;(dom_loaded_handler as any).done = true

        DOM_LOADED = 1

        _each(callbacks, (cb) => cb())
    }

    if (document?.addEventListener) {
        if (document.readyState === 'complete') {
            // safari 4 can fire the DOMContentLoaded event before loading all
            // external JS (including this file). you will see some copypasta
            // on the internet that checks for 'complete' and 'loaded', but
            // 'loaded' is an IE thing
            dom_loaded_handler()
        } else {
            document.addEventListener('DOMContentLoaded', dom_loaded_handler, false)
        }
    }

    // fallback handler, always will work
    if (window) {
        _register_event(window, 'load', dom_loaded_handler, true)
    }
}

export function onDomLoaded(cb: () => void) {
    if (DOM_LOADED === 1) {
        return cb()
    }

    callbacks.push(cb)

    if (DOM_LOADED !== 0) {
        addHandler()
    }
}
