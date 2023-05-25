import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { PostHog } from '../context'


export type PostHogFeatureProps = {
    flag: string
    children: React.ReactNode | ((payload: any) => React.ReactNode)
    match?: string | boolean
    visibilityObserverOptions?: IntersectionObserverInit
}

export function PostHogFeature({ flag, match, children, visibilityObserverOptions }: PostHogFeatureProps): JSX.Element | null {
    const posthog = usePostHog()
    const payload = useFeatureFlagPayload(flag)
    const variant = useFeatureFlagVariantKey(flag)
    const [clickTracked, setclickTracked] = useState(false)

    if (match === undefined || variant === match) {
        const childNode: React.ReactNode = typeof children === 'function' ? children(payload) : children
        return (
            <div onClick={() => {
              if (!clickTracked) {
                trackClicks(flag, posthog)
                setclickTracked(true)
              }
            }}>
                <VisibilityTracker flag={flag} options={visibilityObserverOptions}>{childNode}</VisibilityTracker>
            </div>
        )
    }

    return null
}

function trackClicks(flag: string, posthog?: PostHog) {
    posthog?.capture('$feature_flag_clicked', { feature_flag: flag, $set: { [`$feature_interaction/${flag}`]: true } })
}

function trackVisibility(flag: string, posthog?: PostHog) {
    posthog?.capture('$feature_flag_viewed', { feature_flag: flag })
}

function VisibilityTracker({flag, children, options}: {flag: string, children: React.ReactNode, options?: IntersectionObserverInit}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const posthog = usePostHog()
    const [tracked, setTracked] = useState(false)

    const isIntersecting = useVisibleOnScreen(ref, {
        threshold: 0.1,
        ...options
    });

    if (isIntersecting && !tracked) {
        trackVisibility(flag, posthog)
        setTracked(true)
    }
  
    return (
      <div ref={ref}>
        {children}
      </div>
    );
};
  


const useVisibleOnScreen = (ref: RefObject<HTMLElement>, options?: IntersectionObserverInit) => {
  const [isIntersecting, setIntersecting] = useState(false);

  const observer = useMemo(() => new IntersectionObserver(
    ([entry]) => setIntersecting(entry.isIntersecting)
  , options), [ref, options])


  useEffect(() => {
    if (ref.current === null) return

    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])

  return isIntersecting
};

