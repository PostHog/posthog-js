'use client'

import { Player } from '@lottiefiles/react-lottie-player'

export default function Content() {
    return (
        <>
            <Player
                src="https://lottie.host/7401522f-2d8b-4049-ad18-eb0edb6af224/CE9lFrNlEH.json"
                // className="ph-no-capture"
                background="Transparent"
                speed={3}
                style={{ width: 300, height: 300 }}
                direction={1}
                // mode="normal"
                loop
                // controls
                autoplay
            />
            <Player
                src="https://lottie.host/fb187981-8846-4ae9-98db-b95fc6347955/vO2S1YTZMn.json"
                // className="ph-no-capture"
                background="Transparent"
                speed={3}
                style={{ width: 300, height: 300 }}
                direction={1}
                // mode="normal"
                loop
                // controls
                autoplay
            />
            <Player
                src="https://lottie.host/3239c7de-e4de-4148-830d-e95b7f747f91/vftYOWDcUO.json"
                // className="ph-no-capture"
                background="Transparent"
                speed={3}
                style={{ width: 300, height: 300 }}
                direction={1}
                // mode="normal"
                loop
                // controls
                autoplay
            />
        </>
    )
}
