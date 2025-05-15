export function ChatBubbleXMarkHeroIcon({ isVisible }: { isVisible: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-6"
            style={{
                visibility: isVisible ? 'visible' : 'hidden',
                transition: 'all 0s ease 0s!important',
                position: 'absolute',
                top: 0,
                left: 0,
                width: 24,
                height: 24,
            }}
        >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
    )
}
