import { useColorScheme as useRNColorScheme } from 'react-native'

export function useColorScheme() {
    const colorScheme = useRNColorScheme()
    return colorScheme === 'unspecified' ? null : colorScheme
}
