# Deploying Server Side Live

Order matters: TVM first and working, VPN second. If the VPN goes on before you
have seen Live TV play without it, a failure could be either one and you will
not know which.

## 1. Core, no VPN yet

```bash
cd /srv/tvm
cat > .env <<'EOF'
TVM_LAN_TOKEN=<openssl rand -hex 24>
EOF
chmod 600 .env

docker compose -f apps/core/src/"Server Side Live"/deploy/docker-compose.yml up -d
curl -s http://127.0.0.1:7345/api/health
```

Comment out the four proxy variables in the compose file for now — Core will
try to use a proxy that does not exist yet and every provider fetch will fail.

## 2. Add a playlist

Loopback only, because the body carries provider credentials.

```bash
curl -X PUT http://127.0.0.1:7345/api/live/sources \
  -H 'content-type: application/json' \
  -d '{
        "url": "https://panel.example/get.php?username=U&password=P&type=m3u_plus",
        "profile": {
          "id": "panel",
          "referer": "https://panel.example/",
          "userAgent": "VLC/3.0.20 LibVLC/3.0.20",
          "extra": { "X-Panel-Key": "abc" }
        }
      }'
# {"ok":true,"channels":412}
```

The `profile` is a fallback. Most panels already state their requirements
inside the M3U — `#EXTVLCOPT:http-user-agent=…`, `#EXTHTTP:{…}` — and those are
parsed per channel and win over this.

Confirm the UI's view names no provider:

```bash
curl -s http://127.0.0.1:7345/api/live/sources | head -c 400
# {"channels":[{"id":"ch_1a2b3c4d","name":"Sky Sports","group":"Sports",
#   "play":"/api/live/proxy/9f86d081884c7d65…"}], "stats":{…}}
```

There is no upstream URL in that response and no place to put one. Play a
channel on the desktop and on one LAN client before going near the VPN.

## 3. VPN egress

Follow `vpn-egress.md`, then uncomment the proxy variables and
`docker compose up -d` again. Run all five tests in that document. Test 4 — kill
the tunnel, confirm `/api/live/egress` returns 503 rather than the friend's own
address — is the one that decides whether any of it was worth doing.

## Rollback

Each step undoes independently, which is the reason for doing them in this
order.

**VPN only** — Live TV returns to leaving via the ISP; TVM is otherwise
unaffected:

```bash
sudo /usr/local/sbin/tvm-egress-netns stop
# comment out NODE_USE_ENV_PROXY / HTTP_PROXY / HTTPS_PROXY / NO_PROXY
docker compose up -d
curl -s http://127.0.0.1:7345/api/live/egress   # now the box's own address
```

**The whole module** — Core reverts to the behaviour it had before, because
nothing outside `Server Side Live/` changed except one dispatch line:

```bash
git revert <commit>
docker compose up -d
```

The stored playlist and the token secret are left alone by a revert. Remove
them explicitly if you want them gone:

```bash
docker compose exec core rm -f /var/lib/tvm/live-sources.json /var/lib/tvm/secrets/live-proxy-key
```

## Stable URLs, and rotating them

A proxy token is `HMAC-SHA256(secret, profileId ‖ url)`. The same channel
always derives the same token, so:

- **Across restarts** a URL a player is holding still resolves. The secret is
  on disk in the sealed store; only losing `/var/lib/tvm` changes it.
- **On demand** you can invalidate every URL at once:

```bash
curl -X POST http://127.0.0.1:7345/api/live/rotate     # loopback only
```

Rotation stops playback in flight. That is deliberate: rotation exists for a
URL that has escaped, and one that lets existing sessions finish is not a
rotation. Clients recover by asking `/api/live/sources` again.

## Worked example

Provider manifest, needing a `Referer` and a panel key:

```
https://panel.example/live/1234/index.m3u8
Referer: https://panel.example/
X-Panel-Key: abc
```

What a client is given:

```
http://192.168.1.10:7345/api/live/proxy/9f86d081884c7d659a2feaa0c55ad015
```

What comes back, after Core fetched the real manifest with those headers:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-KEY:METHOD=AES-128,URI="/api/live/proxy/4b227777d4dd1fc61c6f884f"
#EXTINF:6.000,
/api/live/proxy/ef2d127de37b942baad06145e54b0c61
#EXTINF:6.000,
/api/live/proxy/e7f6c011776e8db7cd330b54174fd76f
```

Each of those is fetched back through Core under the same header profile. The
player never learns that `panel.example` exists, and neither does the UI, the
Roku zip, or a crash report.

## Watch out for

- **`TVM_CORE_BIND=0.0.0.0` needs `TVM_LAN_TOKEN`.** Core binds loopback by
  default and that default is the safe one. Opening it to the LAN without a
  token would publish provider streams to every device on the network.
- **Keep `.env` out of git.** `TVM_LIVE_COOKIE` and `TVM_LAN_TOKEN` are
  credentials. The repo rule is that no secret is ever committed, and a
  compose file with a real cookie in it is a committed secret.
- **`/var/lib/tvm` must persist.** It holds the sealed token secret and the
  channel list. A fresh volume rotates every proxy URL and forgets the panel.
- **Manifest cache TTL stays low.** Raising `TVM_LIVE_CACHE_MANIFEST_MS` above
  a channel's target duration hands players segments that have already rolled
  out of the live window, and they stall. If a channel misbehaves, set
  `TVM_LIVE_CACHE=off` first — a cache is always the first suspect.
- **This module discovers nothing.** It fetches URLs it was handed and rewrites
  manifests. No indexing, no scraping, no magnets — the repo rule stands.
