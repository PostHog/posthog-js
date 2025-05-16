import { BUSINESS_NAME } from './constants'

export function SystemAvatar() {
    return (
        <div
            style={{
                width: 32,
                height: 32,
                borderRadius: 32,
                backgroundColor: '#1D4AFF',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <img
                src="https://bizplanner.ai/BizPlannerAI_NB.svg"
                alt={BUSINESS_NAME}
                style={{
                    width: 32,
                    height: 32,
                }}
            />
        </div>
    )
}
