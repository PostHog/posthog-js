import {
  chromeStackLineParser,
  ErrorCoercer,
  ErrorPropertiesBuilder,
  EventHint,
  geckoStackLineParser,
  ObjectCoercer,
  PrimitiveCoercer,
  PromiseRejectionEventCoercer,
  StringCoercer,
} from '@posthog/core/error-tracking'
import type { PostHog } from '../posthog-rn'
import { PostHogEventProperties } from '@posthog/core'

export class ErrorTracking {
  errorPropertiesBuilder: ErrorPropertiesBuilder

  constructor(private instance: PostHog) {
    this.errorPropertiesBuilder = new ErrorPropertiesBuilder(
      [
        new PromiseRejectionEventCoercer(),
        new ErrorCoercer(),
        new ObjectCoercer(),
        new StringCoercer(),
        new PrimitiveCoercer(),
      ],
      [chromeStackLineParser, geckoStackLineParser]
    )
  }

  captureException(input: unknown, additionalProperties: PostHogEventProperties, hint: EventHint) {
    const properties = this.errorPropertiesBuilder.buildFromUnknown(input, hint)
    return this.instance.capture('$exception', {
      ...properties,
      ...additionalProperties,
    } as unknown as PostHogEventProperties)
  }
}
