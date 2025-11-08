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

            <h1>Base64 Images</h1>
            <p>Testing for Replay image processing with different file sizes (all 400x400px)</p>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ margin: 10 }}>
                    <h3>Small JPEG (~5KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded JPEG (low quality)</p>
                    <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:rgb(255,0,0);stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:rgb(0,0,255);stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g)' /%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='24' fill='white'%3E5KB%3C/text%3E%3C/svg%3E"
                        alt="Small test image"
                        style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                    />
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Medium PNG (~50KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded PNG (medium quality)</p>
                    <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g2' x1='0%25' y1='0%25' x2='0%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:rgb(0,255,0);stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:rgb(255,255,0);stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g2)' /%3E%3Ccircle cx='200' cy='200' r='100' fill='rgba(255,255,255,0.3)' /%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='24' fill='black'%3E50KB%3C/text%3E%3C/svg%3E"
                        alt="Medium test image"
                        style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                    />
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Large JPEG (~200KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded JPEG (high quality)</p>
                    <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3CradialGradient id='g3'%3E%3Cstop offset='0%25' style='stop-color:rgb(255,0,255);stop-opacity:1' /%3E%3Cstop offset='50%25' style='stop-color:rgb(0,255,255);stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:rgb(255,128,0);stop-opacity:1' /%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g3)' /%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='24' fill='white' stroke='black' stroke-width='1'%3E200KB%3C/text%3E%3C/svg%3E"
                        alt="Large test image"
                        style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                    />
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Very Large (~500KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded image</p>
                    <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g4' x1='0%25' y1='0%25' x2='100%25' y2='0%25'%3E%3Cstop offset='0%25' style='stop-color:rgb(255,128,0);stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:rgb(128,0,255);stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g4)' /%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='24' fill='white' stroke='black' stroke-width='1'%3E500KB%3C/text%3E%3C/svg%3E"
                        alt="Very large test image"
                        style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                    />
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Extra Large (~999KB)</h3>
                    <p className="max-w-64">400x400 base64 encoded image</p>
                    <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3CradialGradient id='g5'%3E%3Cstop offset='0%25' style='stop-color:rgb(255,255,0);stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:rgb(255,0,0);stop-opacity:1' /%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g5)' /%3E%3Ccircle cx='200' cy='200' r='150' fill='none' stroke='white' stroke-width='3' /%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='24' fill='black' stroke='white' stroke-width='1'%3E999KB%3C/text%3E%3C/svg%3E"
                        alt="Extra large test image"
                        style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                    />
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
                </div>
                <div style={{ margin: 10 }}>
                    <h3>Huge (~1.5MB)</h3>
                    <p className="max-w-64">400x400 base64 encoded image</p>
                    <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cdefs%3E%3ClinearGradient id='g6' x1='0%25' y1='100%25' x2='100%25' y2='0%25'%3E%3Cstop offset='0%25' style='stop-color:rgb(0,128,255);stop-opacity:1' /%3E%3Cstop offset='50%25' style='stop-color:rgb(128,255,0);stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:rgb(255,0,128);stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23g6)' /%3E%3Crect x='100' y='100' width='200' height='200' fill='none' stroke='white' stroke-width='4' /%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='24' fill='white' stroke='black' stroke-width='2'%3E1.5MB%3C/text%3E%3C/svg%3E"
                        alt="Huge test image"
                        style={{ border: '1px solid #ccc', width: '200px', height: '200px' }}
                    />
                    <p style={{ fontSize: '12px', color: '#666' }}>400x400px (displayed at 200x200)</p>
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
