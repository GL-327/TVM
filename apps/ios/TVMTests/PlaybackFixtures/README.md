Synthetic five-second moving test pattern and sine wave generated with FFmpeg.
No third-party video content. Used by the simulator decoder smoke test.

- MP4 and MKV: H.264 video, AAC audio (identical elementary streams).
- WebM: VP9 video, Opus audio.
- MPEG-TS: MPEG-2 video, MP2 audio.

Source command:

    ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 5 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart sample.mp4

Remux with `-c copy sample.mkv`; transcode with `-c:v mpeg2video -c:a mp2
-f mpegts sample.ts` and `-c:v libvpx-vp9 -deadline realtime -cpu-used 8
-b:v 250k -c:a libopus sample.webm`.
