import { useState } from 'react'
import { Button, StyleSheet, Text, View } from 'react-native'

import ParallaxScrollView from '@/components/ParallaxScrollView'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'

// httpbin.org/headers echoes the request headers back in the JSON response — perfect
// for eyeballing that `addTracingHeaders` actually reaches the network layer on device.
const LISTED_URL = 'https://httpbin.org/headers'

// postman-echo.com/headers also echoes headers but is NOT in the `addTracingHeaders`
// list in app/posthog.tsx, so the PostHog headers should NOT appear on this response.
const UNLISTED_URL = 'https://postman-echo.com/headers'

type Result = {
    url: string
    status?: number
    echoedHeaders?: Record<string, string>
    error?: string
}

export default function TracingHeadersScreen() {
    const [result, setResult] = useState<Result | null>(null)
    const [loading, setLoading] = useState(false)

    const runRequest = async (url: string): Promise<void> => {
        setLoading(true)
        setResult(null)
        try {
            const response = await fetch(url)
            const body = (await response.json()) as { headers?: Record<string, string> }
            setResult({ url, status: response.status, echoedHeaders: body.headers ?? {} })
        } catch (error) {
            setResult({ url, error: error instanceof Error ? error.message : String(error) })
        } finally {
            setLoading(false)
        }
    }

    return (
        <ParallaxScrollView
            headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
            headerImage={<IconSymbol size={310} color="#808080" name="link" style={styles.headerImage} />}
        >
            <ThemedView style={styles.titleContainer}>
                <ThemedText type="title">Tracing Headers</ThemedText>
            </ThemedView>
            <ThemedText>
                When `addTracingHeaders` is set on PostHog init, the SDK patches the global `fetch` to inject
                `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` on requests to the configured hostnames. This is
                used to link LLM traces and backend spans to the current PostHog session replay.
            </ThemedText>

            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Listed hostname (httpbin.org)</ThemedText>
                <ThemedText>
                    Echoes the request headers back. You should see `X-Posthog-Distinct-Id` and
                    `X-Posthog-Session-Id` in the response.
                </ThemedText>
                <Button onPress={() => void runRequest(LISTED_URL)} title="Fetch listed hostname" />
            </ThemedView>

            <ThemedView style={styles.sectionContainer}>
                <ThemedText type="subtitle">Unlisted hostname</ThemedText>
                <ThemedText>Same endpoint on a different host. The PostHog headers should NOT be added.</ThemedText>
                <Button onPress={() => void runRequest(UNLISTED_URL)} title="Fetch unlisted hostname" />
            </ThemedView>

            {loading && (
                <View style={styles.resultBox}>
                    <Text>Loading…</Text>
                </View>
            )}
            {result && !loading && (
                <View style={styles.resultBox}>
                    <Text style={styles.resultTitle}>Request: {result.url}</Text>
                    {result.error ? (
                        <Text style={styles.resultError}>Error: {result.error}</Text>
                    ) : (
                        <>
                            <Text style={styles.resultStatus}>Status: {result.status}</Text>
                            <Text style={styles.resultSubtitle}>Echoed headers:</Text>
                            {Object.entries(result.echoedHeaders ?? {}).map(([key, value]) => {
                                const isTracing = key.toLowerCase().startsWith('x-posthog-')
                                return (
                                    <Text
                                        key={key}
                                        style={[styles.resultHeader, isTracing && styles.resultHeaderTracing]}
                                    >
                                        {key}: {value}
                                    </Text>
                                )
                            })}
                        </>
                    )}
                </View>
            )}
        </ParallaxScrollView>
    )
}

const styles = StyleSheet.create({
    headerImage: {
        color: '#808080',
        bottom: -90,
        left: -35,
        position: 'absolute',
    },
    titleContainer: {
        flexDirection: 'row',
        gap: 8,
    },
    sectionContainer: {
        gap: 8,
        marginTop: 16,
    },
    resultBox: {
        marginTop: 16,
        padding: 12,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        gap: 4,
    },
    resultTitle: {
        fontWeight: '700',
    },
    resultStatus: {
        color: '#2e7d32',
        fontWeight: '600',
    },
    resultSubtitle: {
        marginTop: 6,
        fontWeight: '600',
    },
    resultHeader: {
        fontSize: 12,
        fontFamily: 'Courier',
    },
    resultHeaderTracing: {
        color: '#1565c0',
        fontWeight: '700',
    },
    resultError: {
        color: '#c62828',
    },
})
