import { includes } from './string-utils'

export function isWebKit(userAgent: string): boolean {
  return includes(userAgent, 'AppleWebKit') && !includes(userAgent, 'Chrome')
}
