import { PostHog } from './posthog-rn'
import { PostHogAutocaptureElement, JsonType } from 'posthog-core'
import { PostHogAutocaptureOptions } from './types'

interface Element {
  elementType?: {
    displayName?: string
    name?: string
  }
  memoizedProps?: Record<string, unknown>
  return?: Element
}

const flattenStyles = (styles: any): any => {
  const flattened: any = {}

  if (Array.isArray(styles)) {
    for (const style of styles) {
      Object.assign(flattened, flattenStyles(style))
    }
  } else {
    Object.assign(flattened, styles)
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

export const autocaptureFromTouchEvent = (e: any, posthog: PostHog, options: PostHogAutocaptureOptions = {}): void => {
  const {
    noCaptureProp = 'ph-no-capture',
    customLabelProp = defaultPostHogLabelProp,
    maxElementsCaptured = 20,
    ignoreLabels = [],
    propsToCapture = ['style', 'testID', 'accessibilityLabel', customLabelProp, 'children'],
  } = options

  if (!e._targetInst) {
    return
  }
  const elements: PostHogAutocaptureElement[] = []

  let currentInst: Element | undefined = e._targetInst

  while (
    currentInst &&
    // maxComponentTreeSize will always be defined as we have a defaultProps. But ts needs a check so this is here.
    elements.length < maxElementsCaptured
  ) {
    const el: PostHogAutocaptureElement = {
      tag_name: '',
    }

    const props = currentInst.memoizedProps

    if (props?.[noCaptureProp]) {
      // Immediately ignore events if a no capture is in the chain
      return
    }

    if (props) {
      // Capture only props we have said to capture. By default this is only "safe" props
      Object.keys(props).forEach((key) => {
        if (!propsToCapture.includes(key)) {
          return
        }
        const value = props[key]
        if (key === 'style') {
          el.attr__style = stringifyStyle(value)
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

    if (label && !ignoreLabels.includes(label)) {
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
    posthog.autocapture('touch', elements, {
      $touch_x: e.nativeEvent.pageX,
      $touch_y: e.nativeEvent.pageY,
    })
  }
}
