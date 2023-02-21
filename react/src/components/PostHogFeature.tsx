import { useFeatureFlag } from '../hooks'

export type PostHogFeatureProps = {
    flag: string
    match?: string | boolean
    children: React.ReactNode | ((payload: any) => React.ReactNode)
}

export function PostHogFeature({ flag, match, children }: PostHogFeatureProps): React.ReactNode {
    const value = useFeatureFlag(flag)

    if (match === undefined || value === match) {
        return typeof children === 'function' ? children(value) : children
    }

    return null
}
