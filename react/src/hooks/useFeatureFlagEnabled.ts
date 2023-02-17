import { useFeatureFlag } from './useFeatureFlag'

export function useFeatureFlagEnabled(flag: string): boolean | undefined {
    const result = useFeatureFlag(flag)
    return result === undefined ? undefined : !!result
}
