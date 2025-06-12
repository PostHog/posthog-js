'use client'
import { useSearchParams } from 'next/navigation'

export default function ErrorPage() {
    const params = useSearchParams()
    const message = params.get('messsage')
    if (message) {
        throw new Error(message)
    }
    return <div>Nothing happened</div>
}
