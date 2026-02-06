import type { Trigger } from '../../triggers/behaviour/types'
import type { URLTrigger } from '../../triggers/behaviour/url-trigger'
import type { EventTrigger } from '../../triggers/behaviour/event-trigger'
import type { FlagTrigger } from '../../triggers/behaviour/flag-trigger'
import type { SampleRateTrigger } from '../../triggers/behaviour/sample-rate-trigger'

export interface TriggerStatus {
    name: string
    result: boolean | null
    config: Record<string, unknown>
}

export interface AutocaptureTriggersStatus {
    sessionId: string
    overall: boolean
    triggers: TriggerStatus[]
}

function getUrlTriggerConfig(trigger: URLTrigger): Record<string, unknown> {
    return {
        urls: trigger.urlTriggers.map((t) => t.url),
    }
}

function getEventTriggerConfig(trigger: EventTrigger): Record<string, unknown> {
    return {
        events: trigger.eventTriggers,
    }
}

function getFlagTriggerConfig(trigger: FlagTrigger): Record<string, unknown> {
    return {
        flagKey: trigger.linkedFlag?.key ?? null,
        variant: trigger.linkedFlag?.variant ?? null,
    }
}

function getSampleRateTriggerConfig(trigger: SampleRateTrigger): Record<string, unknown> {
    return {
        sampleRate: trigger.sampleRate,
    }
}

export function getTriggerStatus(trigger: Trigger, sessionId: string): TriggerStatus {
    const result = trigger.matches(sessionId)
    let config: Record<string, unknown>

    switch (trigger.name) {
        case 'url':
            config = getUrlTriggerConfig(trigger as URLTrigger)
            break
        case 'event':
            config = getEventTriggerConfig(trigger as EventTrigger)
            break
        case 'flag':
            config = getFlagTriggerConfig(trigger as FlagTrigger)
            break
        case 'sample-rate':
            config = getSampleRateTriggerConfig(trigger as SampleRateTrigger)
            break
        default:
            config = {}
    }

    return { name: trigger.name, result, config }
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
