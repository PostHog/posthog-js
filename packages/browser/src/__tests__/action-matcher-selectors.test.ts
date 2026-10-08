import { BrowserAutocapture } from '../browser-autocapture'
import { ActionMatcher } from '../extensions/surveys/action-matcher'
import { createMockConfig, createMockPostHog } from './helpers/posthog-instance'

describe('action matcher selector ownership', () => {
    const action = (selector: string) => ({
        id: 1,
        name: 'click',
        steps: [{ event: '$autocapture', selector }],
    })

    let autocapture: BrowserAutocapture
    let survey: ActionMatcher
    let tour: ActionMatcher
    let button: HTMLButtonElement

    beforeEach(() => {
        const posthog = createMockPostHog({
            config: createMockConfig(),
            _shouldDisableFlags: () => false,
            _addCaptureHook: vi.fn(() => () => {}),
        })
        autocapture = new BrowserAutocapture(posthog)
        posthog.autocapture = autocapture
        survey = new ActionMatcher(posthog)
        tour = new ActionMatcher(posthog)
        survey.init()
        tour.init()
        button = document.createElement('button')
        button.id = 'shared'
        button.className = 'survey tour'
        document.body.appendChild(button)
    })

    afterEach(() => {
        survey.dispose()
        tour.dispose()
        autocapture.dispose()
        button.remove()
    })

    it('replaces only the registering matcher’s selectors', () => {
        survey.register([action('.survey')])
        tour.register([action('.tour')])
        expect(autocapture.getElementSelectors(button)).toEqual(['.survey', '.tour'])
        survey.replace([action('#shared')])
        expect(autocapture.getElementSelectors(button)).toEqual(['#shared', '.tour'])
        survey.replace([])
        expect(autocapture.getElementSelectors(button)).toEqual(['.tour'])
    })

    it('retains a shared selector until its last matcher is disposed', () => {
        survey.register([action('#shared')])
        tour.register([action('#shared')])
        expect(autocapture.getElementSelectors(button)).toEqual(['#shared'])
        survey.dispose()
        survey.dispose()
        expect(autocapture.getElementSelectors(button)).toEqual(['#shared'])
        tour.dispose()
        expect(autocapture.getElementSelectors(button)).toEqual([])
    })

    it('preserves shared selectors during empty replacement and repeated registration', () => {
        survey.register([action('#shared')])
        survey.register([action('#shared')])
        tour.register([action('#shared')])
        survey.replace([])
        expect(autocapture.getElementSelectors(button)).toEqual(['#shared'])
        tour.replace([])
        expect(autocapture.getElementSelectors(button)).toEqual([])
    })

    it('keeps default-owner replacement independent of action matchers', () => {
        autocapture.setElementSelectors(new Set(['.survey']))
        tour.register([action('.tour')])
        autocapture.setElementSelectors(new Set(['#shared']))
        expect(autocapture.getElementSelectors(button)).toEqual(['#shared', '.tour'])
    })

    it('clears selector ownership on autocapture disposal', () => {
        survey.register([action('.survey')])
        tour.register([action('.tour')])
        autocapture.dispose()
        expect(autocapture.getElementSelectors(button)).toEqual([])
        survey.dispose()
        expect(autocapture.getElementSelectors(button)).toEqual([])
    })
})
