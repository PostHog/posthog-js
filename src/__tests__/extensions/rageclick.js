import RageClick from '../../extensions/rageclick'

describe('RageClick()', () => {
    given('instance', () => new RageClick(given.enabled))
    given('capture', () => jest.fn())
    given('enabled', () => true)

    const click = (x, y, t) => given.instance.click(x, y, t, given.capture)

    it('captures some rage clicking', () => {
        click(0, 0, 10)
        click(10, 10, 20)
        click(5, 5, 40)
        click(5, 5, 80)
        click(5, 5, 100)

        expect(given.capture).toHaveBeenCalledWith('$rageclick')
    })

    it('does not capture rage clicks if not enabled', () => {
        given('enabled', () => false)

        click(0, 0, 10)
        click(10, 10, 20)
        click(5, 5, 40)

        expect(given.capture).not.toHaveBeenCalled()
    })

    it('does not capture clicks too far apart (time)', () => {
        click(0, 0, 10)
        click(10, 10, 20)
        click(5, 5, 4000)

        expect(given.capture).not.toHaveBeenCalled()
    })

    it('does not capture clicks too far apart (space)', () => {
        click(0, 0, 10)
        click(10, 10, 20)
        click(50, 10, 40)

        expect(given.capture).not.toHaveBeenCalled()
    })
})
