import { expect } from '@playwright/test'

export async function assertCustomEventsWorkAndAreAccessibleViaApi(events: any[]) {
    // chromium might send a pageleave event
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events.filter(({ event }) => event === 'custom-event').length).toEqual(1)
    expect(events.filter(({ event }) => event === '$pageview').length).toEqual(1)
    expect(events.filter(({ event }) => event === '$autocapture').length).toEqual(1)
}

export async function assertAutocapturedEventsWorkAndAreAccessibleViaApi(events: any[]) {
    expect(events.filter(({ event }) => event === '$pageview').length).toEqual(1)
    const autocapturedEvents = events.filter((e) => e.event === '$autocapture')

    expect(autocapturedEvents.length).toEqual(2)

    const autocapturedLinkClickEvents = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')
    const autocapturedButtonClickEvents = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')

    expect(autocapturedButtonClickEvents.length).toEqual(1)
    expect(autocapturedLinkClickEvents.length).toEqual(1)

    const autocapturedButtonElement = autocapturedButtonClickEvents[0].elements[0]
    const autocapturedLinkElement = autocapturedLinkClickEvents[0].elements[0]

    // Captures text content if mask_all_text isn't set
    expect(autocapturedLinkElement['text']).toEqual('Sensitive text!')

    const attrKeys = Object.keys(autocapturedButtonElement.attributes)
    attrKeys.sort()

    expect(attrKeys).toEqual([
        'attr__class',
        'attr__data-cy-button-sensitive-attributes',
        'attr__data-sensitive',
        'attr__id',
    ])
}

export async function assertConfigOptionsChangeAutocaptureBehaviourAccordingly(events: any[]) {
    const autocapturedEvents = events.filter((e) => e.event === '$autocapture')
    expect(autocapturedEvents.length).toEqual(2)

    const autocapturedLinkElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')[0].elements[0]
    const autocapturedButtonElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')[0]
        .elements[0]

    // mask_all_text does not set $el_text
    expect(autocapturedLinkElement['text']).toEqual(null)

    // mask_all_element_attributes does not capture any attributes at all from all elements
    expect(Object.keys(autocapturedButtonElement.attributes).length).toEqual(0)
}
