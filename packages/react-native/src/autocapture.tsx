import { PostHog } from './posthog-rn'
import { PostHogAutocaptureElement, JsonType } from '@posthog/core'
import { PostHogAutocaptureOptions } from './types'

interface Element {
  elementType?: {
    displayName?: string
    name?: string
  }
  memoizedProps?: Record<string, unknown>
  return?: Element
  // Host fibers carry their DOM node here; used to scope web capture to a provider's subtree.
  stateNode?: unknown
}

const isAnimatedValue = (value: any): boolean => {
  // Check if it's a Reanimated shared value or animated style
  // _isReanimatedSharedValue is the official internal marker for SharedValues
  // Also check for _value property which is present in SharedValues
  return value?._isReanimatedSharedValue === true || (typeof value === 'object' && value !== null && '_value' in value)
}

const flattenStyles = (styles: any): any => {
  const flattened: any = {}

  // Skip if the entire style object is an animated value
  if (isAnimatedValue(styles)) {
    return {}
  }

  if (Array.isArray(styles)) {
    for (const style of styles) {
      Object.assign(flattened, flattenStyles(style))
    }
  } else if (styles && typeof styles === 'object') {
    // Filter out individual animated properties within a regular style object
    // This handles cases like { opacity: animatedValue, backgroundColor: 'red' }
    for (const key in styles) {
      if (!isAnimatedValue(styles[key])) {
        flattened[key] = styles[key]
      }
    }
  }

  return flattened
}

const stringifyStyle = (styles: any): string => {
  const flattened = flattenStyles(styles)

  const str = Object.keys(flattened)
    .map((x) => `${x}:${flattened[x]}`)
    .join(';')

  return str
}

const sanitiseLabel = (label: string): string => {
  return label.replace(/[^a-z0-9]+/gi, '-')
}

export const defaultPostHogLabelProp = 'ph-label'

const captureAttributePrefix = 'data-ph-capture-attribute-'

// react-native-web internals; skipped only where RNW puts them, so a same-named app component is kept.
// Verified against RNW 0.20.0 and 0.21.2: createElement wraps in LocaleProvider only when
// `domProps.dir` is set, so a nested element inside a text ancestor never gets one. Recheck on bump.
const frameworkInternalLabels = ['LocaleProvider']

const reactFiberKeyPattern = /^__react(Fiber|InternalInstance)\$/

// Cycle guard, not a depth policy: real DOM chains null-terminate, a malformed parentNode may not.
const maxFallbackAncestors = 100

// Separate bound for the fiber walk: unrelated to the DOM guard above, so tuning one never
// silently retunes the other.
const maxOwnerAncestors = 100

// Fires per interaction, so warn once: a persistent failure here silently disables autocapture.
let warnedCaptureFailure = false

// react-dom (RN Web) events have no _targetInst; the fiber sits on e.target under a randomised
// __reactFiber$ key. The clicked node may be a non-React node inside a React subtree, so walk up.
const getFallbackTargetInstance = (e: any): Element | undefined => {
  let node = e.target

  for (let depth = 0; node && typeof node === 'object' && depth < maxFallbackAncestors; depth++) {
    const key = Object.getOwnPropertyNames(node).find((name) => reactFiberKeyPattern.test(name))
    if (key) {
      return node[key]
    }
    node = node.parentNode
  }

  return undefined
}

// Returns the owner node this event happened under, or undefined if none owns it. Walks the fiber
// tree, not the DOM: RNW's Modal portals to document.body, so the DOM parent chain leaves the
// subtree but fiber `.return` does not. Kept separate from the element walk in captureFromEvent,
// which stops at maxElementsCaptured and would falsely reject a deep target.
export const findOwningNode = (e: any, owners: { has(node: unknown): boolean }): unknown => {
  let current: Element | undefined = e._targetInst || getFallbackTargetInstance(e)
  for (let depth = 0; current && depth < maxOwnerAncestors; depth++) {
    if (current.stateNode && owners.has(current.stateNode)) {
      return current.stateNode
    }
    current = current.return
  }

  return undefined
}

// Fail-closed bound on the walk; unrelated to maxElementsCaptured, which caps the emitted payload.
export const maxAncestorsTraversed = 1000

// Autocapture must never break the host app: a throw would escape into RN's touch dispatch on
// native, or the DOM click handler on web. Matches the browser SDK, which guards its equivalent
// document-level handler (packages/browser/src/autocapture.ts).
export const autocaptureFromTouchEvent = (
  e: any,
  posthog: PostHog,
  options: PostHogAutocaptureOptions = {},
  eventType: 'touch' | 'click' = 'touch'
): void => {
  try {
    captureFromEvent(e, posthog, options, eventType)
  } catch (error) {
    if (!warnedCaptureFailure) {
      warnedCaptureFailure = true
      console.warn('PostHog autocapture: capturing the interaction threw:', error)
    }
  }
}

const captureFromEvent = (
  e: any,
  posthog: PostHog,
  options: PostHogAutocaptureOptions,
  eventType: 'touch' | 'click'
): void => {
  const {
    noCaptureProp = 'ph-no-capture',
    customLabelProp = defaultPostHogLabelProp,
    maxElementsCaptured = 20,
    ignoreLabels = [],
    propsToCapture = ['style', 'testID', 'accessibilityLabel', customLabelProp, 'children'],
  } = options

  const nativeInst = e._targetInst
  const targetInst: Element | undefined = nativeInst || getFallbackTargetInstance(e)
  if (!targetInst) {
    return
  }
  const elements: PostHogAutocaptureElement[] = []
  const autocaptureProperties: Record<string, JsonType> = {}

  let currentInst: Element | undefined = targetInst
  let ancestorsTraversed = 0

  while (currentInst) {
    const props = currentInst.memoizedProps

    if (ancestorsTraversed++ >= maxAncestorsTraversed) {
      return
    }

    if (props?.[noCaptureProp]) {
      // Immediately ignore events if a no capture is in the chain
      return
    }

    if (elements.length >= maxElementsCaptured) {
      // keep walking so a no capture ancestor above the cap is still seen
      currentInst = currentInst.return
      continue
    }

    const el: PostHogAutocaptureElement = {
      tag_name: '',
    }
    const elAutocaptureProperties: Record<string, JsonType> = {}

    if (props) {
      // Capture data-ph-capture-attribute props as event properties.
      // Element props are only captured from propsToCapture.
      Object.keys(props).forEach((key) => {
        const value = props[key]

        if (key.indexOf(captureAttributePrefix) === 0) {
          const propertyKey = key.slice(captureAttributePrefix.length)
          if (propertyKey && ['string', 'number', 'boolean'].includes(typeof value) && value !== '') {
            elAutocaptureProperties[propertyKey] = value as JsonType
          }
        }

        if (!propsToCapture.includes(key)) {
          return
        }

        if (key === 'style') {
          // Safely handle style prop, especially for animated styles
          try {
            el.attr__style = stringifyStyle(value)
          } catch (error) {
            // Skip style capturing if it fails (e.g., animated styles)
          }
        } else if (['string', 'number', 'boolean'].includes(typeof value)) {
          if (key === 'children') {
            el.$el_text = typeof value === 'string' ? value : JSON.stringify(value)
          } else {
            el[`attr__${key}`] = value as JsonType
          }
        }
      })
    }

    // Try and find a sensible label
    const hasCustomLabel = typeof props?.[customLabelProp] !== 'undefined'
    const label = hasCustomLabel
      ? `${props?.[customLabelProp]}`
      : currentInst.elementType?.displayName || currentInst.elementType?.name

    Object.assign(autocaptureProperties, elAutocaptureProperties)

    // RNW wraps the touched host node directly, so its internals only ever head the chain; a match
    // further up is the app's own component. A user-set label is never a framework internal.
    const isFrameworkWrapper =
      !nativeInst && !hasCustomLabel && elements.length === 0 && frameworkInternalLabels.includes(label as string)

    if (label && !isFrameworkWrapper && !ignoreLabels.includes(label)) {
      el.tag_name = sanitiseLabel(label)
      elements.push(el)
    }

    currentInst = currentInst.return
  }

  if (elements.length) {
    // The element that was tapped, may be a child (or grandchild of an element with a customLabelProp (default: ph-label))
    // In this case, the current labels applied obscure the customLabelProp (default: ph-label)
    // To correct this, loop over the elements in reverse, and promote the customLabelProp (default: ph-label)
    const elAttrLabelKey = `attr__${customLabelProp}`
    let lastLabel: string | undefined = undefined

    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i]
      if (element[elAttrLabelKey]) {
        // this element had a customLabelProp (default: ph-label) set, promote it to the lastLabel
        lastLabel = element[elAttrLabelKey] as string
      }

      // if lastLabel is set, update this elements tag_name
      if (lastLabel) {
        element['tag_name'] = lastLabel
      }
    }
    posthog.autocapture(eventType, elements, {
      ...autocaptureProperties,
      $touch_x: e.nativeEvent?.pageX,
      $touch_y: e.nativeEvent?.pageY,
    })
  }
}
