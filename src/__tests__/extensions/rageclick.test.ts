import RageClick from '../../extensions/rageclick'

describe('RageClick()', () => {
    let instance: RageClick

    describe('when enabled', () => {
        beforeEach(() => {
            instance = new RageClick()
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
})
