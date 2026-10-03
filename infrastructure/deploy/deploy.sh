#!/usr/bin/env bash
#
# CoreGrid Scholar — single-VM deploy / healthcheck / rollback driver.
#
# Usage:  sudo ./deploy.sh <image-ref>
#         sudo ./deploy.sh --rollback
#
# Contract:
#   - Runs `docker compose up -d` against ./docker-compose.yml with
#     SCHOLAR_IMAGE=<image-ref>.
#   - Pulls the new image BEFORE touching the running container (a bad pull
#     can never take the site down).
#   - Polls /health.json (200 = healthy, 503 = drain/fail). If the new
#     release does not turn healthy within HEALTH_TIMEOUT_SECS, it re-deploys
#     the previously running image tag automatically (rollback, §38).
#   - Never prints or handles credential VALUES: the env file is referenced
#     by path only (/opt/coregrid/scholar.env, mode 600, root-owned).
#
# Environment overrides:
#   DEPLOY_ENV_FILE      env file path (default /opt/coregrid/scholar.env)
#   HEALTH_URL           health endpoint (default http://127.0.0.1:3000/health.json)
#   HEALTH_TIMEOUT_SECS  healthy-window before rollback (default 120)

set -euo pipefail

cd "$(dirname "$0")"

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-/opt/coregrid/scholar.env}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health.json}"
HEALTH_TIMEOUT_SECS="${HEALTH_TIMEOUT_SECS:-120}"
CONTAINER=coregrid-scholar

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] FATAL: %s\n' "$*" >&2; exit 1; }

# --- compose command detection (v2 plugin preferred, v1 fallback) -----------
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "no docker compose available (install docker + compose plugin)"
fi

# --- preflight: fail closed before anything is touched ----------------------
command -v docker >/dev/null 2>&1 || die "docker not found on this host"
[ -f "$DEPLOY_ENV_FILE" ] || die "env file $DEPLOY_ENV_FILE missing — refusing to deploy (fail-closed)"
perms=$(stat -c '%a' "$DEPLOY_ENV_FILE" 2>/dev/null || stat -f '%Lp' "$DEPLOY_ENV_FILE")
[ "$perms" = "600" ] || die "env file $DEPLOY_ENV_FILE must be mode 600 (found $perms)"

current_image() {
  docker inspect "$CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true
}

health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1
  else
    wget -q -T 5 -O /dev/null "$HEALTH_URL" >/dev/null 2>&1
  fi
}

wait_healthy() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT_SECS ))
  # srvx start-period is 15s (compose healthcheck); give the first probe room.
  sleep 5
  while [ $SECONDS -lt $deadline ]; do
    if health_ok; then
      log "healthy: $HEALTH_URL returned 200"
      return 0
    fi
    sleep 5
  done
  log "NOT healthy after ${HEALTH_TIMEOUT_SECS}s"
  return 1
}

deploy_image() {
  local image="$1"
  log "deploying $image"
  docker pull "$image"
  SCHOLAR_IMAGE="$image" "${COMPOSE[@]}" up -d
}

main() {
  local target_image prev_image
  prev_image=$(current_image)

  if [ "${1:-}" = "--rollback" ]; then
    [ -n "$prev_image" ] || die "no previous image recorded on container $CONTAINER"
    log "ROLLBACK requested: redeploying previously running image $prev_image"
    deploy_image "$prev_image"
    wait_healthy || die "rollback did not restore health — manual intervention required"
    log "rollback complete"
    return 0
  fi

  target_image="${1:-}"
  [ -n "$target_image" ] || die "usage: deploy.sh <image-ref> | deploy.sh --rollback"

  if [ -n "$prev_image" ] && [ "$prev_image" = "$target_image" ]; then
    log "target equals currently running image ($target_image) — nothing to do"
    return 0
  fi

  deploy_image "$target_image"

  if wait_healthy; then
    log "deploy OK: $target_image (previous: ${prev_image:-none} — kept locally for rollback)"
    log "verify externally: curl -fsS https://<host>/health.json && curl -fsSI https://<host>/coregrid"
    return 0
  fi

  log "health gate FAILED — rolling back"
  if [ -n "$prev_image" ]; then
    deploy_image "$prev_image"
    if wait_healthy; then
      log "rollback to $prev_image successful; new image $target_image left on disk for inspection"
      log "inspect: docker logs $CONTAINER (from the failed attempt, pre-rollback)"
      exit 1
    fi
    die "rollback did not restore health — manual intervention required"
  fi
  die "no previous image to roll back to (first deploy failed) — inspect: docker logs $CONTAINER"
}

main "$@"