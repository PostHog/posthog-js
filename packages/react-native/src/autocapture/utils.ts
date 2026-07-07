export const shouldIgnoreScreen = (currentRouteName: string, ignoreScreenNames?: string[]): boolean => {
  const normalizedRouteName = (currentRouteName || '').toLowerCase()
  const normalizedScreenNames = (ignoreScreenNames ?? []).map((screenName) => screenName?.toLowerCase()) || []

  const screenMatch = normalizedScreenNames.some((name: string) => name?.toLowerCase() === normalizedRouteName)

  return screenMatch
}
