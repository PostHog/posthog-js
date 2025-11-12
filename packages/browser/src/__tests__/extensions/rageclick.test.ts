import RageClick from '../../extensions/rageclick'

describe('RageClick()', () => {
    let instance: RageClick

    describe('when enabled (default config)', () => {
        beforeEach(() => {
            instance = new RageClick(true)
        })

        it('identifies some rage clicking', () => {
            const detection = [
                instance.isRageClick(0, 0, 10),
                instance.isRageClick(10, 10, 20),
                instance.isRageClick(5, 5, 40), // triggers rage click
                instance.isRageClick(5, 5, 50), // does not re-trigger
            ]

            expect(detection).toEqual([false, false, true, false])
        })

        it('identifies some rage clicking when time delta has passed', () => {
            const detection = [
                instance.isRageClick(0, 0, 10),
                instance.isRageClick(10, 10, 20),
                instance.isRageClick(5, 5, 40), // triggers rage click
                // these next three don't trigger
                // because you need to move past threshold before triggering again
                instance.isRageClick(5, 5, 80),
                instance.isRageClick(5, 5, 100),
                instance.isRageClick(5, 5, 110),
                // moving past the time threshold resets the counter
                instance.isRageClick(5, 5, 1120),
                instance.isRageClick(5, 5, 1121),
                instance.isRageClick(5, 5, 1122), // triggers rage click
            ]

            expect(detection).toEqual([false, false, true, false, false, false, false, false, true])
        })

        it('identifies some rage clicking when pixel delta has passed', () => {
            const detection = [
                instance.isRageClick(0, 0, 10),
                instance.isRageClick(10, 10, 20),
                instance.isRageClick(5, 5, 40), // triggers rage click
                // these next three don't trigger
                // because you need to move past threshold before triggering again
                instance.isRageClick(5, 5, 80),
                instance.isRageClick(5, 5, 100),
                instance.isRageClick(5, 5, 110),
                // moving past the pixel threshold resets the counter
                instance.isRageClick(36, 5, 120),
                instance.isRageClick(36, 5, 130),
                instance.isRageClick(36, 5, 140), // triggers rage click
            ]

            expect(detection).toEqual([false, false, true, false, false, false, false, false, true])
        })

        it('does not capture clicks too far apart (time)', () => {
            instance.isRageClick(5, 5, 10)
            instance.isRageClick(5, 5, 20)
            const rageClickDetected = instance.isRageClick(5, 5, 4000)

            expect(rageClickDetected).toBeFalsy()
        })

        it('does not capture clicks too far apart (space)', () => {
            instance.isRageClick(0, 0, 10)
            instance.isRageClick(10, 10, 20)
            const rageClickDetected = instance.isRageClick(50, 10, 40)

            expect(rageClickDetected).toBeFalsy()
        })
    })

    describe('when enabled (custom configuration)', () => {
        it('respects custom click count', () => {
            instance = new RageClick({ click_count: 2 })

            const detection = [
                instance.isRageClick(0, 0, 0),
                instance.isRageClick(0, 0, 100), // triggers at 2 clicks
            ]

            expect(detection).toEqual([false, true])
        })

        it('respects custom timeout', () => {
            instance = new RageClick({ timeout_ms: 100 })

            instance.isRageClick(0, 0, 0)
            instance.isRageClick(0, 0, 50)
            // next click too late (after timeout)
            const rageClickDetected = instance.isRageClick(0, 0, 500)

            expect(rageClickDetected).toBeFalsy()
        })

        it('respects custom pixel threshold', () => {
            instance = new RageClick({ threshold_px: 5 })

            instance.isRageClick(0, 0, 0)
            instance.isRageClick(6, 0, 50) // 6 > 5 threshold
            const rageClickDetected = instance.isRageClick(6, 0, 80)

            expect(rageClickDetected).toBeFalsy()
        })

        it('falls back to defaults when config object is empty', () => {
            instance = new RageClick({})

            const detection = [
                instance.isRageClick(0, 0, 0),
                instance.isRageClick(10, 10, 100),
                instance.isRageClick(5, 5, 200),
            ]

            // Default click count = 3, triggers on third click
            expect(detection).toEqual([false, false, true])
        })
    })

    describe('when disabled or invalid config', () => {
        it('handles false as input gracefully', () => {
            instance = new RageClick(false)
            const result = instance.isRageClick(0, 0, 0)
            expect(result).toBe(false)
        })
    })
})
