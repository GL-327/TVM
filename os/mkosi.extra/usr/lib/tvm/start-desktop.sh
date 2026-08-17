#!/bin/sh
# Optional Linux desktop behind TVM. The kiosk is the product; this session
# exists so Settings can open the OS without leaving a desktop on the TV at boot.
set -eu

DATA="${TVM_DATA_DIR:-/var/lib/tvm}"
export XDG_CONFIG_HOME="$DATA/desktop-xdg"
export XDG_CACHE_HOME="$DATA/desktop-cache"
mkdir -p "$XDG_CONFIG_HOME/labwc" "$XDG_CONFIG_HOME/waybar" "$XDG_CACHE_HOME"
cp -a /usr/lib/tvm/desktop/labwc/. "$XDG_CONFIG_HOME/labwc/"
cp -a /usr/lib/tvm/desktop/waybar/. "$XDG_CONFIG_HOME/waybar/"

exec labwc
