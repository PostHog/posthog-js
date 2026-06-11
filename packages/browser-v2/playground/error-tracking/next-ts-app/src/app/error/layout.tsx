import React, { Suspense } from 'react'

export default function ErrorLayout({ children }: React.PropsWithChildren): React.JSX.Element {
    // Only needed when using search params
    return <Suspense>{children}</Suspense>
}
