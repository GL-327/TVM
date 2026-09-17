Synthetic test video for the IPTV tester: FFmpeg's `testsrc2` pattern with a
caption, and a 660 Hz sine tone. No third-party content.

Three two-second MPEG-TS segments (H.264 Main 3.0, AAC-LC stereo), each
starting on a keyframe, so a browser, VLC and Media3 can all play them.
Named `.mpegts` rather than `.ts` so TypeScript never tries to read them.

    ffmpeg -f lavfi -i "testsrc2=size=480x270:rate=25" \
      -f lavfi -i "sine=frequency=660:sample_rate=48000" -t 6 \
      -vf "drawtext=text='TVM IPTV tester':fontcolor=white:fontsize=26:box=1:boxcolor=0x5b2ee0@0.85:boxborderw=10:x=(w-text_w)/2:y=h-th-24" \
      -c:v libx264 -preset veryfast -profile:v main -level 3.0 -pix_fmt yuv420p \
      -g 50 -keyint_min 50 -sc_threshold 0 -b:v 220k -maxrate 260k -bufsize 440k \
      -c:a aac -b:a 64k -ac 2 \
      -f hls -hls_time 2 -hls_list_size 0 -hls_segment_filename "seg%d.ts" playlist.m3u8

Then rename `segN.ts` to `segN.mpegts`. The loop is six seconds long; the
panel shifts every timestamp by six seconds per loop.
