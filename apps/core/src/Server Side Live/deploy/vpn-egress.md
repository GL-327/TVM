# VPN egress, without touching TVM

The job is one sentence: **make Core's outbound requests to IPTV providers
leave through NordVPN, so the friend's ISP sees encrypted traffic to one
endpoint instead of a list of IPTV hosts.**

Everything else on that box — SSH, package updates, the friend's other
services — and every part of TVM that clients touch must behave exactly as it
did before Nord was installed.

## The rule that decides the design

> A full-tunnel VPN client is the wrong tool here, and the reason is not
> routing — it is the kill switch.

With a plain full tunnel, LAN ingress usually still works: `192.168.1.0/24 dev
eth0` is a connected route and it is more specific than the default route the
tunnel installs. What breaks TVM is everything a VPN client does *around* the
route table. Nord's kill switch installs firewall rules that drop non-tunnel
traffic, and unless LAN discovery is explicitly enabled those rules do not
distinguish "a Roku on the sofa" from "a packet escaping to the ISP". DNS gets
redirected. IPv6 gets blackholed or, worse, left alone and leaking.

So the design below never puts TVM's own traffic near the tunnel at all.

## Recommended: egress-only, through a proxy in a VPN network namespace

Core stays exactly where it is — host network, `0.0.0.0:7345`, same bearer
token, same loopback. A WireGuard interface from Nord lives in its own network
namespace with a tiny HTTP proxy inside it, and Core is told to send *provider
fetches only* through that proxy.

```
            ┌─ host namespace ──────────────────────────────┐
  Roku ────▶│ Core :7345  ── LAN ingress, unchanged          │
  Phones ──▶│     │                                          │
            │     └── provider fetches ──▶ 127.0.0.1:8888 ───┼──┐
            │                                                │  │
            │  SSH, apt, friend's services ──▶ eth0 ─────────┼──┼─▶ ISP
            └────────────────────────────────────────────────┘  │
                     ┌─ netns "tvmvpn" ────────────────────────┐ │
                     │ proxy :8888 ──▶ wg0 (Nord) ──▶ internet │◀┘
                     │ no other route: if wg0 is down, nothing │
                     │ leaves — that *is* the kill switch      │
                     └─────────────────────────────────────────┘
```

**Why this one.** The kill switch is structural rather than a firewall rule
somebody has to maintain: the namespace has exactly one route and it is the
tunnel. If WireGuard drops, provider fetches fail. They cannot fall back to the
friend's IP, because in that namespace there is no other way out.

And TVM's LAN path is not merely preserved, it is *untouched* — no `ip rule`,
no policy table, no firewall rule anywhere near port 7345. Nothing that can be
reordered later and silently break a Roku.

**Cost.** Core must be told to use the proxy. On Node 24 that is two
environment variables (below). It is one indirection, and it is the price of
the LAN path never being in the blast radius.

### The other two options, and why they are second and third

**Policy routing by UID.** Run Core as its own user, `ip rule add uidrange
… lookup vpn`. Tempting because it needs no proxy — but `ip rule` is consulted
*before* the route table, so replies to LAN clients from Core's sockets get
sent to the VPN table too. It works only if you remember to add the LAN subnet
to that table as well, and forgetting is invisible until a Roku stops playing.
It also tunnels all of Core's egress, including update checks, so a tunnel
outage takes updates down with it. Use it only if a proxy is impossible.

**Sidecar container (`network_mode: service:vpn`).** The standard Docker
pattern and genuinely good for pure-egress workloads — but TVM has LAN ingress,
and a published port into a VPN'd container needs the container to route
replies back to the Docker bridge rather than out the tunnel (gluetun's
`FIREWALL_OUTBOUND_SUBNETS` exists for exactly this). It is one more thing that
must stay correct for the Roku to keep working. Fine if you already run this
pattern; not what I would introduce for a household appliance.

## Set-up

Export a WireGuard config from Nord (their NordLynx private key, or the
config generator in your account area) to `/etc/wireguard/tvmvpn.conf`, then:

```bash
sudo install -m 0755 tvm-egress-netns.sh /usr/local/sbin/tvm-egress-netns
sudo /usr/local/sbin/tvm-egress-netns start
```

Point Core at the proxy. Node 24 honours the standard proxy variables for its
built-in `fetch` when told to:

```bash
# /etc/tvm/core.env
NODE_USE_ENV_PROXY=1
HTTPS_PROXY=http://127.0.0.1:8888
HTTP_PROXY=http://127.0.0.1:8888
NO_PROXY=127.0.0.1,localhost,192.168.0.0/16,10.0.0.0/8
TVM_LIVE_EGRESS_PROXY=http://127.0.0.1:8888
```

`NO_PROXY` is not optional. Without it Core would try to reach its own loopback
and the LAN through the tunnel, which is the one way this design could break
the thing it was built to protect.

`TVM_LIVE_EGRESS_PROXY` sets no behaviour on its own — it is the declaration
that egress *should* be tunnelled, so `/api/live/egress` can tell a broken
tunnel apart from a box that never had one.

## The tests that matter

Run all five. Number 4 is the one that decides whether this was worth doing.

### 1. LAN still sovereign

From another machine on the LAN, with Nord running:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TVM_LAN_TOKEN" \
  http://192.168.1.10:7345/api/live/sources
```

Expect `200`. This is a Roku-shaped request: same header, same port, same
route. If it is anything else, stop and undo — the VPN has reached a path it
must not be on.

### 2. Loopback unchanged

On the box:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7345/api/live/sources
```

Expect `200`, with no token.

### 3. Egress is Nord

```bash
curl -s http://127.0.0.1:7345/api/live/egress
# {"ok":true,"ip":"185.xxx.xxx.xxx","ms":210,"expectsProxy":true}

curl -s https://api.ipify.org   # the box's own address, for comparison
```

The first address must be Nord's and must differ from the second. If they
match, the proxy is not in the path and every provider request is going out in
the clear.

### 4. No leak when Nord drops — the important one

```bash
sudo ip netns exec tvmvpn wg-quick down tvmvpn   # or: sudo /usr/local/sbin/tvm-egress-netns stop
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7345/api/live/egress
```

Expect **503**. A `200` here means the kill switch is not working: Core reached
the internet without the tunnel, and the friend's ISP just saw it. That is the
failure this whole exercise exists to prevent, and it is silent — the app
carries on looking perfectly healthy while the privacy is gone.

Then bring it back and confirm TVM never noticed:

```bash
sudo /usr/local/sbin/tvm-egress-netns start
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7345/api/live/sources   # 200 throughout
```

### 5. Nothing else moved

```bash
ip route show                       # default route unchanged, still via eth0
curl -s https://api.ipify.org       # the box's normal egress, not Nord
sudo apt-get update                 # normal
ss -tulpn | grep 7345               # still bound as before
```

SSH proves itself by the session you are typing in staying up.

## Per-client summary

| Client | Path to Core | Auth | VPN on this path? |
| --- | --- | --- | --- |
| Roku | LAN, `http://<lan-ip>:7345` | `Authorization: Bearer <TVM_LAN_TOKEN>` | **No.** Unchanged. Not reachable off-LAN, which is accepted |
| Android | LAN, bearer → `tvm_lan_session` cookie | Existing contract | **No.** Unchanged |
| iOS standalone | Bundled on-device Core | None needed | **No.** No VPN dependency at all |
| iOS "home Core" | LAN, same as Android | Existing contract | **No.** Unchanged |
| Electron / appliance | Loopback | None | **No.** No VPN dependency |

Only Core's *outbound* fetch to a provider is tunnelled. Nothing a client does
touches the VPN, and nothing about TVM depends on the VPN being up — with the
tunnel down, Live TV stops and everything else keeps working.

## Remote access is out of scope

NordVPN does not do inbound port forwarding, so it cannot be how you reach Core
off-LAN, and nothing here tries to make it. LAN-only for Roku and phones is the
accepted position. If off-LAN access is wanted later it needs a separate tool —
Tailscale or a reverse tunnel — and it should be added knowing that Core's LAN
contract is what would be exposed.

## Risk and Nord-specific quirks

Stated plainly, because a surprise here is expensive:

- **Provider account risk.** Some IPTV panels bind a subscription to an IP or
  region and will treat a sudden change — or a datacentre address, which every
  VPN exit is — as sharing. The practical outcome is a blocked line rather than
  a warning. Pick one Nord server and stay on it; a line that hops between
  countries every reconnect looks exactly like a shared one.
- **Nord's terms.** NordVPN permits normal personal use and does not forbid
  streaming, but it forbids using the service for unlawful purposes, and
  sustained high-volume traffic can attract attention on any consumer VPN.
  This setup is one household watching its own subscription, which is ordinary
  use. It stops being ordinary the moment Core is reachable from outside the
  LAN and other people are watching through it — that is redistribution, it is
  a different legal question entirely, and it is why remote access is out of
  scope above rather than an optional extra.
- **DNS.** The commonest leak. Resolving a provider hostname on the host while
  fetching it through the tunnel tells the ISP's resolver every panel you use,
  even though the traffic itself is encrypted. In the namespace design the
  proxy resolves inside the namespace, using the tunnel's DNS — verify with
  `sudo ip netns exec tvmvpn cat /etc/resolv.conf` and do not let it say the
  router's address.
- **IPv6.** The second commonest. If the box has IPv6 and the tunnel is v4-only,
  a provider with an AAAA record is reached over v6 outside the tunnel and the
  kill switch never sees it. The namespace has no v6 route, which closes this —
  but confirm with `sudo ip netns exec tvmvpn ip -6 route show` returning
  nothing.
- **Reconnects.** NordLynx re-keys and can change exit address. Test 3 after a
  reconnect, not only after a fresh boot.
- **This is privacy from the ISP, not anonymity.** Nord can see the traffic the
  ISP cannot. That is the trade being made, and it is the right one for the
  stated goal — the friend's connection is not the one carrying identifiable
  IPTV traffic — but it is a trade, not an erasure.
