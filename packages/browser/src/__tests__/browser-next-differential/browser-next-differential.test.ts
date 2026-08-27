import { browserNextAdapter } from './browser-next-adapter'
import { expectScenario, runDifferentialScenario, type BehaviorScenario } from './harness'
import { legacyBrowserAdapter } from './legacy-browser-adapter'
import {
    activeSessionScenario,
    anonymousCaptureScenario,
    consentResumeScenario,
    defaultOptOutScenario,
    groupIdempotenceScenario,
    groupScenario,
    identifiedSwitchScenario,
    identifyPropertiesScenario,
    identifyScenario,
    idleSessionScenario,
    maxLengthSessionScenario,
    optOutScenario,
    repeatedIdentifyScenario,
    resetScenario,
} from './scenarios'

const adapters = { legacy: legacyBrowserAdapter, next: browserNextAdapter }

const assertScenario = async (scenario: BehaviorScenario<unknown>): Promise<void> => {
    const result = await runDifferentialScenario(adapters, scenario)
    expectScenario(scenario, result)
}

describe('legacy browser and browser-next differential harness', () => {
    it('preserves caller properties and anonymous identity during capture', async () => {
        await assertScenario(anonymousCaptureScenario)
    })

    it('links the anonymous identity on the first identify', async () => {
        await assertScenario(identifyScenario)
    })

    it('suppresses capture after explicit opt-out', async () => {
        await assertScenario(optOutScenario)
    })

    it('retains identity state while blocking capture by default until explicit opt-in', async () => {
        await assertScenario(defaultOptOutScenario)
    })

    it('resumes capture after an explicit denial is revoked', async () => {
        await assertScenario(consentResumeScenario)
    })

    it('links the anonymous identity only once for repeated identify calls', async () => {
        await assertScenario(repeatedIdentifyScenario)
    })

    it('does not relink the anonymous identity when the identified ID changes', async () => {
        await assertScenario(identifiedSwitchScenario)
    })

    it('emits one person-property mutation when same-ID identify receives new properties', async () => {
        await assertScenario(identifyPropertiesScenario)
    })

    it('attaches group membership to group-identify and later capture events', async () => {
        await assertScenario(groupScenario)
    })

    it('does not repeat group-identify for an unchanged group without properties', async () => {
        await assertScenario(groupIdempotenceScenario)
    })

    it('clears identified state and groups on reset and records provisional D7 window behavior', async () => {
        await assertScenario(resetScenario)
    })

    it('retains session and window IDs during ordinary activity', async () => {
        await assertScenario(activeSessionScenario)
    })

    it('rotates the session after inactivity and records provisional D7 window behavior', async () => {
        await assertScenario(idleSessionScenario)
    })

    it('rotates a continuously active session and records provisional D7 window behavior', async () => {
        await assertScenario(maxLengthSessionScenario)
    })
})
