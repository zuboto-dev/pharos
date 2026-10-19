#!/usr/bin/env bash
# Runs the built Pharos server (API, MCP, and the built web app) as a launchd user agent on
# macOS, so it starts at login, restarts if it ever exits, and logs to ~/.pharos/server.log.
#
#   pnpm service install     build, then install and start the service (re-run after pulling)
#   pnpm service status      is it loaded, running, and answering?
#   pnpm service restart     restart it (for example after `pnpm build`)
#   pnpm service stop        stop it until the next `start` or login
#   pnpm service start       start it again
#   pnpm service log         follow its log
#   pnpm service uninstall   stop it and remove the launchd job
#
# PORT, PHAROS_DB, PHAROS_AGENT_COMMAND, PHAROS_AGENT_LOG, and PHAROS_WEB_URL set while installing
# are stored in the job; re-run `install` to change them.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LABEL=dev.pharos.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="${PHAROS_SERVER_LOG:-$HOME/.pharos/server.log}"
PORT="${PORT:-4300}"
DOMAIN="gui/$(id -u)"
HEALTH="http://127.0.0.1:$PORT/api/health"

fail() { echo "pharos-service: $*" >&2; exit 1; }

require_macos() {
  [ "$(uname -s)" = Darwin ] || fail "this uses launchd and only works on macOS; run 'pnpm build' and 'pnpm --filter @pharos/server start' under your own supervisor instead"
}

pnpm_cmd() {
  if command -v pnpm >/dev/null 2>&1; then echo pnpm; return; fi
  local version
  version=$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$ROOT/package.json")
  echo "npx -y pnpm@${version:-latest}"
}

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }

env_entry() { # name value
  printf '      <key>%s</key>\n      <string>%s</string>\n' "$1" "$(printf '%s' "$2" | xml_escape)"
}

write_plist() {
  local node path entries=''
  node=$(command -v node) || fail "node is not on PATH"
  # launchd starts with a minimal PATH: include where node and the answering agent (claude) live.
  path="$(dirname "$node"):/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  if command -v claude >/dev/null 2>&1; then path="$(dirname "$(command -v claude)"):$path"; fi
  entries+=$(env_entry PATH "$path")$'\n'
  entries+=$(env_entry HOME "$HOME")$'\n'
  entries+=$(env_entry PORT "$PORT")$'\n'
  # Lets Settings say how to change the port under the service.
  entries+=$(env_entry PHAROS_SERVICE 1)$'\n'
  local name
  for name in PHAROS_DB PHAROS_AGENT_COMMAND PHAROS_AGENT_LOG PHAROS_WEB_URL; do
    if [ -n "${!name:-}" ]; then entries+=$(env_entry "$name" "${!name}")$'\n'; fi
  done
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(printf '%s' "$node" | xml_escape)</string>
    <string>$(printf '%s' "$ROOT/apps/server/dist/index.js" | xml_escape)</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(printf '%s' "$ROOT/apps/server" | xml_escape)</string>
  <key>EnvironmentVariables</key>
  <dict>
$entries  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(printf '%s' "$LOG" | xml_escape)</string>
  <key>StandardErrorPath</key>
  <string>$(printf '%s' "$LOG" | xml_escape)</string>
</dict>
</plist>
PLIST
}

loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

# bootout returns before launchd has finished removing the job; a bootstrap in that window fails
# with "5: Input/output error". Wait for the job to go, and retry a few times.
bootstrap() {
  local i
  for i in $(seq 1 20); do loaded || break; sleep 0.25; done
  for i in 1 2 3 4 5; do
    if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then return 0; fi
    sleep 1
  done
  launchctl bootstrap "$DOMAIN" "$PLIST"
}

wait_healthy() {
  local i
  for i in $(seq 1 40); do
    if curl -sf -m 1 "$HEALTH" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  return 1
}

do_install() {
  require_macos
  echo "Building..."
  (cd "$ROOT" && $(pnpm_cmd) build >/dev/null)
  [ -f "$ROOT/apps/server/dist/index.js" ] || fail "build did not produce apps/server/dist/index.js"
  if curl -sf -m 1 "$HEALTH" >/dev/null 2>&1 && ! loaded; then
    fail "something is already answering on port $PORT (pnpm dev?); stop it first, or install with another PORT"
  fi
  write_plist
  if loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  bootstrap
  if wait_healthy; then
    echo "Pharos is running at http://localhost:$PORT (MCP: http://localhost:$PORT/mcp)"
    echo "It starts at login and restarts if it exits. Log: $LOG"
  else
    echo "The service was installed but is not answering yet. Last log lines:" >&2
    tail -n 20 "$LOG" >&2 || true
    exit 1
  fi
}

do_uninstall() {
  require_macos
  if loaded; then launchctl bootout "$DOMAIN/$LABEL"; fi
  rm -f "$PLIST"
  echo "Removed the $LABEL service."
}

# `stop` unloads the job (KeepAlive would otherwise restart it); `start` loads it again.
do_start() {
  require_macos
  [ -f "$PLIST" ] || fail "not installed (pnpm service install)"
  if loaded; then launchctl kickstart "$DOMAIN/$LABEL"; else bootstrap; fi
  wait_healthy && echo "Running at http://localhost:$PORT"
}

do_stop() {
  require_macos
  loaded || fail "not running"
  launchctl bootout "$DOMAIN/$LABEL"
  echo "Stopped. 'pnpm service start' (or logging in again) starts it."
}

do_status() {
  require_macos
  if ! loaded; then
    if [ -f "$PLIST" ]; then echo "Installed but stopped (pnpm service start)."; else echo "Not installed (pnpm service install)."; fi
    if curl -sf -m 1 "$HEALTH" >/dev/null 2>&1; then echo "Something else answers on port $PORT, though (pnpm dev?)."; fi
    exit 1
  fi
  launchctl print "$DOMAIN/$LABEL" | grep -E '^[[:space:]]*(state|pid|last exit code|runs) ' | sed 's/^[[:space:]]*//' || true
  if curl -sf -m 1 "$HEALTH" >/dev/null 2>&1; then
    echo "Healthy: http://localhost:$PORT"
  else
    echo "Not answering on port $PORT. Log: $LOG" >&2
    exit 1
  fi
}

case "${1:-}" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  start) do_start ;;
  stop) do_stop ;;
  restart) require_macos; loaded || fail "not installed (pnpm service install)"; launchctl kickstart -k "$DOMAIN/$LABEL"; wait_healthy && echo "Restarted: http://localhost:$PORT" ;;
  status) do_status ;;
  log) tail -n 50 -f "$LOG" ;;
  *) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
