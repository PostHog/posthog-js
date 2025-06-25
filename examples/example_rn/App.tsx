// In index.js of a new project
import React from 'react';
import {View, Text, Button, StyleSheet} from 'react-native';
import {Navigation} from 'react-native-navigation';
import {SharedPostHogProvider} from './posthog';

// Home screen declaration
export const HomeScreen = (props: any) => {
  return (
    <SharedPostHogProvider>
      <View style={styles.root}>
        <Text>Hello React Native Navigation 👋</Text>
        <Button
          title="Push Settings Screen"
          color="#710ce3"
          onPress={() =>
            Navigation.push(props.componentId, {
              component: {
                name: 'Settings',
                passProps: {
                  id: `${Math.round(Math.random() * 100000)}`,
                },
                options: {
                  topBar: {
                    title: {
                      text: 'Settings',
                    },
                  },
                },
              },
            })
          }
        />

        <Button
          title="Push Settings Modal"
          color="#710ce3"
          onPress={() =>
            Navigation.showModal({
              stack: {
                children: [
                  {
                    component: {
                      name: 'Settings',
                      passProps: {
                        id: `${Math.round(Math.random() * 100000)}`,
                        isModal: true,
                      },
                      options: {
                        topBar: {
                          title: {
                            text: 'Settings',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            })
          }
        />
      </View>
    </SharedPostHogProvider>
  );
};
HomeScreen.options = {
  topBar: {
    title: {
      text: 'Home',
      color: 'white',
    },
    background: {
      color: '#4d089a',
    },
  },
};

// Settings screen declaration - this is the screen we'll be pushing into the stack
export const SettingsScreen = (props: any) => {
  return (
    <SharedPostHogProvider>
      <View style={styles.root}>
        <Text ph-label="special-text">Press me!</Text>

        {props.id && (
          <Text>
            This is a screen with id: <Text ph-label="id">{props.id}</Text>
          </Text>
        )}
      </View>
    </SharedPostHogProvider>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'whitesmoke',
  },
});
