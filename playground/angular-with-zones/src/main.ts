import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import posthog from 'posthog-js'

posthog.init(
  'sTMFPsFhdP1Ssg',
  {
    api_host:'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    loaded: posthog_instance => {
      (window as any).posthog = posthog_instance
      if (posthog.sessionRecording) {
      posthog.sessionRecording._forceAllowLocalhostNetworkCapture = true
      }
    }
  }
)

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
