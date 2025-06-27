// In index.js of a new project
import {Navigation} from 'react-native-navigation';
import {HomeScreen, SettingsScreen} from './App';

Navigation.registerComponent('Home', () => HomeScreen);
Navigation.registerComponent('Settings', () => SettingsScreen);
Navigation.events().registerAppLaunchedListener(() => {
  setRoot();
});

function setRoot() {
  Navigation.setRoot({
    root: {
      bottomTabs: {
        id: 'BOTTOM_TABS_LAYOUT',
        children: [
          {
            stack: {
              id: 'Home',
              children: [
                {
                  component: {
                    id: 'Home',
                    name: 'Home',
                  },
                },
              ],
              options: {
                bottomTab: {
                  text: 'Home',
                },
              },
            },
          },
          {
            stack: {
              id: 'Settings',
              children: [
                {
                  component: {
                    id: 'Settings',
                    name: 'Settings',
                  },
                },
              ],
              options: {
                bottomTab: {
                  text: 'Settings',
                },
              },
            },
          },
        ],
      },
      stack: {
        children: [
          {
            component: {
              name: 'Home',
            },
          },
        ],
      },
    },
  });
}