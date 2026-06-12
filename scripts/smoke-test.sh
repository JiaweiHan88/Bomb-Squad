#!/usr/bin/env bash
# Bomb Squad smoke test — validates every compose service is reachable.
# Usage: bash scripts/smoke-test.sh  (run from repo root after docker compose up -d)
# Exit 0 = all PASS; exit 1 = at least one FAIL.
set -uo pipefail

# PORT resolution mirrors Compose: shell export wins, then .env, then 3001.
# Without the .env fallback, a PORT set only in .env makes this script probe
# the wrong port and report a false FAIL against a healthy stack.
if [ -z "${PORT:-}" ] && [ -f .env ]; then
  PORT=$(grep -E '^PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d '[:space:]')
fi
PORT="${PORT:-3001}"
FAILED=0

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; FAILED=$((FAILED + 1)); }

# ── redis ─────────────────────────────────────────────────────────────────────
printf "\n--- redis ---\n"
if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
  pass "redis: PING → PONG"
else
  fail "redis: PING did not return PONG"
fi

# ── postgres ──────────────────────────────────────────────────────────────────
printf "\n--- postgres ---\n"
if docker compose exec -T postgres pg_isready -U postgres 2>/dev/null \
    | grep -q "accepting connections"; then
  pass "postgres: pg_isready accepting connections"
else
  fail "postgres: pg_isready failed"
fi

# ── server ───────────────────────────────────────────────────────────────────
printf "\n--- server ---\n"
HEALTH=$(curl -sf --max-time 5 "http://localhost:${PORT}/health" 2>/dev/null || true)
if echo "${HEALTH}" | grep -q '"ok"'; then
  pass "server: GET /health → 200 {\"status\":\"ok\"}"
else
  fail "server: GET /health failed (response: ${HEALTH:-<no response>})"
fi

# ── livekit ───────────────────────────────────────────────────────────────────
printf "\n--- livekit ---\n"
# Probe the HTTP port; any HTTP response (even 404) means the service is up.
# curl exits 0 whenever it gets an HTTP response (no -f flag); any non-zero
# exit — connect refused (7), timeout (28), reset — means the service is NOT
# serving, so only exit 0 passes.
LIVEKIT_EXIT=0
curl -so /dev/null --max-time 5 "http://localhost:7880/" 2>/dev/null || LIVEKIT_EXIT=$?
if [ "${LIVEKIT_EXIT}" -eq 0 ]; then
  pass "livekit: port 7880 reachable"
else
  fail "livekit: port 7880 not reachable (curl exit ${LIVEKIT_EXIT})"
fi
# RTP/ICE media on a single UDP mux port (must match rtc.udp_port in livekit.yaml).
# `docker compose port` takes the protocol as a flag: `--protocol udp <svc> <port>`.
if docker compose port --protocol udp livekit 7882 2>/dev/null | grep -q ':'; then
  pass "livekit: RTP mux port 7882/udp published"
else
  fail "livekit: RTP mux port 7882/udp NOT published"
fi

# ── coturn ────────────────────────────────────────────────────────────────────
printf "\n--- coturn ---\n"
# TCP connect to TURN port 3478; bash /dev/tcp probe works on the host too.
COTURN_EXIT=0
bash -c '</dev/tcp/localhost/3478' 2>/dev/null || COTURN_EXIT=$?
if [ "${COTURN_EXIT}" -eq 0 ]; then
  pass "coturn: port 3478 reachable"
else
  fail "coturn: port 3478 not reachable"
fi
# Relay range must be PUBLISHED or TURN relay is unreachable behind symmetric NAT
# (the actual bug this guards). `docker compose port` prints a host mapping only
# when the range is published; relay ports open on allocation, so we assert the
# publish mapping rather than probing a live socket.
if docker compose port --protocol udp coturn 40000 2>/dev/null | grep -q ':'; then
  pass "coturn: TURN relay range 40000-40031/udp published"
else
  fail "coturn: TURN relay range 40000-40031/udp NOT published — relay path dead behind NAT"
fi
# Regression guard: coturn and LiveKit must keep DISJOINT UDP ports. If coturn
# publishes LiveKit's RTP mux port (7882) they collide on the host UDP port.
if docker compose port --protocol udp coturn 7882 2>/dev/null | grep -q ':'; then
  fail "coturn publishes 7882/udp — overlaps LiveKit RTP mux port (port regression)"
else
  pass "coturn/livekit UDP ports are disjoint"
fi

# ── caddy ─────────────────────────────────────────────────────────────────────
printf "\n--- caddy ---\n"
# Port 80 returns a 301 redirect to HTTPS; curl (no -L) exits 0 on any HTTP
# response including 3xx. Non-zero (refused=7, timeout=28, …) = Caddy not serving.
CADDY_EXIT=0
curl -so /dev/null --max-time 5 "http://localhost:80/" 2>/dev/null || CADDY_EXIT=$?
if [ "${CADDY_EXIT}" -eq 0 ]; then
  pass "caddy: port 80 reachable"
else
  fail "caddy: port 80 not reachable (curl exit ${CADDY_EXIT})"
fi
# End-to-end through the proxy: TLS termination + the /health route to the
# server. -k accepts the local "tls internal" cert. This is the path browsers
# actually use, so a broken Caddyfile route must fail the smoke test.
CADDY_HEALTH=$(curl -ksf --max-time 5 "https://localhost/health" 2>/dev/null || true)
if echo "${CADDY_HEALTH}" | grep -q '"ok"'; then
  pass "caddy: https://localhost/health → server via TLS route"
else
  fail "caddy: HTTPS /health route failed (response: ${CADDY_HEALTH:-<no response>})"
fi

# ── client ────────────────────────────────────────────────────────────────────
printf "\n--- client ---\n"
# vite preview serves the built SPA on port 5173.
CLIENT_EXIT=0
curl -sf --max-time 5 "http://localhost:5173/" 2>/dev/null | grep -qiE '<!DOCTYPE|<html' \
  || CLIENT_EXIT=$?
if [ "${CLIENT_EXIT}" -eq 0 ]; then
  pass "client: port 5173 serving HTML"
else
  # Fallback: any HTTP response (exit 0 without -f) still proves the server
  # is up; non-zero (refused/timeout) is a genuine failure.
  CONN_EXIT=0
  curl -so /dev/null --max-time 5 "http://localhost:5173/" 2>/dev/null || CONN_EXIT=$?
  if [ "${CONN_EXIT}" -eq 0 ]; then
    pass "client: port 5173 reachable (but not serving expected HTML)"
  else
    fail "client: port 5173 not reachable (curl exit ${CONN_EXIT})"
  fi
fi

# ── summary ──────────────────────────────────────────────────────────────────
printf "\n=========================================\n"
if [ "${FAILED}" -eq 0 ]; then
  echo "All checks PASSED."
  exit 0
else
  echo "${FAILED} check(s) FAILED."
  exit 1
fi
