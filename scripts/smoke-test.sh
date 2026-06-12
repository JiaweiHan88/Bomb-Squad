#!/usr/bin/env bash
# Bomb Squad smoke test — validates every compose service is reachable.
# Usage: bash scripts/smoke-test.sh  (run from repo root after docker compose up -d)
# Exit 0 = all PASS; exit 1 = at least one FAIL.
set -uo pipefail

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
# Probe the HTTP port; any response (even 404) means the service is up.
# curl exit 7 = "failed to connect"; anything else means the port is open.
LIVEKIT_EXIT=0
curl -so /dev/null --max-time 5 "http://localhost:7880/" 2>/dev/null || LIVEKIT_EXIT=$?
if [ "${LIVEKIT_EXIT}" -ne 7 ]; then
  pass "livekit: port 7880 reachable"
else
  fail "livekit: port 7880 not reachable (curl exit ${LIVEKIT_EXIT})"
fi
# RTP/ICE media on a single UDP mux port (must match rtc.udp_port in livekit.yaml).
# Compose v5 dropped the `<port>/udp` arg form — use `--protocol udp <svc> <port>`.
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
# Port 80 returns a 301 redirect to HTTPS; any HTTP response means Caddy is up.
CADDY_EXIT=0
curl -so /dev/null --max-time 5 "http://localhost:80/" 2>/dev/null || CADDY_EXIT=$?
# curl exits 0 on 2xx/3xx; 47 = too many redirects; anything but 7/6 = connected
if [ "${CADDY_EXIT}" -ne 7 ] && [ "${CADDY_EXIT}" -ne 6 ]; then
  pass "caddy: port 80 reachable (exit ${CADDY_EXIT})"
else
  fail "caddy: port 80 not reachable (curl exit ${CADDY_EXIT})"
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
  # Fallback: just check port is open
  CONN_EXIT=0
  curl -so /dev/null --max-time 5 "http://localhost:5173/" 2>/dev/null || CONN_EXIT=$?
  if [ "${CONN_EXIT}" -ne 7 ] && [ "${CONN_EXIT}" -ne 6 ]; then
    pass "client: port 5173 reachable"
  else
    fail "client: port 5173 not reachable"
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
