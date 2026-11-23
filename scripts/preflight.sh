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

# --- TLS edge: 80/443 must be free -------------------------------------------
# Checked explicitly rather than only through the ports file: a host already
# running another web server, or a leftover nginx from a previous attempt, is
# the common failure and that file is optional on a fresh box.
for port in "${HTTP_PORT:-80}" "${HTTPS_PORT:-443}"; do
  if printf '%s\n' "$listening" | grep -qE "[:.]${port}[[:space:]]"; then
    echo "FAIL: port $port (the nginx TLS edge) is already in use according to ss -ltn" >&2
    fail=1
  fi
done

# --- DNS points here (warn only) ---------------------------------------------
# The certificate is issued for PUBLIC_HOST, so a name that does not resolve to
# this instance makes the ACME challenge fail in a way that looks like an nginx
# misconfiguration. A warning, not a failure: split-horizon DNS and a name that
# is about to be repointed are both legitimate while migrating.
case "${PUBLIC_HOST:-}" in
  ''|*[!0-9.]*) dns_name="${PUBLIC_HOST:-}" ;;
  *) dns_name="" ;;   # a bare IPv4 address: nothing to resolve
esac
if [ -n "$dns_name" ]; then
  if ! command -v dig >/dev/null 2>&1; then
    echo "WARN: dig is not installed; cannot check that $dns_name points here" >&2
  else
    expected_ip="${EC2_PUBLIC_IP:-}"
    if [ -z "$expected_ip" ] && command -v curl >/dev/null 2>&1; then
      expected_ip="$(curl -fsS --max-time 3 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
    fi
    resolved_ip="$(dig +short A "$dns_name" 2>/dev/null | tail -n 1)"
    if [ -z "$resolved_ip" ]; then
      echo "WARN: $dns_name does not resolve yet (dig +short A returned nothing)" >&2
    elif [ -n "$expected_ip" ] && [ "$resolved_ip" != "$expected_ip" ]; then
      echo "WARN: $dns_name resolves to $resolved_ip, but this host is $expected_ip" >&2
    else
      echo "OK: $dns_name resolves to $resolved_ip"
    fi
  fi
fi

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
