import React from 'react'
import { AppRegistry, Text, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import PostHog from 'posthog-react-native'
import { controllerURL, sdkVersion } from './controller-config'

const nativeFetch = global.fetch
let client
let captured = new Set()
let sent = new Set()
let requests = []
let lastError = null

// Passive observation at RN's native fetch boundary. The original request and response are unchanged.
global.fetch = async (url, options) => {
    const started = Date.now()
    const response = await nativeFetch(url, options)
    if (String(url).includes('/batch/')) {
        try {
            const body = JSON.parse(options.body)
            const uuids = body.batch.map((event) => event.uuid)
            const attempt = Math.max(
                0,
                ...uuids.map((uuid) => requests.filter((r) => r.uuid_list.includes(uuid)).length)
            )
            requests.push({
                timestamp_ms: started,
                status_code: response.status,
                retry_attempt: attempt,
                event_count: uuids.length,
                uuid_list: uuids,
            })
            if (response.ok) uuids.forEach((uuid) => sent.add(uuid))
        } catch (error) {
            lastError = `Observation failed: ${error.message}`
        }
    }
    return response
}

async function execute(action, input) {
    if (action === 'init') {
        if (client) throw new Error('Reset the native runtime before reinitializing')
        captured = new Set()
        sent = new Set()
        requests = []
        lastError = null
        client = new PostHog(input.api_key, {
            host: input.host,
            flushAt: input.flush_at ?? 100,
            flushInterval: input.flush_interval_ms ?? 500,
            fetchRetryCount: input.max_retries ?? 3,
            disableCompression: input.enable_compression === undefined ? undefined : !input.enable_compression,
            preloadFeatureFlags: false,
            disableRemoteConfig: true,
            captureAppLifecycleEvents: false,
            setDefaultPersonProperties: false,
            disableSurveys: true,
            before_send: (event) => {
                captured.add(event.uuid)
                return event
            },
        })
        // Public flush waits for asynchronous native storage initialization, with startup capture isolated.
        await client.flush()
        return { success: true }
    }
    if (!client) throw new Error('SDK not initialized')
    if (action === 'capture') {
        if (!input.distinct_id || !input.event) throw new Error('distinct_id and event are required')
        if (client.getDistinctId() !== input.distinct_id) client.identify(input.distinct_id)
        let uuid
        const remove = client.on('capture', (message) => {
            if (message?.event === input.event) uuid = message.uuid
        })
        try {
            client.capture(
                input.event,
                input.properties,
                input.timestamp ? { timestamp: new Date(input.timestamp) } : undefined
            )
            if (!uuid) throw new Error('SDK did not enqueue capture')
            return { success: true, uuid }
        } finally {
            remove()
        }
    }
    if (action === 'flush') {
        const before = sent.size
        try {
            await client.flush()
            return { success: true, events_flushed: sent.size - before }
        } catch (error) {
            lastError = error.message
            return { success: false, events_flushed: sent.size - before, error: lastError }
        }
    }
    if (action === 'get_feature_flag') {
        if (!input.key || !input.distinct_id) throw new Error('key and distinct_id are required')
        if (client.getDistinctId() !== input.distinct_id) client.identify(input.distinct_id)
        if (input.groups) await client.register({ $groups: input.groups })
        if (input.person_properties) client.setPersonPropertiesForFlags(input.person_properties, false)
        if (input.group_properties) client.setGroupPropertiesForFlags(input.group_properties, false)
        if (input.force_remote !== false) await client.reloadFeatureFlagsAsync()
        const value = client.getFeatureFlag(input.key)
        await client.flush()
        return { success: true, value }
    }
    if (action === 'state')
        return {
            pending_events: client.getPersistedProperty('queue')?.length || 0,
            total_events_captured: captured.size,
            total_events_sent: sent.size,
            total_retries: requests.filter((request) => request.retry_attempt > 0).length,
            last_error: lastError,
            requests_made: requests,
        }
    throw new Error(`Unsupported action: ${action}`)
}

async function controlLoop() {
    await AsyncStorage.clear()
    await nativeFetch(`${controllerURL}/native/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sdk_name: 'posthog-react-native',
            sdk_version: sdkVersion,
            adapter_version: '1.0.0',
            capabilities: ['capture_v0'],
            platform: Platform.OS,
            runtime: global.HermesInternal ? 'Hermes' : 'JavaScriptCore',
        }),
    })
    for (;;) {
        const response = await nativeFetch(`${controllerURL}/native/command`)
        if (response.status === 204) continue
        const command = await response.json()
        let result
        let status = 200
        try {
            result = await execute(command.action, command.input)
        } catch (error) {
            status = 500
            result = { success: false, error: error.message }
        }
        await nativeFetch(`${controllerURL}/native/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: command.id, status, result }),
        })
    }
}

AppRegistry.registerComponent(
    'PosthogReactNativePluginExample',
    () => () => React.createElement(Text, null, 'PostHog RN compliance')
)
controlLoop().catch((error) => console.error('Native compliance controller failed', error))
