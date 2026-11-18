import { acceptsEventOptions, EVENT_OPTION_LEGACY_PROPERTIES, eventOptionsAsLegacyProperties } from '../event-options'

describe('EVENT_OPTION_LEGACY_PROPERTIES', () => {
  it('maps each option to the property posthog-node 5 reads, in a fixed order', () => {
    expect(Object.entries(EVENT_OPTION_LEGACY_PROPERTIES)).toEqual([
      ['process_person_profile', '$process_person_profile'],
      ['cookieless_mode', '$cookieless_mode'],
      ['disable_skew_correction', '$ignore_sent_at'],
      ['product_tour_id', '$product_tour_id'],
    ])
  })
})

describe('eventOptionsAsLegacyProperties', () => {
  it.each([
    ['no options', undefined, {}],
    ['empty options', {}, {}],
    [
      'every known option',
      { process_person_profile: true, cookieless_mode: true, disable_skew_correction: true, product_tour_id: 'tour' },
      { $process_person_profile: true, $cookieless_mode: true, $ignore_sent_at: true, $product_tour_id: 'tour' },
    ],
    [
      'set falsy values',
      { process_person_profile: false, product_tour_id: '' },
      { $process_person_profile: false, $product_tour_id: '' },
    ],
    ['unset values', { process_person_profile: null, cookieless_mode: undefined }, {}],
    [
      'unknown keys',
      { custom_option: 'six only', $process_person_profile: true, process_person_profile: 0 },
      { $process_person_profile: 0 },
    ],
    ['inherited object keys', { constructor: 'x', toString: 'y', hasOwnProperty: 'z' }, {}],
  ])('maps %s', (_, options, expected) => {
    expect(eventOptionsAsLegacyProperties(options)).toStrictEqual(expected)
  })

  it('ignores an own __proto__ key', () => {
    const options = JSON.parse('{"__proto__": {"polluted": true}, "cookieless_mode": true}')

    const properties = eventOptionsAsLegacyProperties(options)

    expect(properties).toStrictEqual({ $cookieless_mode: true })
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
  })

  it('keeps the order of the options and the values by reference', () => {
    const tour = { id: 'tour' }
    const options = { product_tour_id: tour, process_person_profile: true }

    const properties = eventOptionsAsLegacyProperties(options)

    expect(Object.keys(properties)).toEqual(['$product_tour_id', '$process_person_profile'])
    expect(properties.$product_tour_id).toBe(tour)
    expect(options).toEqual({ product_tour_id: tour, process_person_profile: true })
  })
})

describe('acceptsEventOptions', () => {
  it.each([
    ['a registerOptions method', { registerOptions: async () => {} }, true],
    ['no registerOptions', {}, false],
    ['a registerOptions value that is not a function', { registerOptions: true }, false],
  ])('with %s', (_, client, expected) => {
    expect(acceptsEventOptions(client)).toBe(expected)
  })
})
