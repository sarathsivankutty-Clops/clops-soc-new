#!/usr/bin/env bash
# Preflight check for configurable compose host ports and clops-soc containers.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS_FILE="${1:-$REPO_ROOT/.env.ports.example}"

if [ ! -f "$PORTS_FILE" ]; then
  echo "FAIL: ports file not found: $PORTS_FILE" >&2
  exit 1
fi

fail=0

# Check every *_PORT=<num> defined in .env.ports.example (allowing .env overrides)
if [ -f "$REPO_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env" 2>/dev/null || true
  set +a
fi

if ! command -v ss >/dev/null 2>&1; then
  echo "FAIL: 'ss' command is required to check listening TCP ports" >&2
  exit 1
fi

listening="$(ss -ltn 2>/dev/null || true)"

while IFS='=' read -r key default_val; do
  case "$key" in
    ''|'#'*) continue ;;
    *_PORT)
      val="${!key:-$default_val}"
      val="${val%%#*}"
      val="$(printf '%s' "$val" | tr -d '[:space:]\r')"
      [ -n "$val" ] || continue
      if printf '%s\n' "$listening" | grep -qE "[:.]${val}[[:space:]]"; then
        echo "FAIL: port $val ($key) is already in use according to ss -ltn" >&2
        fail=1
      fi
      ;;
  esac
done < "$PORTS_FILE"

if command -v docker >/dev/null 2>&1; then
  existing="$(docker ps -a --filter 'name=^/clops-soc-' --format '{{.Names}}' 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    echo "FAIL: existing clops-soc-* container(s) found:" >&2
    printf '  %s\n' "$existing" >&2
    fail=1
  fi
fi

echo "=== Memory ==="
free -h || true
echo "=== Root Disk ==="
df -h / || true

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "OK: all configured ports in $PORTS_FILE are free and no clops-soc-* containers exist."
