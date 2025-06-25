import { usePostHog } from 'posthog-react-native'
import React, { useEffect, useState } from 'react'
import { Alert, FlatList, StyleSheet, TouchableOpacity, View, Text } from 'react-native'

// NOTE: This would obviously need to be something like Redux in production
export const GLOBAL_EVENTS: { event: string; payload: any }[] = []

export const usePostHogDebugEvents = () => {
  const posthog = usePostHog()
  const [localEvents, setLocalEvents] = useState(GLOBAL_EVENTS)

  useEffect(() => {
    const onEvent = (event: string, payload: any) => {
      // console.log('On event', event, payload)
      GLOBAL_EVENTS.push({
        event,
        payload,
      })
      setLocalEvents([...GLOBAL_EVENTS])
    }

    const listeners = [
      posthog.on('capture', (e) => onEvent('capture', e)),
      posthog.on('identify', (e) => onEvent('identify', e)),
      posthog.on('screen', (e) => onEvent('screen', e)),
      posthog.on('autocapture', (e) => onEvent('autocapture', e)),
      posthog.on('featureflags', (e) => onEvent('featureflags', e)),
      posthog.on('flush', (e) => onEvent('flush', e)),
    ]

    return () => {
      listeners.forEach((x) => x())
    }
  }, [posthog])

  return localEvents
}

export default function PostHogDebugScreen() {
  const localEvents = usePostHogDebugEvents()
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text testID="title" style={styles.title}>
          PostHog Debugger
        </Text>

        <Text>It may be useful for local debugging to listen to posthog events.</Text>
      </View>
      <FlatList
        style={styles.list}
        data={localEvents}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => Alert.alert(item.event, JSON.stringify(item.payload, null, 2))}
          >
            <>
              <Text style={styles.itemEvent}>{item.event}</Text>
              <Text style={styles.itemPayload}>{JSON.stringify(item.payload).substring(0, 100) + '...'}</Text>
            </>
          </TouchableOpacity>
        )}
        keyExtractor={(item) => localEvents.indexOf(item).toString()}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },

  list: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,.1)',
  },

  item: {
    // flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,.1)',
    paddingVertical: 10,
    // alignItems: 'center',
    padding: 20,
  },

  itemEvent: {
    fontWeight: 'bold',
    marginRight: 20,
    marginBottom: 5,
  },

  itemPayload: {},
})
