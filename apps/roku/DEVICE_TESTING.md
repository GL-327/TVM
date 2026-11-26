# Roku device acceptance — required before calling the channel verified

Status: channel implementation and local validation are in progress. A physical
Roku has not been tested; the user's Roku is not yet in developer mode.

The desktop TV preview is not the Roku runtime. No browser check can certify Roku
remote focus, firmware compatibility, hardware decoder support or LAN reachability.

- [ ] Enable Roku developer mode, accept its agreement and set a developer password.
- [ ] Start Core with LAN binding and a random `TVM_LAN_TOKEN` of at least 32 characters.
- [ ] Allow Core on the Windows **private** network and confirm both devices share that network.
- [ ] Install `tvm-roku.zip` and enter the computer's LAN Core URL, then the matching token.
- [ ] Confirm wrong token is rejected, correct token loads Home, and restart remembers settings.
- [ ] Exercise remote directions, OK, Back, search, details, episodes, profiles and watchlist.
- [ ] Play a permitted HLS channel and a permitted on-demand MP4; verify sound, pause,
  resume, seeking, progress saving and returning to Home. Test actual IPTV/debrid sources.
- [ ] Interrupt a stream: after 45 seconds the channel must show a recoverable message.
- [ ] Check Home and Back while buffering; confirm returning does not leave audio playing.
- [ ] Test artwork loading and scrolling on the target Roku model.

Roku codec support varies by model and firmware. A successful package build does
not establish playback compatibility for every hoster file. `tvm-roku.zip` is a
local package-script output; it is not a committed or Channel Store binary.
Without ffmpeg on the Core host, many non-MP4 sources will not play. Review
unsupported formats using the Roku developer console (`telnet ROKU-IP 8085`)
after installation.

The LAN token is saved in the device's private channel registry; the Roku registry
is not an encrypted secret vault. Never embed it in `config.json`, distribute it
with the package, or expose a development Core to the internet. This version is
a sideloaded zip talking HTTP on a trusted private LAN. It is not a Channel
Store or HTTPS product.


## Manual remote script: Home, Details, Play, Back (redesign R1)

Run on a real Roku, ideally one HD (720p) and one FHD (1080p) box. Record the
model, firmware, resolution and pass/fail for each step.

1. Cold start into Home. The hero is full-bleed, the title is left aligned, and
   Play is focused. Nothing is clipped at the screen edges. Text is readable
   from the sofa at 720p.
2. Up to the strip. Left / Right slide one highlight; at Home and at the
   profile orb the highlight stops (no wrap). The active tab is a filled pill
   without a ring; the focused one has the ring.
3. OK on Movies, then Series: the Library is filtered by kind and the strip
   shows the matching tab. Live TV opens the live screen. Library opens the
   library. Search opens the keyboard.
4. OK on the profile orb: the You side panel opens. Walk every row. TVM Hub
   opens the Hub screen (see the TVM Hub script below). Sources lists studio hubs,
   Real-Debrid, Live picks, Live TV playlist and Inputs; each one opens.
5. Back to Home. Down from the hero: Continue Watching is the first rail, wide
   cards with progress. Play something, press Back out of the player, then
   Back again. Focus returns to the same Continue Watching title even though it
   has moved to the front of the rail.
6. Press Right along a long rail: it scrolls without stutter and stops at the
   last card. Wait more than 90 seconds on a card: focus must not jump.
7. OK on Play in the hero. Playback starts without a details stop. Back from the
   player goes to Home on the Play pill.
8. OK on Details. Play (or Resume), My List (toggles to In My List) and Back
   all respond. For a series, Down reaches seasons, OK opens episodes, OK on an
   episode plays it. Back from the player returns to the same episode; Back
   again returns to Seasons; Back again to Home on the tile you came from.
9. Settings: turn Reduce Motion on. Focus changes no longer scale or slide, but
   the ring still moves and order is unchanged. Turn Reduce Transparency on:
   pills, strip and You menu become opaque ink with a clear edge. Restart the
   channel: both settings persist.
10. Open the developer console (telnet ROKU-IP 8085) and run `r2d2_bitmaps`
    on Home (idle hero: one hero texture), on Details, and after scrolling a
    rail. Poster bitmaps should be about 400x225 (landscape) and 300x450
    (portrait), not 1280x720 or 780x1170. Note the memory total.
11. Leave Home idle for five minutes: no animation should be running in the
    background (there are none by design) and the box should stay cool.

## Manual remote script: TVM Hub, Network and remote control (redesign R2/R3)

Needs Core with the Hub routes (`/api/hub/v1`) and at least two installations on
one account: this Roku plus a second Roku, the web app or the Windows app.
Without Core, do steps 1 to 4 with demo data (Settings > TVM Hub demo data).

1. Demo data first. Settings: turn TVM Hub demo data on. Open You > TVM Hub.
   The title reads TVM Hub, a "Demo data" chip sits by the tabs, and the
   Network tab shows the account orb with six device nodes and a "+1 more"
   node. Labels stay upright; nodes toward the back are slightly smaller.
2. D-pad on the graph: Left, Right, Up and Down always land on a neighbouring
   node in the direction pressed (no jumps across the plane). Up from a top
   node reaches the tab strip. Right from the right edge enters the inspector.
   Down from a bottom node reaches Add device. Left from the left-most node
   stays put. Focus lifts a node and lights its spoke. OK on "+1 more" opens
   the Devices tab.
3. Tabs: Left and Right on the strip only move the highlight; nothing loads
   until OK. Down enters the content; Back returns to the tab strip; Back on
   the strip leaves TVM Hub. Open Devices: sort (Name, Last seen, Room) cycles
   with OK; Graph returns to Network. Move into the inspector: the selected
   row or node stays dimly marked. Every action reads "Demo data" and does
   nothing. Activity lists readable sentences.
4. Turn Reduce Motion on and reopen the Hub: nodes sit at full size, no slide
   or lift, focus order unchanged. Turn demo data off again.
5. Real data, this Roku. Open TVM Hub. This Roku is a node marked "This device"
   with a remote-attached chip. Its inspector offers Rename, Set room and Sign
   out only. Rename to a new name: the row shows Sending, then Done, and the
   node label changes in place without moving. Wait 30 seconds: nothing
   reshuffles when the heartbeat lands.
6. Second device. Start playback on the second device. Within 15 seconds its
   node turns green (Playing) and its inspector shows the title and a bar.
   Switch to another profile on the viewer: the card must disappear and the
   state must still read Playing (restricted scope).
7. Remote, Pause: select the second device, choose Pause. The row shows
   Sending, Received, then Done and the device pauses. Resume does the
   reverse. Take the device offline: Pause and Open remote read "Offline".
8. Open remote: arrows, OK, Options (*) and Play/Pause control the other
   device. Each press flashes the key and shows Sending then Done. Rewind and
   Fast forward skip 10 seconds if the device has playback.skip. Back closes
   the remote. A device without nav.dpad has no Open remote row.
9. This Roku as the target. From the second device (or the web Hub) send
   Pause, Resume, a seek, Left, Right, OK and Back to this Roku while it plays
   and while it sits on Home. Commands arrive within about 3 seconds. With no
   player open, Pause is rejected with "Nothing is ready to control there".
   play.title starts the title here.
10. Add device (approving another device). OK on Add device. Enter the 8
    character code from the other device with the arrows and OK; Delete and
    Clear work. A wrong code says "That code was not found". Five wrong codes
    in a row say to wait 15 minutes. A real code shows the requesting device's
    name and platform; Approve signs it in and it appears in the Hub within
    15 seconds; Deny removes the request. An old code says it has expired.
11. Sign in with a code (this Roku). Sign out in Settings, then on the account
    screen choose Sign in with a code. A code and address appear. Approve it
    from a signed-in device. The Roku lands on Home signed in with no typing
    and the Hub lists it once, not twice. Cancel with Back also works.
12. Remove device. Select another device, choose Remove device and confirm.
    The node leaves the graph, focus moves to the closest remaining neighbour
    (or the account orb when none is left), and the removed device's next call
    fails with device_revoked. Remove this Roku from another device: within a
    heartbeat this Roku returns to sign-in with a notice.
13. Hub unavailable. Point Core at a build without the Hub routes (or stop the
    Hub): TVM Hub shows "TVM Hub is not available" with Retry; Retry works
    once Core has the routes.
14. Memory. With the Hub open and six devices, run `r2d2_bitmaps`: the orb
    texture appears once, not once per node.

## Accounts and Extras acceptance

- [ ] Upgrade a Roku with old local account/session/RD registry keys. Confirm
  those keys are deleted and a fresh service sign-in is required.
- [ ] Register a disposable test member through the channel, sign in while
  waiting, activate it through the owner's separate admin dashboard, recheck,
  accept terms and sign out. Reopen to confirm session persistence/revocation.
  Check offline, invalid password, expired session and rate-limit messages.
- [ ] Save, retrieve and clear an RD token for an active account. Confirm only
  the session token is persisted locally, and no developer entry or seven-Info
  unlock remains. Never put real credentials in screenshots or logs.
- [ ] Play a known IntroDB episode (Breaking Bad S1E1 has intro and credits).
  Check Off/Button/Auto, start/end boundaries, eight-second expiry, OK, remote
  seek and a second segment. An unknown title must show no assumed recap skip.
- [ ] Test an anime with no IntroDB data and valid AniList/AniSkip mapping.
- [ ] At credits check the next episode thumbnail/title, ten-second countdown,
  Play now, Cancel, Back to cancel, autoplay Off, pause/resume, and panels open.
  For unknown credits check the last-30-seconds fallback. Final or unaired next
  episodes must not autoplay. Resume an episode inside the credits as well.
- [ ] In Control Centre choose an OpenSubtitles language and Off, return to a
  second episode, change profile, and check each profile's remembered choice.
  Verify firmware accepts late sidecar subtitleTracks updates while playing,
  UTF-8 text, SRT timing and captions during quality fallback.
- [ ] Open a film collection, browse Left/Right and OK into another film, then
  Back to the same collection card. Check restricted profiles and missing data.
- [ ] Check Coming up dates and New episodes this week against TVmaze. Switch
  profiles while requests are running: old results must not appear.
- [ ] Your stats: play/pause/seek, finish a title, change profiles, reopen the
  channel, then Clear history (Cancel and Confirm). Check totals, UTC day
  boundaries, streak, genre ranking and remote paging through history.
- [ ] Disable networking during each Extras request. Main playback/navigation
  must keep working; unavailable optional metadata disappears quietly.

These checks require Roku hardware; compiler and off-device fixture tests do
not establish firmware playback or remote-focus acceptance.

## 1.4.3 focus and decoder acceptance

- [ ] Settings: visit every category including About and the admin-only Developer
  category. Search with the keyboard, cancel, search with no results, clear the
  search, open a value list and Back twice. Toggle a switch and move segments
  both ways. Reorder/hide Home rows and check that focus follows the moved row.
- [ ] Guide: try no channels, a filter with no matches, and channels with no EPG.
  Keep one time position while moving Up/Down and jumping eight channels with
  Rewind/FastForward. Move Left through the start of the loaded window, tune
  with OK, focus Watch with Options, then return with Up. Open Channels and Back.
  Leave while entering a channel number: the old tune timer must not fire later.
- [ ] Profiles: toggle Kids, change age both ways, browse all set/character
  windows, choose the colour/initial, enter/delete four PIN digits, and cancel.
  Check missing character images, selected rings and long character names.
- [ ] New release: arrive at Settings before config returns, then return Home.
  Notes must appear once, after any existing modal closes. Read all pages of a
  long release (including known issues), then close with OK and with Back.
- [ ] Player: Options, Control Centre, Sleep timer, Back to Playback, Audio and
  subtitles, then Versions. Back from Versions keeps video running and returns
  to the menu. Choose another version and verify resume position. Play/Pause
  must work with each panel open. Test remote-injected keys as well as the handset.
- [ ] Compare HD and 4K devices, SDR/HDR output, and a receiver with/without DTS.
  Check original-language/native-resolution selection and reject known cam,
  upscale, AVI/Xvid and TrueHD-only examples. Confirm the original RD download is
  used. Assign an RD key after opening TVM without one; retry without restarting.
- [ ] Reduce transparency makes art-backed panels opaque. Check generated rims
  on nav, buttons, Settings, guide, notices and player panels at 720p and 1080p.

These additions have only been traced statically; none is a hardware pass.
