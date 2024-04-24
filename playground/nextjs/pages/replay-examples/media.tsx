export default function Media() {
    return (
        <>
            <h1>Video</h1>
            <p>Useful testing for Replay handling video elements</p>
            <div style={{ margin: 10 }}>
                <h3>Video</h3>
                <video controls={true} style={{ width: 500 }}>
                    <source src="http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" />
                </video>
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
