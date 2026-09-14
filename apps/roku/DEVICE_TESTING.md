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
