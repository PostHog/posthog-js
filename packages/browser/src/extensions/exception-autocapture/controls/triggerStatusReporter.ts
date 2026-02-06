import type { Trigger } from '../../triggers/behaviour/types'
import type { URLTrigger } from '../../triggers/behaviour/url-trigger'
import type { EventTrigger } from '../../triggers/behaviour/event-trigger'
import type { FlagTrigger } from '../../triggers/behaviour/flag-trigger'
import type { SampleRateTrigger } from '../../triggers/behaviour/sample-rate-trigger'

export interface TriggerStatus {
    name: string
    result: boolean | null
    description: string
}

export interface AutocaptureTriggersStatus {
    sessionId: string
    overall: boolean
    triggers: TriggerStatus[]
}

function getUrlTriggerDescription(trigger: URLTrigger, result: boolean | null): string {
    if (result === null) {
        return 'Not configured (no URL triggers defined)'
    }
    if (result) {
        return 'Matched - URL trigger activated for session'
    }
    return `Not matched - waiting for URL: ${trigger.urlTriggers.map((t) => t.url).join(', ')}`
}

function getEventTriggerDescription(trigger: EventTrigger, result: boolean | null): string {
    if (result === null) {
        return 'Not configured (no event triggers defined)'
    }
    if (result) {
        return 'Matched - event trigger activated for session'
    }
    return `Not matched - waiting for events: ${trigger.eventTriggers.join(', ')}`
}

function getFlagTriggerDescription(trigger: FlagTrigger, result: boolean | null): string {
    if (result === null) {
        return 'Not configured (no linked flag defined)'
    }
    const variantInfo = trigger.linkedFlag?.variant ? ` (variant: ${trigger.linkedFlag.variant})` : ''
    if (result) {
        return `Matched - flag "${trigger.linkedFlag?.key}" is enabled${variantInfo}`
    }
    const waitingVariantInfo = trigger.linkedFlag?.variant ? ` with variant "${trigger.linkedFlag.variant}"` : ''
    return `Not matched - waiting for flag "${trigger.linkedFlag?.key}"${waitingVariantInfo}`
}

function getSampleRateTriggerDescription(trigger: SampleRateTrigger, result: boolean | null): string {
    if (result === null) {
        return 'Not configured (no sample rate defined)'
    }
    const ratePercent = (trigger.sampleRate! * 100).toFixed(1)
    if (result) {
        return `Matched - session sampled in at ${ratePercent}% rate`
    }
    return `Not matched - session sampled out at ${ratePercent}% rate`
}

export function getTriggerStatus(trigger: Trigger, sessionId: string): TriggerStatus {
    const result = trigger.matches(sessionId)
    let description: string

    switch (trigger.name) {
        case 'url':
            description = getUrlTriggerDescription(trigger as URLTrigger, result)
            break
        case 'event':
            description = getEventTriggerDescription(trigger as EventTrigger, result)
            break
        case 'flag':
            description = getFlagTriggerDescription(trigger as FlagTrigger, result)
            break
        case 'sample-rate':
            description = getSampleRateTriggerDescription(trigger as SampleRateTrigger, result)
            break
        default:
            description = result === null ? 'Not configured' : result ? 'Matched' : 'Not matched'
    }

    return { name: trigger.name, result, description }
}

export function getTriggersStatus(
    triggers: Trigger[],
    sessionId: string,
    overallResult: boolean
): AutocaptureTriggersStatus {
    return {
        sessionId,
        overall: overallResult,
        triggers: triggers.map((t) => getTriggerStatus(t, sessionId)),
    }
}
