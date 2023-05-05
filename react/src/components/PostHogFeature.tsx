import { useFeatureFlagPayload, useFeatureFlagVariantKey, usePostHog } from '../hooks'
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { PostHog } from '../context'


export type PostHogFeatureProps = {
    flag: string
    match?: string | boolean
    children: React.ReactNode | ((payload: any) => React.ReactNode)
}

export function PostHogFeature({ flag, match, children }: PostHogFeatureProps): JSX.Element | null {
    const posthog = usePostHog()
    const payload = useFeatureFlagPayload(flag)
    const variant = useFeatureFlagVariantKey(flag)


    if (match === undefined || variant === match) {
        const childNode: React.ReactNode = typeof children === 'function' ? children(payload) : children
        return (
            <div onClick={() => trackClicks(flag, posthog)}>
                <VisibilityTracker flag={flag}>{childNode}</VisibilityTracker>
            </div>
        )
    }

    return null
}

function trackClicks(flag: string, posthog?: PostHog) {
    console.log('posthog in clicks is: ', posthog)
    posthog?.capture('$feature_flag_clicked', { feature_flag: flag })
}

function trackVisibility(flag: string, posthog?: PostHog) {
    console.log('posthog in visibility is: ', posthog)
    posthog?.capture('$feature_flag_viewed', { feature_flag: flag })
}

function VisibilityTracker({flag, children}: {flag: string, children: React.ReactNode}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const posthog = usePostHog()

    const isIntersecting = useVisibleOnScreen(ref, {
    //   rootMargin: '-200px',
      threshold: 0.1,
    });

    console.log(isIntersecting)
    if (isIntersecting) {
        trackVisibility(flag, posthog)
    }
  
    return (
      <div ref={ref}>
        {isIntersecting ? 'Visible!' : 'Not Visible'}
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

