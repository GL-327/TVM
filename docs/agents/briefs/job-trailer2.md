Job: TVM TRAILER v2, a 30-second vertical ad that SELLS TVM. Do not explain it.

Version 1 is at .../scratchpad/trailer/; reuse its code (three.js scene, render pipeline, captions, music). "..." means C:/Users/Gathe/AppData/Local/Temp/claude/2a87d3438d861033/72474aba-ceea-4eb0-b9e6-a829fd8b4dfa.

Owner feedback on v1: "close, but the voice doesn't sound natural (the pauses between words and sentences), the model should be closer to the reference girl, make it a trailer to sell it rather than explain it, make jokes but learn the timing, make her as attractive as a polygon girl can be (wider hips and such, like the reference), and make the intro shorter and snappier so it's recognisable and memorable."

Tools installed for you, so read and use them:
- C:/Users/Gathe/.claude/skills/animate/SKILL.md: procedural canvas animation to MP4 via headless browser and FFmpeg, beat-mapped audio, 9:16. Use its kit and its beat-mapping ideas.
- C:/Users/Gathe/.claude/skills/gsap-timeline/SKILL.md and gsap-core: timeline, easing and stagger patterns, for snappy motion.
- C:/Users/Gathe/.claude/skills/remotion-captions/SKILL.md: caption timing and styling ideas (no need to adopt Remotion).
- C:/Users/Gathe/.claude/skills/motion-design/SKILL.md: motion-design principles.

The owner's choices:
1. Voice: Kokoro (open source, local).
   - Use `kokoro-onnx` (pip, in .../scratchpad/trailer/venv) with its official model and voices files from its GitHub releases.
   - Use a young, warm, playful female voice; try af_heart, af_bella and af_nicole, and pick the most natural.
   - NATURAL TIMING is the main fix:
     - Generate each line separately.
     - Place them on a timeline with deliberate, human pauses: about 150-250 ms between phrases, 350-500 ms before a punchline, and a beat after a joke.
     - Vary the speed slightly per line (0.95-1.1).
     - Trim each clip's leading and trailing silence precisely.
     - Captions follow the real clip timings: get word timings by splitting the duration by syllables, or with an alignment tool if one is easy.
   - If Kokoro cannot install, fall back to edge-tts en-US-AvaNeural, with SSML breaks and the same per-line timeline, and say so in the report.
2. Length: 30 seconds.
   - 0-2 s, hook: the signature opener "Lights off, newbie." Make it memorable: a lights-click SFX, the room goes dark, her eyes glint, then a smirk.
   - 2-24 s: sell it in five or six punchy beats, each cut on the beat.
     - every film and show in one app, in up to 4K
     - free live TV and a TV guide
     - it works on your TV, phone and PC
     - franchise intros (flash the Hunger Games and Doomsday intro frames from .../scratchpad/shots/intros/)
     - Liquid Glass looks
     - your stuff syncs everywhere
   - Two jokes with proper timing, each with a set-up, a pause, the punchline and a reaction shot (her deadpan or eyebrow raise). For example:
     - "Built by two friends and a small army of AIs… [pause] …who all ran out of credits at 3am."
     - "It's basically Netflix. [beat] But it doesn't ask if you're still watching. [beat] We know you are."
   - 24-30 s: the call to action and end card. "TVM. Lights off. Press play." The logo, a sting, then "Stay comfy."
3. Opener: "Lights off, newbie." Never "Hey rookie".
4. Look: an original character in the stylish anime low-poly TikTok style.
   - Dark black bob with coloured tips (teal/purple), big expressive eyes with highlights, a confident smirk.
   - Cropped bomber jacket over a fitted top, high-waist jeans.
   - A curvier, stylised figure: defined waist and wider hips, an attractive anime proportion.
   - Keep it tasteful and non-sexual: no suggestive poses or framing; the camera stays on upper body to mid-thigh.
   - Better shading than v1: flat-shaded facets with a rim light, soft shadow and slightly higher poly-count where it matters (face, hair).
   - She gestures on key words: a point, a hand flick, a lean-in, a wink on the last line.

Other notes:
- Music: a punchy beat bed with hits on the cuts, ducked under the voice. Procedural only, nothing copyrighted.
- Output: 1080x1920, 30 fps, H.264 + AAC, ≤ 12 MB.
  - Write it to .../scratchpad/trailer/TVM-trailer-v2.mp4
  - Then replace C:\Users\Gathe\Desktop\TVM\apps\ui\public\media\tvm-trailer.mp4 with it.
- Before finishing:
  - Make a contact sheet every 1 s (.../scratchpad/trailer/contact-v2.png) and look at it.
  - Check the voice timeline numerically (silences between lines) and fix anything off.
  - Then run, in apps/ui: `npx vitest run` and `corepack pnpm run build`.
- Never run git commands that change state.

Reply under 10 lines: the voice used, the duration and size, the paths, and anything you could not do.
