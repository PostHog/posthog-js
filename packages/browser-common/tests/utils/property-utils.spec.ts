import { matchPropertyFilters, matchTriggerPropertyFilters, propertyComparisons } from '../../src/utils/property-utils'

describe('property utils', () => {
    describe('propertyComparisons', () => {
        it('matches exact and negative exact comparisons', () => {
            expect(propertyComparisons.exact(['EU'], ['US', 'EU'])).toBe(true)
            expect(propertyComparisons.exact(['EU'], ['US'])).toBe(false)
            expect(propertyComparisons.is_not(['EU'], ['US'])).toBe(true)
            expect(propertyComparisons.is_not(['EU'], ['EU'])).toBe(false)
        })

        it('matches regex and case-insensitive contains comparisons', () => {
            expect(propertyComparisons.regex(['^/docs/'], ['/docs/getting-started'])).toBe(true)
            expect(propertyComparisons.not_regex(['^/docs/'], ['/pricing'])).toBe(true)
            expect(propertyComparisons.icontains(['checkout'], ['Start Checkout'])).toBe(true)
            expect(propertyComparisons.not_icontains(['checkout'], ['pricing'])).toBe(true)
        })

        it('matches numeric comparisons', () => {
            expect(propertyComparisons.gt(['10'], ['11'])).toBe(true)
            expect(propertyComparisons.gt(['10'], ['9'])).toBe(false)
            expect(propertyComparisons.lt(['10'], ['9'])).toBe(true)
            expect(propertyComparisons.lt(['10'], ['11'])).toBe(false)
        })
    })

    describe('matchTriggerPropertyFilters', () => {
        it('requires all filters to match', () => {
            expect(
                matchTriggerPropertyFilters(
                    [
                        { key: '$browser', value: 'Chrome', operator: 'exact' },
                        { key: '$current_url', value: '/checkout', operator: 'icontains' },
                    ],
                    { $browser: 'Chrome', $current_url: 'https://example.com/checkout' },
                    undefined
                )
            ).toBe(true)
        })

        it('treats missing properties as matching negative operators only', () => {
            expect(
                matchTriggerPropertyFilters(
                    [{ key: '$geoip_country_code', value: 'US', operator: 'is_not' }],
                    {},
                    undefined
                )
            ).toBe(true)
            expect(
                matchTriggerPropertyFilters(
                    [{ key: '$geoip_country_code', value: 'US', operator: 'exact' }],
                    {},
                    undefined
                )
            ).toBe(false)
        })

        it('can match person properties', () => {
            expect(
                matchTriggerPropertyFilters(
                    [{ key: 'plan', value: 'enterprise', operator: 'exact', type: 'person' }],
                    {},
                    { plan: 'enterprise' }
                )
            ).toBe(true)
        })
    })

    describe('matchPropertyFilters', () => {
        it('matches property filter maps', () => {
            expect(
                matchPropertyFilters(
                    {
                        plan: { values: ['enterprise'], operator: 'exact' },
                        role: { values: ['admin'], operator: 'is_not' },
                    },
                    { plan: 'enterprise', role: 'member' }
                )
            ).toBe(true)
        })
    })
})
