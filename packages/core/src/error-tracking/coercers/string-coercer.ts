import { ExceptionLike, ErrorTrackingCoercer, CoercingContext } from '../types'

const ERROR_TYPES_PATTERN =
  /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i

export class StringCoercer implements ErrorTrackingCoercer<string> {
  match(input: unknown): input is string {
    return typeof input === 'string'
  }

  coerce(input: string, ctx: CoercingContext): ExceptionLike {
    return {
      type: 'Error',
      value: input,
      stack: ctx.syntheticException?.stack,
      synthetic: true,
    }
  }

  getInfos(candidate: string): [string, string] {
    let type = 'Error'
    let value = candidate
    const groups = candidate.match(ERROR_TYPES_PATTERN)
    if (groups) {
      type = groups[1]
      value = groups[2]
    }
    return [type, value]
  }
}
