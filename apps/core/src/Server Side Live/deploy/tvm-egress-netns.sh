#!/usr/bin/env bash
#
# Scoped VPN egress for TVM: a WireGuard tunnel and an HTTP proxy in their own
# network namespace, so Core's provider fetches leave through Nord and nothing
# else on the box moves.
#
# The kill switch is the design, not a rule: inside the namespace the tunnel is
# the only route. If WireGuard is down, provider fetches fail. They cannot fall
# back to the host's address, because in here there is no other way out.
#
# Nothing in this script touches the host route table, the host firewall, or
# port 7345. TVM's LAN path is deliberately outside the blast radius.
#
#   tvm-egress-netns start|stop|status|test
#
set -euo pipefail

NS="${TVM_EGRESS_NS:-tvmvpn}"
WG_CONF="${TVM_EGRESS_WG_CONF:-/etc/wireguard/${NS}.conf}"
WG_IF="${TVM_EGRESS_WG_IF:-${NS}}"
PROXY_PORT="${TVM_EGRESS_PROXY_PORT:-8888}"
VETH_HOST="veth-${NS}0"
VETH_NS="veth-${NS}1"
HOST_ADDR="10.201.0.1"
NS_ADDR="10.201.0.2"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }

start() {
  need ip; need wg-quick; need tinyproxy
  [ -f "$WG_CONF" ] || { echo "no WireGuard config at $WG_CONF" >&2; exit 1; }

  ip netns list | grep -qx "$NS" && { echo "$NS already up"; return 0; }

  ip netns add "$NS"
  ip netns exec "$NS" ip link set lo up

  # A veth pair carries only the proxy port. It is not a default route: the
  # namespace must never be able to reach the internet except through wg0.
  ip link add "$VETH_HOST" type veth peer name "$VETH_NS"
  ip link set "$VETH_NS" netns "$NS"
  ip addr add "${HOST_ADDR}/30" dev "$VETH_HOST"
  ip link set "$VETH_HOST" up
  ip netns exec "$NS" ip addr add "${NS_ADDR}/30" dev "$VETH_NS"
  ip netns exec "$NS" ip link set "$VETH_NS" up

  # The tunnel, brought up inside the namespace. wg-quick writes the default
  # route here and nowhere else.
  ip netns exec "$NS" wg-quick up "$WG_CONF"

  # No IPv6 route at all. A provider with an AAAA record must not be reachable
  # outside the tunnel — that leak is invisible and the kill switch never sees
  # it, so the address family is removed rather than filtered.
  ip netns exec "$NS" sysctl -qw net.ipv6.conf.all.disable_ipv6=1 || true

  ip netns exec "$NS" tinyproxy -c /dev/stdin <<CONF
Port ${PROXY_PORT}
Listen ${NS_ADDR}
Timeout 600
Allow ${HOST_ADDR}
DisableViaHeader Yes
LogLevel Warning
CONF

  # Host side: forward loopback:PROXY_PORT into the namespace, so Core can keep
  # talking to 127.0.0.1 and know nothing about any of this.
  need socat
  setsid socat "TCP-LISTEN:${PROXY_PORT},bind=127.0.0.1,fork,reuseaddr" \
    "TCP:${NS_ADDR}:${PROXY_PORT}" >/dev/null 2>&1 &
  echo "$NS up — proxy on 127.0.0.1:${PROXY_PORT}"
}

stop() {
  pkill -f "TCP-LISTEN:${PROXY_PORT},bind=127.0.0.1" 2>/dev/null || true
  if ip netns list | grep -qx "$NS"; then
    ip netns exec "$NS" wg-quick down "$WG_CONF" 2>/dev/null || true
    ip netns del "$NS"
  fi
  ip link del "$VETH_HOST" 2>/dev/null || true
  echo "$NS down"
}

status() {
  ip netns list | grep -qx "$NS" && echo "namespace: up" || { echo "namespace: down"; return 1; }
  ip netns exec "$NS" wg show "$WG_IF" 2>/dev/null | head -5 || echo "wireguard: not up"
  ip netns exec "$NS" ip route show
  echo -n "ipv6 routes (must be empty): "
  ip netns exec "$NS" ip -6 route show | wc -l
}

# The leak test, run from the host exactly as an operator would.
run_test() {
  echo "-- egress through the tunnel --"
  ip netns exec "$NS" curl -s --max-time 10 https://api.ipify.org || echo "(failed)"
  echo
  echo "-- this box without the tunnel, for comparison --"
  curl -s --max-time 10 https://api.ipify.org || echo "(failed)"
  echo
  echo "-- the namespace resolver (must not be the router) --"
  ip netns exec "$NS" cat /etc/resolv.conf 2>/dev/null || true
  echo "-- Core's own view --"
  curl -s --max-time 15 http://127.0.0.1:7345/api/live/egress || echo "(core not answering)"
  echo
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  test) run_test ;;
  *) echo "usage: $0 start|stop|status|test" >&2; exit 2 ;;
esac
