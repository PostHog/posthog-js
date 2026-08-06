---
'posthog-js': patch
'@posthog/types': patch
---

Add `session_recording.maskMediaAudio` to mute page media in replays. PostHog captures no audio (no `getUserMedia`/`MediaRecorder`/`AudioContext`), but rrweb serializes each `<audio>`/`<video>` element's `muted`/`volume`/playing state and the replayer restores it at playback time, re-fetching the page's own media and playing it with sound - which can look like captured audio. Set `maskMediaAudio: true` to force media elements (and media interactions) to record muted at volume 0 so audible playback state never leaves the page; visual playback is unaffected, and unlike `blockClass: 'ph-no-capture'` the element is not blanked. Defaults to `false`.
