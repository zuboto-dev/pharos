#!/usr/bin/env bash
# Runs the built Pharos server (API, MCP, and the built web app) as a launchd user agent on
# macOS, so it starts at login, restarts if it ever exits, and updates itself when `main` moves.
#
#   pnpm service install          deploy main, install and start the service, turn on autoupdate
#   pnpm service status           is it loaded, running, answering, and on which commit?
#   pnpm service update           deploy main now if it moved (what autoupdate runs)
#   pnpm service autoupdate on|off  follow main automatically, or stop following it
#   pnpm service restart          restart it
#   pnpm service stop             stop it until the next `start` or login
#   pnpm service start            start it again
#   pnpm service log              follow its log
#   pnpm service uninstall        stop it and remove both launchd jobs and the deploy copies
#
# The service runs from its own copy of the repo, never from this checkout: git worktrees of
# local `main` in ~/.pharos/slots/{a,b}, with ~/.pharos/app pointing at the one deployed (its
# commit is in ~/.pharos/deployed). An update builds main in the other slot, backs up the
# database (~/.pharos/backups, the last 5), switches over, restarts, and switches back if the
# server isn't healthy within 20 s. A failed build never touches the running server. Updates
# wait while the answering agent is working. Log: ~/.pharos/update.log.
#
# PORT, PHAROS_DB, PHAROS_AGENT_COMMAND, PHAROS_AGENT_LOG, and PHAROS_WEB_URL set while installing
# are stored in the job; re-run `install` to change them. For testing, LABEL, UPDATER_LABEL,
# PHAROS_HOME (default ~/.pharos), PHAROS_SOURCE (the repo whose main is followed; default this
# one), and PHAROS_SERVER_LOG override the rest.
set -euo pipefail

ROOT="${PHAROS_SCRIPT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LABEL="${LABEL:-dev.pharos.server}"
UPDATER_LABEL="${UPDATER_LABEL:-dev.pharos.updater}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UPDATER_PLIST="$HOME/Library/LaunchAgents/$UPDATER_LABEL.plist"
PHAROS_HOME="${PHAROS_HOME:-$HOME/.pharos}"
# Outside the default home, keep the database and the agent log there too (tests, second copies).
if [ "$PHAROS_HOME" != "$HOME/.pharos" ]; then
  export PHAROS_DB="${PHAROS_DB:-$PHAROS_HOME/pharos.db}"
  export PHAROS_AGENT_LOG="${PHAROS_AGENT_LOG:-$PHAROS_HOME/agent.log}"
fi
DB="${PHAROS_DB:-$PHAROS_HOME/pharos.db}"
LOG="${PHAROS_SERVER_LOG:-$PHAROS_HOME/server.log}"
UPDATE_LOG="$PHAROS_HOME/update.log"
APP="$PHAROS_HOME/app"
SLOTS="$PHAROS_HOME/slots"
DEPLOYED="$PHAROS_HOME/deployed"
FAILED="$PHAROS_HOME/update-failed"
BACKUPS="$PHAROS_HOME/backups"
LOCK="$PHAROS_HOME/update.lock"
PORT="${PORT:-4300}"
DOMAIN="gui/$(id -u)"
HEALTH="http://127.0.0.1:$PORT/api/health"

fail() { echo "pharos-service: $*" >&2; exit 1; }

require_macos() {
  [ "$(uname -s)" = Darwin ] || fail "this uses launchd and only works on macOS; run 'pnpm build' and 'pnpm --filter @pharos/server start' under your own supervisor instead"
}

# The repo whose local main is deployed: PHAROS_SOURCE, or the main checkout of this repo (also
# when this script runs from a worktree of it).
source_repo() {
  if [ -n "${PHAROS_SOURCE:-}" ]; then (cd "$PHAROS_SOURCE" && pwd); return; fi
  local common
  common=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir) || fail "$ROOT is not a git checkout"
  dirname "$common"
}
SOURCE=$(source_repo)
GIT_DIR_OF_SOURCE=$(git -C "$SOURCE" rev-parse --path-format=absolute --git-common-dir)

main_sha() { git -C "$SOURCE" rev-parse --verify -q 'refs/heads/main^{commit}'; }

pnpm_cmd() { # dir
  if command -v pnpm >/dev/null 2>&1; then echo pnpm; return; fi
  local version
  version=$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$1/package.json")
  echo "npx -y pnpm@${version:-latest}"
}

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }

env_entry() { # name value
  printf '      <key>%s</key>\n      <string>%s</string>\n' "$1" "$(printf '%s' "$2" | xml_escape)"
}

x() { printf '%s' "$1" | xml_escape; }

launchd_path() {
  local node path
  node=$(command -v node) || fail "node is not on PATH"
  # launchd starts with a minimal PATH: include where node, pnpm and the answering agent live.
  path="$(dirname "$node"):/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  if command -v pnpm >/dev/null 2>&1; then path="$(dirname "$(command -v pnpm)"):$path"; fi
  if command -v claude >/dev/null 2>&1; then path="$(dirname "$(command -v claude)"):$path"; fi
  echo "$path"
}

write_plist() {
  local node entries='' name
  node=$(command -v node) || fail "node is not on PATH"
  entries+=$(env_entry PATH "$(launchd_path)")$'\n'
  entries+=$(env_entry HOME "$HOME")$'\n'
  entries+=$(env_entry PORT "$PORT")$'\n'
  # Lets Settings say how to change the port under the service.
  entries+=$(env_entry PHAROS_SERVICE 1)$'\n'
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
  <string>$(x "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(x "$node")</string>
    <string>$(x "$APP/apps/server/dist/index.js")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(x "$APP/apps/server")</string>
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
  <string>$(x "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(x "$LOG")</string>
</dict>
</plist>
PLIST
}

# The updater runs the deployed copy of this script, so edits in a dev checkout never run unasked.
write_updater_plist() {
  local entries='' name
  entries+=$(env_entry PATH "$(launchd_path)")$'\n'
  entries+=$(env_entry HOME "$HOME")$'\n'
  entries+=$(env_entry PORT "$PORT")$'\n'
  entries+=$(env_entry LABEL "$LABEL")$'\n'
  entries+=$(env_entry UPDATER_LABEL "$UPDATER_LABEL")$'\n'
  entries+=$(env_entry PHAROS_HOME "$PHAROS_HOME")$'\n'
  entries+=$(env_entry PHAROS_SOURCE "$SOURCE")$'\n'
  entries+=$(env_entry PHAROS_SERVER_LOG "$LOG")$'\n'
  for name in PHAROS_DB PHAROS_AGENT_LOG; do
    if [ -n "${!name:-}" ]; then entries+=$(env_entry "$name" "${!name}")$'\n'; fi
  done
  mkdir -p "$(dirname "$UPDATER_PLIST")"
  cat > "$UPDATER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(x "$UPDATER_LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(x "$APP/scripts/pharos-service.sh")</string>
    <string>update</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(x "$PHAROS_HOME")</string>
  <key>EnvironmentVariables</key>
  <dict>
$entries  </dict>
  <key>WatchPaths</key>
  <array>
    <string>$(x "$GIT_DIR_OF_SOURCE/refs/heads/main")</string>
    <string>$(x "$GIT_DIR_OF_SOURCE/packed-refs")</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(x "$UPDATE_LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(x "$UPDATE_LOG")</string>
</dict>
</plist>
PLIST
}

loaded() { launchctl print "$DOMAIN/${1:-$LABEL}" >/dev/null 2>&1; }

# bootout returns before launchd has finished removing the job; a bootstrap in that window fails
# with "5: Input/output error". Wait for the job to go, and retry a few times.
bootstrap() { # [label plist]
  local label="${1:-$LABEL}" plist="${2:-$PLIST}" _
  for _ in $(seq 1 20); do loaded "$label" || break; sleep 0.25; done
  for _ in 1 2 3 4 5; do
    if launchctl bootstrap "$DOMAIN" "$plist" 2>/dev/null; then return 0; fi
    sleep 1
  done
  launchctl bootstrap "$DOMAIN" "$plist"
}

healthy() { curl -sf -m 1 "$HEALTH" >/dev/null 2>&1; }

wait_healthy() { # [seconds]
  local _
  for _ in $(seq 1 $(( ${1:-10} * 4 ))); do
    if healthy; then return 0; fi
    sleep 0.25
  done
  return 1
}

service_pid() { launchctl print "$DOMAIN/$LABEL" 2>/dev/null | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -n 1; }

# Healthy within the time, and still the same healthy process a few seconds later (a server that
# answers once and then crashes doesn't count).
wait_started() { # seconds
  local pid
  wait_healthy "$1" || return 1
  pid=$(service_pid)
  sleep 3
  [ -n "$pid" ] && [ "$pid" = "$(service_pid)" ] && healthy
}

log() { mkdir -p "$PHAROS_HOME"; printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$UPDATE_LOG"; }
say() { echo "$*"; log "$*"; }

short() { printf '%s' "${1:0:10}"; }

# --- deploy copies ---------------------------------------------------------------------------

current_slot() { # a, b, or nothing
  [ -L "$APP" ] || return 0
  basename "$(readlink "$APP")"
}

other_slot() { if [ "$(current_slot)" = a ]; then echo b; else echo a; fi; }

slot_sha() { git -C "$SLOTS/$1" rev-parse -q --verify HEAD 2>/dev/null || true; }

slot_built() { [ -f "$SLOTS/$1/apps/server/dist/index.js" ] && [ -f "$SLOTS/$1/apps/web/dist/index.html" ]; }

# Check out sha in a slot and build it there; output goes to the update log.
build_slot() { # slot sha
  local dir="$SLOTS/$1" sha=$2 pnpm
  mkdir -p "$SLOTS"
  if [ ! -e "$dir/.git" ]; then
    rm -rf "$dir"
    git -C "$SOURCE" worktree prune
    git -C "$SOURCE" worktree add --detach --force "$dir" "$sha" >> "$UPDATE_LOG" 2>&1 || return 1
  else
    git -C "$dir" checkout --detach --force -q "$sha" >> "$UPDATE_LOG" 2>&1 || return 1
    git -C "$dir" clean -fdq >> "$UPDATE_LOG" 2>&1 || return 1
  fi
  rm -rf "$dir"/apps/*/dist "$dir"/packages/*/dist
  pnpm=$(pnpm_cmd "$dir")
  # CI=true: pnpm never stops to ask (no terminal under launchd).
  (cd "$dir" && CI=true $pnpm install --frozen-lockfile && CI=true $pnpm build) >> "$UPDATE_LOG" 2>&1 || return 1
  slot_built "$1"
}

# Point app at a slot (the service and the updater run whatever app points at).
use_slot() { # slot
  ln -sfn "slots/$1" "$APP"
  slot_sha "$1" > "$DEPLOYED"
}

backup_db() { # sha
  [ -f "$DB" ] || { log "No database at $DB yet; nothing to back up."; return 0; }
  mkdir -p "$BACKUPS"
  local out
  out="$BACKUPS/pharos-$(date '+%Y%m%d-%H%M%S')-$(short "$1").db"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '$out'" || return 1
  else
    node -e 'const s = require("node:sqlite"); s.backup(new s.DatabaseSync(process.argv[1]), process.argv[2]).catch((e) => { console.error(e); process.exit(1); });' "$DB" "$out" || return 1
  fi
  log "Backed up the database to $out"
  # Keep the last 5.
  local old
  # shellcheck disable=SC2012 # names are ours: no spaces or newlines
  for old in $(ls -t "$BACKUPS"/pharos-*.db 2>/dev/null | tail -n +6); do rm -f "$old" "$old-wal" "$old-shm"; done
}

# One update or install at a time. A lock left by a process that is gone is taken over.
take_lock() {
  mkdir -p "$PHAROS_HOME"
  if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT; return 0; fi
  local holder
  holder=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then return 1; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || return 1
  echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT
}

# --- commands --------------------------------------------------------------------------------

do_install() {
  require_macos
  take_lock || fail "an update is running; try again in a minute"
  local sha slot
  sha=$(main_sha) || fail "$SOURCE has no main branch"
  if healthy && ! loaded; then
    fail "something is already answering on port $PORT (pnpm dev?); stop it first, or install with another PORT"
  fi
  slot=$(current_slot)
  if [ -n "$slot" ] && [ "$(slot_sha "$slot")" = "$sha" ] && slot_built "$slot"; then
    echo "main ($(short "$sha")) is already built in $SLOTS/$slot."
  else
    slot=$(other_slot)
    echo "Building main ($(short "$sha")) in $SLOTS/$slot... (log: $UPDATE_LOG)"
    log "install: building $sha in slot $slot"
    build_slot "$slot" "$sha" || { tail -n 20 "$UPDATE_LOG" >&2; fail "the build failed; the running service (if any) was left alone"; }
  fi
  backup_db "$sha" || fail "could not back up $DB"
  use_slot "$slot"
  if [ -f "$PLIST" ]; then cp "$PLIST" "$PLIST.previous"; fi
  write_plist
  if loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  bootstrap
  if wait_healthy 20; then
    rm -f "$PLIST.previous" "$FAILED"
    say "install: Pharos $(short "$sha") is running at http://localhost:$PORT (MCP: http://localhost:$PORT/mcp)"
    echo "It starts at login and restarts if it exits. Log: $LOG"
  else
    echo "The service was installed but is not answering. Last log lines:" >&2
    tail -n 20 "$LOG" >&2 || true
    if [ -f "$PLIST.previous" ]; then
      echo "Putting the previous service back." >&2
      launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
      mv "$PLIST.previous" "$PLIST"
      bootstrap || true
    fi
    exit 1
  fi
  if [ "${PHAROS_AUTOUPDATE:-on}" != off ]; then
    autoupdate_on
    echo "Autoupdate is on: when main moves in $SOURCE, the service builds and switches to it."
    echo "Turn it off with 'pnpm service autoupdate off'. Update log: $UPDATE_LOG"
  fi
}

autoupdate_on() {
  write_updater_plist
  if loaded "$UPDATER_LABEL"; then launchctl bootout "$DOMAIN/$UPDATER_LABEL" 2>/dev/null || true; fi
  bootstrap "$UPDATER_LABEL" "$UPDATER_PLIST"
  log "autoupdate on (following $SOURCE main)"
}

autoupdate_off() {
  if loaded "$UPDATER_LABEL"; then launchctl bootout "$DOMAIN/$UPDATER_LABEL" 2>/dev/null || true; fi
  rm -f "$UPDATER_PLIST"
  log "autoupdate off"
}

do_autoupdate() {
  require_macos
  case "${1:-}" in
    on)
      [ -L "$APP" ] || fail "not installed from a deploy copy yet (pnpm service install)"
      autoupdate_on; echo "Autoupdate is on: following main in $SOURCE. Log: $UPDATE_LOG" ;;
    off) autoupdate_off; echo "Autoupdate is off. 'pnpm service update' deploys main by hand." ;;
    *) fail "usage: pharos-service.sh autoupdate on|off" ;;
  esac
}

do_update() {
  require_macos
  # Run from a copy: the checkout this script lives in may change under it.
  if [ -z "${PHAROS_UPDATER_COPY:-}" ]; then
    mkdir -p "$PHAROS_HOME"
    local copy="$PHAROS_HOME/.pharos-update.sh"
    cp "${BASH_SOURCE[0]}" "$copy"
    PHAROS_UPDATER_COPY=1 PHAROS_SCRIPT_ROOT="$ROOT" PHAROS_SOURCE="$SOURCE" PHAROS_HOME="$PHAROS_HOME" exec /bin/bash "$copy" update
  fi
  local sha old slot old_slot agent
  sha=$(main_sha) || { log "update: $SOURCE has no main branch"; exit 1; }
  old=$(cat "$DEPLOYED" 2>/dev/null || true)
  [ "$sha" = "$old" ] && exit 0
  [ "$sha" = "$(cat "$FAILED" 2>/dev/null || true)" ] && exit 0
  [ -L "$APP" ] || { log "update: not installed from a deploy copy (pnpm service install); skipping"; exit 0; }
  loaded || { log "update: the service ($LABEL) is not loaded; skipping until it is started"; exit 0; }
  take_lock || { log "update: another update is running"; exit 0; }
  # Don't restart in the middle of an answer; the next run (main moving again, or 5 minutes) retries.
  agent=$(curl -sf -m 2 "http://127.0.0.1:$PORT/api/agent" 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { try { process.stdout.write(String(JSON.parse(s).state ?? "")); } catch {} });' || true)
  case "$agent" in
    running|stopping|queued) log "update: the answering agent is $agent; waiting before deploying $(short "$sha")"; exit 0 ;;
  esac

  old_slot=$(current_slot)
  slot=$(other_slot)
  log "update: $(short "$old") -> $(short "$sha"): building in slot $slot"
  if ! build_slot "$slot" "$sha"; then
    echo "$sha" > "$FAILED"
    log "update: FAILED to build $(short "$sha"); still running $(short "$old"), untouched. Skipping this commit until main moves."
    exit 1
  fi
  if ! backup_db "$sha"; then
    log "update: FAILED to back up $DB; not deploying $(short "$sha")"
    exit 1
  fi
  use_slot "$slot"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  if wait_started 20; then
    rm -f "$FAILED"
    log "update: now running $(short "$sha") (pid $(service_pid)); healthy at $HEALTH"
    return 0
  fi
  echo "$sha" > "$FAILED"
  log "update: $(short "$sha") did not start healthy within 20 s; rolling back to $(short "$old"). Server log:"
  tail -n 15 "$LOG" >> "$UPDATE_LOG" 2>/dev/null || true
  if [ -n "$old_slot" ] && slot_built "$old_slot"; then
    use_slot "$old_slot"
  else
    if build_slot "$old_slot" "$old"; then use_slot "$old_slot"; else log "update: could not rebuild $(short "$old")"; fi
  fi
  launchctl kickstart -k "$DOMAIN/$LABEL"
  if wait_started 20; then
    log "update: rolled back; running $(short "$old") again (pid $(service_pid)), healthy"
  else
    log "update: rolled back to $(short "$old") but it is not healthy either; see $LOG"
  fi
  exit 1
}

do_uninstall() {
  require_macos
  if loaded "$UPDATER_LABEL"; then launchctl bootout "$DOMAIN/$UPDATER_LABEL"; fi
  rm -f "$UPDATER_PLIST"
  if loaded; then launchctl bootout "$DOMAIN/$LABEL"; fi
  rm -f "$PLIST"
  local slot
  for slot in a b; do
    if [ -e "$SLOTS/$slot" ]; then
      git -C "$SOURCE" worktree remove --force "$SLOTS/$slot" 2>/dev/null || rm -rf "${SLOTS:?}/$slot"
    fi
  done
  git -C "$SOURCE" worktree prune 2>/dev/null || true
  rm -f "$APP" "$DEPLOYED" "$FAILED"
  echo "Removed the $LABEL service, the $UPDATER_LABEL updater and the deploy copies."
  echo "Your data stays: $DB, backups in $BACKUPS."
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
  local deployed main
  deployed=$(cat "$DEPLOYED" 2>/dev/null || true)
  main=$(main_sha || true)
  if [ -n "$deployed" ]; then
    echo "Deployed: $(short "$deployed") in $APP ($(git -C "$APP" log -1 --format=%s 2>/dev/null || echo '?'))"
    if [ "$deployed" != "$main" ]; then echo "main is at $(short "$main")"; fi
  fi
  if [ -f "$FAILED" ]; then echo "Last failed update: $(short "$(cat "$FAILED")") (see $UPDATE_LOG)"; fi
  if loaded "$UPDATER_LABEL"; then
    echo "Autoupdate: on (following main in $SOURCE)"
  else
    echo "Autoupdate: off"
  fi
  if ! loaded; then
    if [ -f "$PLIST" ]; then echo "Installed but stopped (pnpm service start)."; else echo "Not installed (pnpm service install)."; fi
    if healthy; then echo "Something else answers on port $PORT, though (pnpm dev?)."; fi
    exit 1
  fi
  launchctl print "$DOMAIN/$LABEL" | grep -E '^[[:space:]]*(state|pid|last exit code|runs) ' | sed 's/^[[:space:]]*//' || true
  if healthy; then
    echo "Healthy: http://localhost:$PORT"
  else
    echo "Not answering on port $PORT. Log: $LOG" >&2
    exit 1
  fi
}

case "${1:-}" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  update) do_update ;;
  autoupdate) do_autoupdate "${2:-}" ;;
  start) do_start ;;
  stop) do_stop ;;
  restart) require_macos; loaded || fail "not installed (pnpm service install)"; launchctl kickstart -k "$DOMAIN/$LABEL"; wait_healthy && echo "Restarted: http://localhost:$PORT" ;;
  status) do_status ;;
  log) tail -n 50 -f "$LOG" ;;
  *) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
