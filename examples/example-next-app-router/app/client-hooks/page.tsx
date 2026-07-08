'use client'

import dynamic from 'next/dynamic'

const ClientHooksContent = dynamic(() => import('./ClientHooksContent'), { ssr: false })

export default function ClientHooksPage() {
    return <ClientHooksContent />
}
