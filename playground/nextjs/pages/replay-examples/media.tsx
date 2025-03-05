import Hls from 'hls.js'
import { useEffect, useRef } from 'react'

export default function Media() {
    const hlsVideoEl = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        const videoEl = hlsVideoEl.current
        if (videoEl) {
            if (Hls.isSupported()) {
                const hls = new Hls()
                hls.loadSource('https://d2zihajmogu5jn.cloudfront.net/big-buck-bunny/master.m3u8')
                hls.attachMedia(videoEl)
            } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                videoEl.src = 'https://d2zihajmogu5jn.cloudfront.net/big-buck-bunny/master.m3u8'
            }
        }
    }, [hlsVideoEl])

    return (
        <>
            <h1>Images</h1>
            <p>Useful testing for Replay handling image elements</p>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ margin: 10 }}>
                    <h3>Image (no overload)</h3>
                    <p className="max-w-64">
                        No overload means we can see the image, but it's not as detailed as if we were blocking it
                    </p>
                    <img src="https://cataas.com/cat?width=200" />
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Image (ignored)</h3>
                    <p className="max-w-64">
                        Ignoring only affects input elements, so we can still see the image even though it matches
                    </p>
                    <img className="ph-ignore-image" src="https://cataas.com/cat?width=200" />
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Image (blocked)</h3>
                    <p className="max-w-64">
                        Blocking only affects images that match the selector, so we can not see the image even though it
                        matches
                    </p>
                    <img className="ph-block-image" src="https://cataas.com/cat?width=200" />
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Image (blocked - default class)</h3>
                    <p className="max-w-64">
                        Blocking only affects images that match the default blockClass, so we can not see the image even
                        though it matches
                    </p>
                    <img className="ph-no-capture" src="https://cataas.com/cat?width=200" />
                </div>
            </div>

            <h1>Video</h1>
            <p>Useful testing for Replay handling video elements</p>
            <div style={{ margin: 10 }}>
                <h3>Video</h3>
                <video controls={true} style={{ width: 500 }}>
                    <source src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" />
                </video>
            </div>

            <div style={{ margin: 10 }}>
                <h3>HLS Video</h3>
                <video
                    ref={hlsVideoEl}
                    controls={true}
                    style={{ width: 500 }}
                    hls-src="https://d2zihajmogu5jn.cloudfront.net/big-buck-bunny/master.m3u8"
                />
            </div>

            <div style={{ margin: 10 }}>
                <h3>Audio</h3>
                <audio controls={true}>
                    <source
                        src="https://github.com/rafaelreis-hotmart/Audio-Sample-files/raw/master/sample.mp3"
                        type="audio/mp3"
                    />
                </audio>
            </div>
        </>
    )
}
