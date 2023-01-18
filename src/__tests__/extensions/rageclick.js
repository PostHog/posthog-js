import RageClick from '../../extensions/rageclick'

describe('RageClick()', () => {
    given('instance', () => new RageClick(given.enabled))
    given('enabled', () => true)

    const isRageClick = (x, y, t) => given.instance.isRageClick(x, y, t)

    it('identifies some rage clicking', () => {
        const detection = [
            isRageClick(0, 0, 10),
            isRageClick(10, 10, 20),
            isRageClick(5, 5, 40), // triggers rage click
            isRageClick(5, 5, 50), // does not re-trigger
        ]

        expect(detection).toEqual([false, false, true, false])
    })

    it('identifies some rage clicking when time delta has passed', () => {
        const detection = [
            isRageClick(0, 0, 10),
            isRageClick(10, 10, 20),
            isRageClick(5, 5, 40), // triggers rage click
            // these next three don't trigger
            // because you need to move past threshold before triggering again
            isRageClick(5, 5, 80),
            isRageClick(5, 5, 100),
            isRageClick(5, 5, 110),
            // moving past the time threshold resets the counter
            isRageClick(5, 5, 1120),
            isRageClick(5, 5, 1121),
            isRageClick(5, 5, 1122), // triggers rage click
        ]

        expect(detection).toEqual([false, false, true, false, false, false, false, false, true])
    })

    it('identifies some rage clicking when pixel delta has passed', () => {
        const detection = [
            isRageClick(0, 0, 10),
            isRageClick(10, 10, 20),
            isRageClick(5, 5, 40), // triggers rage click
            // these next three don't trigger
            // because you need to move past threshold before triggering again
            isRageClick(5, 5, 80),
            isRageClick(5, 5, 100),
            isRageClick(5, 5, 110),
            // moving past the pixel threshold resets the counter
            isRageClick(36, 5, 120),
            isRageClick(36, 5, 130),
            isRageClick(36, 5, 140), // triggers rage click
        ]

        expect(detection).toEqual([false, false, true, false, false, false, false, false, true])
    })

    it('does not capture rage clicks if not enabled', () => {
        given('enabled', () => false)

        isRageClick(5, 5, 10)
        isRageClick(5, 5, 20)
        const rageClickDetected = isRageClick(5, 5, 40)

        expect(rageClickDetected).toBeFalsy()
    })

    it('does not capture clicks too far apart (time)', () => {
        isRageClick(5, 5, 10)
        isRageClick(5, 5, 20)
        const rageClickDetected = isRageClick(5, 5, 4000)

        expect(rageClickDetected).toBeFalsy()
    })

    it('does not capture clicks too far apart (space)', () => {
        isRageClick(0, 0, 10)
        isRageClick(10, 10, 20)
        const rageClickDetected = isRageClick(50, 10, 40)

        expect(rageClickDetected).toBeFalsy()
    })
})
