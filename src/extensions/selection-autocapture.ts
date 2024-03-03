import { PostHog } from '../posthog-core'
import { _register_event } from '../utils'
import { document, window } from '../utils/globals'
import { logger } from '../utils/logger'
import { _isFunction, _isObject } from '../utils/type-utils'
import { makeSafeText } from '../autocapture-utils'

const LEFT = 'Left'
const RIGHT = 'Right'
const UP = 'Up'
const DOWN = 'Down'
const ARROW = 'Arrow'
const PAGE = 'Page'
const ARROW_LEFT = ARROW + LEFT
const ARROW_RIGHT = ARROW + RIGHT
const ARROW_UP = ARROW + UP
const ARROW_DOWN = ARROW + DOWN
const PAGE_UP = PAGE + UP
const PAGE_DOWN = PAGE + DOWN

const navigationKeys = [
    ARROW_UP,
    ARROW_DOWN,
    ARROW_LEFT,
    ARROW_RIGHT,
    PAGE_UP,
    PAGE_DOWN,
    'Home',
    'End',
    LEFT,
    RIGHT,
    UP,
    DOWN,
]

const MOUSE = 'mouse'
const MOUSE_UP = MOUSE + UP.toLowerCase()
const KEY = 'key'
const KEY_UP = KEY + UP.toLowerCase()

const debounce = (fn: any, ms = 50) => {
    if (!_isFunction(fn)) {
        return fn
    }

    let timeoutId: ReturnType<typeof setTimeout>
    return function (this: any, ...args: any[]) {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => fn.apply(this, args), ms)
    }
}

export const initSelectionAutocapture = (posthog: PostHog) => {
    if (!document || !window) {
        logger.info('document not available, selection autocapture not initialized')
        return
    }

    const debouncedCapture = debounce(
        (
            phEvent: '$selection-autocapture' | '$clipboard-autocapture',
            selection: string,
            selectionType?: string | undefined
        ): void => {
            posthog.capture(phEvent, {
                $selection_type: selectionType,
                $selection: selection,
            })
        },
        150
    )

    const selectedTextHandler = (event: Event) => {
        let selectionType = 'unknown'
        if (event.type === KEY_UP) {
            selectionType = KEY
            // only react to a navigation key that could have changed the selection
            // e.g. don't react when someone releases ctrl or shift
            const keyEvent = event as KeyboardEvent
            const isNavigationKey = navigationKeys.indexOf(keyEvent.key) >= 0
            const isSelectAll = keyEvent.key.toLowerCase() === 'a' && (keyEvent.ctrlKey || keyEvent.metaKey)
            if (!isNavigationKey && !isSelectAll) {
                return
            }
        } else if (event.type === MOUSE_UP) {
            selectionType = MOUSE
        }
        const selection = window?.getSelection()
        const selectedContent = makeSafeText(selection?.toString())
        if (selectedContent) {
            debouncedCapture('$selection-autocapture', selectedContent, selectionType)
        }
    }

    const copiedTextHandler = (event: Event) => {
        // you can't read the data from the clipboard event,
        // but you can guess that you can read it from the window's current selection
        const selection = window?.getSelection()
        const selectedContent = makeSafeText(selection?.toString())
        if (selectedContent) {
            debouncedCapture('$copy-autocapture', selectedContent, (event as ClipboardEvent)?.type || 'clipboard')
        }
    }

    if (_isObject(posthog.config.autocapture) && posthog.config.autocapture.capture_selected_text) {
        _register_event(document, MOUSE_UP, selectedTextHandler, false, true)
        _register_event(document, KEY_UP, selectedTextHandler, false, true)
    }

    if (_isObject(posthog.config.autocapture) && posthog.config.autocapture.capture_copied_text) {
        _register_event(document, 'copy', copiedTextHandler, false, true)
        _register_event(document, 'cut', copiedTextHandler, false, true)
    }
}
