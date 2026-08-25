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

// react-native-web internals; skipped only on the fallback path so a same-named native component is kept.
const frameworkInternalLabels = ['LocaleProvider']

const reactFiberKeyPattern = /^__react(Fiber|InternalInstance)\$/

// Fires per touch, so warn once: a persistent failure here silently disables touch autocapture.
let warnedFallbackFailure = false

// react-dom (RN Web) events have no _targetInst; the fiber sits on e.target under a randomised __reactFiber$ key.
const getFallbackTargetInstance = (e: any): Element | undefined => {
  try {
    const target = e.target
    if (!target || typeof target !== 'object') {
      return undefined
    }

    const key = Object.getOwnPropertyNames(target).find((name) => reactFiberKeyPattern.test(name))

    return key ? target[key] : undefined
  } catch (error) {
    if (!warnedFallbackFailure) {
      warnedFallbackFailure = true
      console.warn('PostHog touch autocapture: reading the React fiber from the touch target threw:', error)
    }
    return undefined
  }
}

export const autocaptureFromTouchEvent = (
  e: any,
  posthog: PostHog,
  options: PostHogAutocaptureOptions = {},
  eventType: 'touch' | 'click' = 'touch'
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
  const skippedLabels = nativeInst ? ignoreLabels : [...frameworkInternalLabels, ...ignoreLabels]
  const elements: PostHogAutocaptureElement[] = []
  const autocaptureProperties: Record<string, JsonType> = {}

  let currentInst: Element | undefined = targetInst

  while (
    currentInst &&
    // maxComponentTreeSize will always be defined as we have a defaultProps. But ts needs a check so this is here.
    elements.length < maxElementsCaptured
  ) {
    const el: PostHogAutocaptureElement = {
      tag_name: '',
    }
    const elAutocaptureProperties: Record<string, JsonType> = {}

    const props = currentInst.memoizedProps

    if (props?.[noCaptureProp]) {
      // Immediately ignore events if a no capture is in the chain
      return
    }

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
    const label =
      typeof props?.[customLabelProp] !== 'undefined'
        ? `${props[customLabelProp]}`
        : currentInst.elementType?.displayName || currentInst.elementType?.name

    Object.assign(autocaptureProperties, elAutocaptureProperties)

    if (label && !skippedLabels.includes(label)) {
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
      // DOM touch events (RN Web) carry pageX/pageY on changedTouches, not directly on nativeEvent.
      $touch_x: e.nativeEvent?.pageX ?? e.nativeEvent?.changedTouches?.[0]?.pageX,
      $touch_y: e.nativeEvent?.pageY ?? e.nativeEvent?.changedTouches?.[0]?.pageY,
    })
  }
}
