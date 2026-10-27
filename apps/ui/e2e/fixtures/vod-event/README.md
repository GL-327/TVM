# Growing film playlist fixture

This is a 32-second, silent H.264 fixture derived from `e2e/sample.mp4`.
It deliberately uses fragmented MP4 and an EVENT playlist, like Core's film
conversion sessions. The browser regression serves only the first two segments
initially and adds segments while playback proceeds.

The regression verifies finite film time, pause/resume without seeks, and idle
controls. It exercises the actual HLS decoder, rather than mocking media events.

Generated with FFmpeg using libx264, `-stream_loop -1 -t 32 -an -preset ultrafast
-crf 36 -g 48 -sc_threshold 0 -f hls -hls_time 2 -hls_list_size 0
-hls_playlist_type event -hls_segment_type fmp4`.
