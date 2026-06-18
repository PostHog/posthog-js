import type { CliEvent, PostHogCaptureEvent } from '../types'
import { version as sdkVersion } from '../version'
import {
    POSTHOG_CLI_ANALYTICS_SOURCE,
    PostHogCliAnalyticsEvent,
    PostHogCliAnalyticsProperty as Prop,
} from './constants'
import { CliAnalyticsEventType } from './event-types'

const BUILT_IN_EVENT_NAME_BY_TYPE = {
    [CliAnalyticsEventType.custom]: PostHogCliAnalyticsEvent.Custom,
    [CliAnalyticsEventType.identify]: PostHogCliAnalyticsEvent.Identify,
    [CliAnalyticsEventType.cliCommandRun]: PostHogCliAnalyticsEvent.CommandRun,
} satisfies Record<CliAnalyticsEventType, PostHogCliAnalyticsEvent>

export type { PostHogCaptureEvent } from '../types'

export interface BuildPostHogCaptureEventsOptions {
    /** Whether to emit a `$exception` sibling alongside errored command runs. Defaults to `true`. */
    enableExceptionAutocapture?: boolean
}

function getDistinctId(event: CliEvent): string {
    return event.distinctId || event.sessionId || 'anonymous'
}

function getTimestamp(event: CliEvent): string {
    return (event.timestamp ?? new Date()).toISOString()
}

export function buildPostHogCaptureEvents(
    event: CliEvent,
    options: BuildPostHogCaptureEventsOptions = {}
): PostHogCaptureEvent[] {
    const batch = [buildCaptureEvent(event)]
    if (event.isError && event.error && options.enableExceptionAutocapture !== false) {
        batch.push(buildExceptionEvent(event))
    }
    return batch
}

function addRoutingProperties(event: CliEvent, properties: Record<string, unknown>): void {
    if (typeof event.sessionId === 'string' && event.sessionId.length > 0) {
        properties[Prop.SessionId] = event.sessionId
    }
    if (event.groups && Object.keys(event.groups).length > 0) {
        properties.$groups = event.groups
    }
    // Without a real identity the distinct id is the anonymous/session id, so
    // creating a person profile would mint one anonymous person per run and
    // inflate person counts. Opt out unless an identity is present.
    if (event.processPersonProfile === false) {
        properties.$process_person_profile = false
    }
    if (event.setProperties && Object.keys(event.setProperties).length > 0) {
        properties.$set = { ...event.setProperties }
    }
}

function addContextProperties(event: CliEvent, properties: Record<string, unknown>): void {
    if (event.cli) {
        properties[Prop.CliName] = event.cli.name
        if (event.cli.version) {
            properties[Prop.CliVersion] = event.cli.version
        }
    }
    properties[Prop.SdkLanguage] = 'TypeScript'
    properties[Prop.SdkVersion] = sdkVersion

    if (event.environment) {
        properties[Prop.Os] = event.environment.os
        properties[Prop.Arch] = event.environment.arch
        properties[Prop.Runtime] = event.environment.runtime
        properties[Prop.IsTty] = event.environment.isTty
        properties[Prop.IsCi] = event.environment.isCi
    }

    if (event.agent) {
        properties[Prop.IsAgent] = event.agent.isAgent
        if (event.agent.agentName) {
            properties[Prop.AgentName] = event.agent.agentName
        }
        if (event.agent.source) {
            properties[Prop.AgentSource] = event.agent.source
        }
    }
}

function addCommandProperties(event: CliEvent, properties: Record<string, unknown>): void {
    if (event.command !== undefined) {
        properties[Prop.Command] = event.command
    }
    if (event.subcommand !== undefined) {
        properties[Prop.Subcommand] = event.subcommand
    }
    if (event.flags !== undefined) {
        properties[Prop.Flags] = event.flags
    }
    if (event.argsCount !== undefined) {
        properties[Prop.ArgsCount] = event.argsCount
    }
    if (event.exitCode !== undefined) {
        properties[Prop.ExitCode] = event.exitCode
    }
    if (event.durationMs !== undefined) {
        properties[Prop.DurationMs] = event.durationMs
    }
    if (event.isError !== undefined) {
        properties[Prop.IsError] = event.isError
    }
    if (event.intent) {
        properties[Prop.Intent] = event.intent
    }
    if (event.intentSource) {
        properties[Prop.IntentSource] = event.intentSource
    }
}

function addCustomProperties(event: CliEvent, properties: Record<string, unknown>): void {
    if (event.properties) {
        for (const [key, value] of Object.entries(event.properties)) {
            properties[key] = value
        }
    }
}

function buildCaptureEvent(event: CliEvent): PostHogCaptureEvent {
    const properties: Record<string, unknown> = { [Prop.Source]: POSTHOG_CLI_ANALYTICS_SOURCE }
    addRoutingProperties(event, properties)
    addContextProperties(event, properties)
    addCommandProperties(event, properties)
    addCustomProperties(event, properties)

    return {
        event: event.eventName ?? BUILT_IN_EVENT_NAME_BY_TYPE[event.eventType],
        distinct_id: getDistinctId(event),
        properties,
        timestamp: getTimestamp(event),
        type: 'capture',
    }
}

function buildExceptionEvent(event: CliEvent): PostHogCaptureEvent {
    const properties: Record<string, unknown> = { [Prop.Source]: POSTHOG_CLI_ANALYTICS_SOURCE }
    addRoutingProperties(event, properties)
    addContextProperties(event, properties)

    if (event.error) {
        // Spread the core `$exception_list` / `$exception_level` properties so CLI
        // command failures use the same error-tracking contract as every other SDK.
        Object.assign(properties, event.error)
    }
    if (event.command !== undefined) {
        properties[Prop.Command] = event.command
    }
    if (event.subcommand !== undefined) {
        properties[Prop.Subcommand] = event.subcommand
    }
    addCustomProperties(event, properties)

    return {
        event: PostHogCliAnalyticsEvent.Exception,
        distinct_id: getDistinctId(event),
        properties,
        timestamp: getTimestamp(event),
        type: 'capture',
    }
}
