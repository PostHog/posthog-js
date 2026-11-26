// @vitest-environment jsdom
import RageClick from '../src/rageclick'

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

    describe('browser-forwarded label clicks', () => {
        let label: HTMLLabelElement
        let control: HTMLInputElement

        beforeEach(() => {
            instance = new RageClick(true)
            document.body.innerHTML = ''
            label = document.createElement('label')
            label.htmlFor = 'rc-input'
            control = document.createElement('input')
            control.id = 'rc-input'
            document.body.appendChild(label)
            document.body.appendChild(control)
        })

        // A real label click reaches the detector twice: the genuine click on the label, then the
        // browser's synthetic click forwarded to the label's control a moment later. Only the genuine
        // click should count. Firefox gives the forwarded click detail 1, so it is recognised by its
        // target (label.control), not by its detail value.
        const labelClick = (t: number) => [
            instance.isRageClick(5, 5, t, label),
            instance.isRageClick(5, 5, t + 1, control),
        ]

        it('does not count the forwarded click toward a rage click', () => {
            // Two user clicks on the label (four detector calls) must not rage click.
            const detection = [...labelClick(10), ...labelClick(30)]
            expect(detection).toEqual([false, false, false, false])
        })

        it('recognises the forwarded click without Element.closest (IE11)', () => {
            const closest = Element.prototype.closest
            // @ts-expect-error simulating a browser without closest()
            delete Element.prototype.closest
            try {
                const span = document.createElement('span')
                label.appendChild(span)
                const detection = [
                    instance.isRageClick(5, 5, 10, span),
                    instance.isRageClick(5, 5, 11, control),
                    instance.isRageClick(5, 5, 30, span),
                    instance.isRageClick(5, 5, 31, control),
                ]
                expect(detection).toEqual([false, false, false, false])
            } finally {
                Element.prototype.closest = closest
            }
        })

        it('does not hang on a form whose control shadows parentElement', () => {
            const form = document.createElement('form')
            const shadowing = document.createElement('input')
            shadowing.name = 'parentElement'
            const button = document.createElement('button')
            form.append(shadowing, button)
            document.body.appendChild(form)
            // browsers expose a named form control as a form property; jsdom does not
            Object.defineProperty(form, 'parentElement', { get: () => shadowing })
            Object.defineProperty(form, 'parentNode', { get: () => shadowing })
            const detection = [instance.isRageClick(5, 5, 10, button), instance.isRageClick(5, 5, 11, control)]
            expect(detection).toEqual([false, false])
        })

        it('recognises a label in an XHTML document', () => {
            const doc = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'html', null)
            const body = doc.createElementNS('http://www.w3.org/1999/xhtml', 'body')
            doc.documentElement.appendChild(body)
            const xhtmlLabel = doc.createElementNS('http://www.w3.org/1999/xhtml', 'label') as HTMLLabelElement
            const xhtmlControl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement
            xhtmlControl.id = 'x-input'
            xhtmlLabel.htmlFor = 'x-input'
            body.append(xhtmlLabel, xhtmlControl)
            const detection = [
                instance.isRageClick(5, 5, 10, xhtmlLabel),
                instance.isRageClick(5, 5, 11, xhtmlControl),
                instance.isRageClick(5, 5, 30, xhtmlLabel),
                instance.isRageClick(5, 5, 31, xhtmlControl),
            ]
            expect(detection).toEqual([false, false, false, false])
        })

        it('still detects a rage click from three genuine label clicks', () => {
            const detection = [...labelClick(10), ...labelClick(30), ...labelClick(50)]
            // The third genuine click (fifth call) triggers; the forwarded clicks never do.
            expect(detection).toEqual([false, false, false, false, true, false])
        })
    })
})
