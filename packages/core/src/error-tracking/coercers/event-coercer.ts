import { isEvent } from '@/utils'
import { CoercingContext, ErrorTrackingCoercer, ExceptionLike } from '../types'

export class EventCoercer implements ErrorTrackingCoercer<Event> {
  match(err: unknown): err is Event {
    return isEvent(err)
  }

  coerce(err: Event, ctx: CoercingContext): ExceptionLike {
    return {
      type: 'Error',
      value: 'Event captured as exception',
      stack: ctx.syntheticException?.stack,
      synthetic: true,
    }
  }
}
