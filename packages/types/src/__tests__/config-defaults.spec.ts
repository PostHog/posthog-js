import { CONFIG_DEFAULTS_VALUES, LATEST_CONFIG_DEFAULTS, ConfigDefaults } from '../index'

describe('ConfigDefaults', () => {
    it('exports CONFIG_DEFAULTS_VALUES as a readonly array', () => {
        expect(Array.isArray(CONFIG_DEFAULTS_VALUES)).toBe(true)
        expect(CONFIG_DEFAULTS_VALUES.length).toBeGreaterThan(0)
    })

    it('has the latest date as the first element', () => {
        // The first element should always be the latest/recommended value
        expect(CONFIG_DEFAULTS_VALUES[0]).toBe(LATEST_CONFIG_DEFAULTS)
    })

    it('exports LATEST_CONFIG_DEFAULTS matching the first array element', () => {
        expect(LATEST_CONFIG_DEFAULTS).toBe('2025-11-30')
    })

})
