Job: TRAILER v3, PREVIEW ONLY (Gemini). The full brief is `docs/agents/briefs/job-trailer3.md`: read it all. Codex never finished it and is out of usage.

Scratch folder on the owner's PC: `C:/Users/Gathe/AppData/Local/Temp/claude/2a87d3438d861033/72474aba-ceea-4eb0-b9e6-a829fd8b4dfa/scratchpad/trailer/`. v1 and v2 code, the Kokoro venv, the music and the caption code are there. If anything already exists in `trailer/v3-preview/`, look at it first and continue rather than restart.

## Make only the preview, then STOP for the owner's yes
1. **Model:** a real rigged VRM anime girl, loaded with three.js and @pixiv/three-vrm. The model's licence must allow modification and use in video; write the source URL and licence terms in the report.
   - Same TYPE as the reference TikTok narrator (stylised anime, curvy figure, expressive face), with her own look: dark bob with teal and purple tips, cropped bomber, high-waist jeans.
   - Toon shading with a rim light. Tasteful: no suggestive poses; framing stays upper body to mid-thigh.
   - Output: 4 stills at 1080x1920 (front close-up, three-quarter upper body, full body standing, mid-gesture) and a 5 s turntable MP4 with idle, blink and smile, in `trailer/v3-preview/`.
2. **Voice test** (~20 s each), using Kokoro: `voice-test.mp3` with af_heart and `voice-test-alt.mp3` with a second voice.
   - Fast TikTok pace, 170–190 wpm, 60–120 ms gaps, 200–300 ms before the punchline.
   - Lines: "Lights off, newbie. Ever wanted every film, every show, one app?", a quick joke with a beat, a WHISPER line ("psst… it doesn't ask if you're still watching"), and an excited line.
   - Whisper: slower and softer, filtered with ffmpeg (highpass, gentle compression, lower volume, a little air).
3. Write `reports/trailer3-preview.md` listing the files, the model source and licence, and the voices.

Never say "Hey rookie" (another creator's line). Our opener is "Lights off, newbie." Do NOT render the full trailer and do NOT touch the repo.
