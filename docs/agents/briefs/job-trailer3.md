Job: TVM TRAILER v3. "..." means C:/Users/Gathe/AppData/Local/Temp/claude/2a87d3438d861033/72474aba-ceea-4eb0-b9e6-a829fd8b4dfa. Reuse v2 at .../scratchpad/trailer/: the script, Kokoro voice setup (venv), music and caption code, plus job-trailer2.txt for the content.

The owner's feedback on v2: "not quite what I want. I want the correct voice timings like the reference and the exact same character type as her, model-wise, just with unique features." The reference is the TikTok creator @kingpinrin's narrator: a proper 3D anime-style girl model (VRoid/MMD-like, toon or low-poly shading, an expressive face, a curvy stylised figure), close upper-body framing, gestures, and fast, rhythmic narration. Do not copy that creator's character, name or catchphrase. Ours opens "Lights off, newbie."

1. Character: use a REAL rigged anime model, not procedural primitives.
   - Use three.js + @pixiv/three-vrm with a VRM model whose licence allows modification and use in a video. Check the licence and record it in the report. Good sources:
     - the VRoid Hub CC0 / "allow modification and redistribution" models
     - pixiv's three-vrm sample models
     - Booth free VRM models marked as allowing modification
   - Customise her to be unique: dark bob with teal/purple tips, cropped bomber jacket, high-waist jeans, eye colour. Change the material colours, and swap or edit textures if needed.
   - Keep the same model type and proportions as the reference style: stylised anime with a curvy figure.
   - Style: toon/cel shading with a rim light; optionally a flat-shaded, low-poly look via material flatShading.
   - Animation:
     - lip sync from the audio (VRM expression "aa/ih/ou/ee/oh" driven by the amplitude and phoneme timings)
     - blinks
     - idle sway
     - head tilts
     - gestures (pose the humanoid bones with keyframes, or use VRMA animations with a compatible licence)
   - Keep it tasteful: no suggestive poses.
2. Voice timing to match TikTok narrators: fast, punchy and continuous.
   - About 170-190 words per minute.
   - Pauses between phrases of only 60-120 ms; 200-300 ms before a punchline.
   - Short sentences with no dead air, and no breaths left in.
   - Kokoro af_heart (or af_bella) at speed 1.1-1.2.
   - The whole read should feel like one confident breath per beat.
   - Captions word by word on exact timings.
3. Edit: 25-30 s, 1080x1920, 30 fps, H.264 + AAC, ≤ 12 MB.
   - Make her BIG in frame, upper body filling the lower two-thirds. Screenshots pop in beside her, never shrinking her.
   - Hook: "Lights off, newbie." with a light-click SFX, the room dark and her eyes glinting.
   - Then the selling beats and the two jokes, with snappy cuts on the music.
4. Output:
   - Write .../scratchpad/trailer/TVM-trailer-v3.mp4
   - Upload it to the `media` GitHub release as `tvm-trailer.mp4` (the lead does this; the apps stream it from there)
   - Make a contact sheet every 1 s (contact-v3.png), and look at it.
   - Never run git commands that change state.

Report to .../scratchpad/reports/trailer3.md: the model used and its licence, the voice settings, the duration and size.

Owner's change, which overrides the above: do a PREVIEW ONLY, then STOP. The owner approves before the trailer is made.
1. Model preview:
   - Choose and customise the VRM character as described.
   - Render 4 stills at 1080x1920: front close-up, three-quarter upper body, full body standing, and mid-gesture.
   - Render a 5-second turntable MP4 with an idle animation, a blink and a smile.
   - Save them as .../scratchpad/trailer/v3-preview/model-*.png and model-turntable.mp4.
2. Voice test, in .../scratchpad/trailer/v3-preview/voice-test.mp3 (about 20 s):
   - Use Kokoro, the voice you'd use. Include a second take with an alternative voice as voice-test-alt.mp3.
   - Include, in order:
     - normal fast TikTok narration ("Lights off, newbie. Ever wanted every film, every show, one app?")
     - a quick joke with a proper short pause before the punchline
     - a WHISPER line ("psst… it doesn't ask if you're still watching")
     - an excited line
   - Get the whisper effect with a softer, breathier delivery: Kokoro at a lower speed, filtered with ffmpeg (highpass, gentle compression, lower volume, slight air/noise).
   - Show natural pauses: short between phrases, a longer one before the punchline.
3. Write .../scratchpad/reports/trailer3-preview.md listing the files, the model's source and licence, and the voices used. Then STOP. Do NOT render the trailer and do NOT touch the repo.
