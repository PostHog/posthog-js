import { aiSdkSpanMapper } from './aiSdk'
import type { PostHogSpanMapper } from '../types'

export const defaultSpanMappers: PostHogSpanMapper[] = [aiSdkSpanMapper]
export { aiSdkSpanMapper }
