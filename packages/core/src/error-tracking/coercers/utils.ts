export function truncate(str: string, max: number = 0): string {
  if (typeof str !== 'string' || max === 0) {
    return str
  }
  return str.length <= max ? str : `${str.slice(0, max)}...`
}
