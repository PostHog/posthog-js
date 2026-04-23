describe('web-vitals Array.prototype.at polyfill', () => {
    const originalAt = Array.prototype.at

    beforeEach(() => {
        jest.resetModules()
    })

    afterEach(() => {
        if (originalAt) {
            // eslint-disable-next-line no-extend-native
            Object.defineProperty(Array.prototype, 'at', {
                value: originalAt,
                writable: true,
                configurable: true,
            })
        }
    })

    it('installs Array.prototype.at when missing', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (Array.prototype as any).at
        expect(Array.prototype.at).toBeUndefined()

        require('../../extensions/web-vitals/polyfill')

        expect(typeof Array.prototype.at).toBe('function')
        expect([10, 20, 30].at(0)).toBe(10)
        expect([10, 20, 30].at(2)).toBe(30)
        expect([10, 20, 30].at(-1)).toBe(30)
        expect([10, 20, 30].at(-3)).toBe(10)
        expect([10, 20, 30].at(5)).toBeUndefined()
        expect([10, 20, 30].at(-5)).toBeUndefined()
        expect([].at(0)).toBeUndefined()
    })

    it('does not overwrite a native Array.prototype.at', () => {
        const marker = jest.fn().mockReturnValue('native')
        // eslint-disable-next-line no-extend-native
        Object.defineProperty(Array.prototype, 'at', {
            value: marker,
            writable: true,
            configurable: true,
        })

        require('../../extensions/web-vitals/polyfill')

        expect(Array.prototype.at).toBe(marker)
        expect([1, 2, 3].at(0)).toBe('native')
    })
})
