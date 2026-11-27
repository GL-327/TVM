#!/usr/bin/env bash
# Runs Codex builders (job:dir pairs) and stops them all if Codex usage reaches LIMIT (5h) or 85% (weekly).
SP=<scratch>; L=$SP/logs; LIMIT="${LIMIT:-80}"; EFFORT="${EFFORT:-high}"
jobs=()
for pair in "$@"; do job=${pair%%:*}; dir=${pair#*:}; jobs+=("$job"); [ -n "$MONITOR_ONLY" ] && continue; rm -f "$L/codex15-$job.exit"
  cat "$SP/brief/common.txt" "$SP/brief/job-$job.txt" > "$SP/brief/run15-$job.txt"
  (cd "$dir" && codex exec --json -c model_reasoning_effort=$EFFORT --sandbox danger-full-access - < "$SP/brief/run15-$job.txt" > "$L/codex15-$job.jsonl" 2> "$L/codex15-$job.err"; echo "exit $?" > "$L/codex15-$job.exit") &
  echo "started $job in $dir"
done
sleep 30
while true; do
  live=0; for j in "${jobs[@]}"; do [ -f "$L/codex15-$j.exit" ] || live=1; done
  for j in "${jobs[@]}"; do if [ -f "$L/codex15-$j.exit" ] && [ ! -f "$L/codex15-$j.told" ]; then touch "$L/codex15-$j.told"; echo "FINISHED $j: $(cat $L/codex15-$j.exit)"; exit 0; fi; done
  [ $live -eq 0 ] && exit 0
  read usage weekly < <(bash "$SP/codex-usage.sh")
  if [ "${usage%.*}" -ge "$LIMIT" ] || [ "${weekly%.*}" -ge 85 ]; then
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='codex.exe'\" | Where-Object { \$_.CommandLine -match ' exec ' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null
    echo "PAUSED at codex 5h=$usage% weekly=$weekly%"; exit 0
  fi
  sleep 30
done
