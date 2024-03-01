import { PostHog } from '../posthog-core'
import { _register_event } from '../utils'
import { document, window } from '../utils/globals'
import { logger } from '../utils/logger'
import { _isFunction } from '../utils/type-utils'
import { makeSafeText } from '../autocapture-utils'

const ARROW = 'Arrow'
const LEFT = 'Left'
const RIGHT = 'Right'
const DOWN = 'Down'
const UP = 'Up'
const ARROW_LEFT = ARROW + LEFT
const ARROW_UP = ARROW + UP
const ARROW_RIGHT = ARROW + RIGHT
const ARROW_DOWN = ARROW + DOWN
const PAGE = 'Page'
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
    'a', // select all
    'A', // select all
]

const MOUSE_UP = 'mouseup'
const KEY_UP = 'keyup'

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

    const captureSelection = debounce((selectionType: string, selection: string): void => {
        posthog.capture('$selection-autocapture', {
            $selection_type: selectionType,
            $selection: selection,
        })
    }, 150)

    const handler = (event: Event) => {
        let selectionType = 'unknown'
        if (event.type === KEY_UP) {
            selectionType = 'keyboard'
            // only react to a navigation key that could have changed the selection
            // e.g. don't react when someone releases ctrl or shift
            const keyEvent = event as KeyboardEvent
            if (navigationKeys.indexOf(keyEvent.key) === -1) {
                return
            }
        } else if (event.type === MOUSE_UP) {
            selectionType = 'mouse'
        }
        const selection = window?.getSelection()
        const selectedContent = makeSafeText(selection?.toString())
        if (selectedContent) {
            captureSelection(selectionType, selectedContent)
        }
    }

    _register_event(document, MOUSE_UP, handler, false, true)
    _register_event(document, KEY_UP, handler, false, true)
}
