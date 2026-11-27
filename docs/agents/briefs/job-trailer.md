Job: TVM TRAILER, a vertical TikTok-style animated explainer video for TVM, the owner's home streaming app. It is for the owner and their friends' enjoyment.

Style:
- The popular TikTok format: a cute, stylised low-poly 3D girl narrator (big expressive eyes, faceted low-poly look, colourful hair) talking straight to camera with snappy cuts, punchy bold word-by-word captions and meme-ish energy.
- She explains a topic in a "here's how it actually works" tone.
- Keep her cute and wholesome: casual clothes, nothing suggestive.

Content: about 45-60 seconds, an honest, funny "how TVM actually works / how it got built" story. Don't hide what it is.
- TVM is a home-made streaming app built by two friends with an army of AI agents (Claude, Codex, Gemini, Copilot) running overnight.
- It runs on Windows, the web, iPhone, Android and Roku.
- It finds films through torrent indexes and streams them through the owner's Real-Debrid account.
- It has:
  - a Liquid Glass UI that was rebuilt about five times
  - Hunger Games and Doomsday intros
  - free live TV, a TV guide and a Hub
  - character avatars
  - account sync
  - a private dev dashboard
- Joke beats: the AIs running out of usage at 3am, the owner up at 7 for school, the "it looks like a database" review, the lag.
- End card: the TVM logo with "TVM. Watch everything." and a little sting.

Output:
- 1080x1920, 30 fps, H.264 + AAC MP4, under 20 MB.
- Write the master to <scratch>/trailer/TVM-trailer.mp4
- Then copy it to C:\Users\Gathe\Desktop\TVM\apps\ui\public\media\tvm-trailer.mp4

How to build it. Everything is local and procedural; use no copyrighted characters, music or footage.
1. Script and voice:
   - Write the script with per-scene notes.
   - Voice it with a natural neural voice: Python `edge-tts`, e.g. en-US-AvaNeural or en-GB-SoniaNeural, slightly fast and lively. Install it in a scratch venv under .../scratchpad/trailer/venv, never in the repo.
   - Get the word-boundary timings for captions.
   - If edge-tts fails, fall back to Windows SAPI (Microsoft Zira) via PowerShell System.Speech.
2. Character and scenes:
   - Use three.js (in a scratch folder, from npm) to build the low-poly girl procedurally: a faceted head, large anime-style eyes that blink, low-poly hair chunks, a simple torso and arms with idle sway, a mouth driven by the audio amplitude or word timings, and head tilts and gestures on key words.
   - Scenes: a cosy room, floating holographic panels showing real TVM screenshots, used as textures (screenshots are under .../scratchpad/shots/ and .../scratchpad/shots/intros/), and a server and agents montage.
   - Add fast cuts, zooms, emoji stickers and a subtle film grain.
3. Captions: bold white TikTok captions with a black stroke, 2-4 words at a time, popping in on each word, placed in the lower third.
4. Music: a generated or synthesised upbeat lo-fi/electronic bed made procedurally (Web Audio offline render, or simple synthesis with numpy/ffmpeg aevalsrc), ducked under the voice. No copyrighted music.
5. Render:
   - Render deterministically frame by frame in headless Chromium (playwright-core, `channel: 'chrome'`), stepping time manually; or render frames to PNG with node.
   - Encode with ffmpeg (on PATH) with the voice and music mixed. Check the result with ffprobe.

App integration, in C:\Users\Gathe\Desktop\TVM\apps\ui only (never touch other paths, never run git commands that change state):
- Settings > About: a "Watch the TVM trailer" row that opens a simple video player sheet playing /media/tvm-trailer.mp4.
- The Developer menu gets the same trailer, plus these extra developer tools:
  - a "Copy diagnostics" button (version, commit, user agent, viewport, FPS)
  - a "Clear local caches" button
  - a "Replay intro animations" button for the Hunger Games and Doomsday intros (apps/ui/src/intros)
  - a "Show layout grid" toggle
  - a "Force patch notes pop-up" button
- Afterwards these must pass: `npx vitest run`, `corepack pnpm run build`, and `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts --reporter=line` (all 48), all in apps/ui.

Before finishing, watch your own output: extract frames at 2 s intervals into a contact sheet (.../scratchpad/trailer/contact.png), look at it, and fix anything that looks broken or cheap.

Write a short report to .../scratchpad/reports/trailer.md.

Owner's notes, added later:
- Style reference: the TikTok format where a low-poly anime-style girl mentor explains how something works, with a close upper-body camera and quick cut-aways. Use only the format and energy; design an ORIGINAL character.
- Do NOT use the catchphrase "Hey rookie" (it belongs to another creator). Our narrator's own opener is "Okay, listen up, couch potato." Lead from it into "ever wondered how two friends built their own Netflix?", and sign off with "Stay comfy. TVM out."
- An earlier attempt produced nothing; start fresh in .../scratchpad/trailer/.
