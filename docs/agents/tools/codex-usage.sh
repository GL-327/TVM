#!/usr/bin/env bash
# Prints "<5h%> <weekly%>" from recent Codex sessions, ignoring windows that have already reset.
now=$(date -u +%s); p=0; w=0
for f in $(ls -t ~/.codex/sessions/2026/*/*/*.jsonl | head -12); do
  line=$(grep -o '"primary":{"used_percent":[0-9.]*,"window_minutes":[0-9]*,"resets_at":[0-9]*' "$f" | tail -1)
  [ -z "$line" ] && continue
  pct=$(echo "$line" | grep -o 'used_percent":[0-9.]*' | cut -d: -f2); rs=$(echo "$line" | grep -o 'resets_at":[0-9]*' | cut -d: -f2)
  [ "$rs" -gt "$now" ] && [ "${pct%.*}" -gt "$p" ] && p=${pct%.*}
  line2=$(grep -o '"secondary":{"used_percent":[0-9.]*,"window_minutes":[0-9]*,"resets_at":[0-9]*' "$f" | tail -1)
  pct2=$(echo "$line2" | grep -o 'used_percent":[0-9.]*' | cut -d: -f2); rs2=$(echo "$line2" | grep -o 'resets_at":[0-9]*' | cut -d: -f2)
  [ -n "$rs2" ] && [ "$rs2" -gt "$now" ] && [ "${pct2%.*}" -gt "$w" ] && w=${pct2%.*}
done
echo "$p $w"
