#!/usr/bin/env bash
# Builds the image, starts the whole compose stack from scratch and uses it like a person would:
# sign in, upload a screenshot and a video, share them, open the share on the public app, back up.
# CI runs it on a fresh machine. It uses its own project name, so its volumes (deleted at the end)
# are never yours; it does need ports 8000 and 8001 free.
set -euo pipefail

export COMPOSE_PROJECT_NAME=sendy-smoke
ADMIN=http://127.0.0.1:8000
PUBLIC=http://127.0.0.1:8001
WORK="$(mktemp -d)"
compose() { docker compose "$@"; }

cleanup() {
    status=$?
    if [[ $status -ne 0 ]]; then
        compose logs --no-color --tail=100 || true
    fi
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf "${WORK:?}"
    exit "$status"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }
# Prints the HTTP status of a request; extra arguments go to curl.
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() { [[ "$1" == "$2" ]] || fail "$3: expected $2, got $1"; }
json() { python3 -c "import json, sys; print(json.load(sys.stdin)$1)"; }

step "Build and start (no .env: SECRET_KEY must be generated)"
compose up --build --detach
for _ in $(seq 90); do
    if [[ "$(status "$ADMIN/api/health")" == 200 && "$(status "$PUBLIC/favicon.svg")" == 200 ]]; then
        break
    fi
    sleep 2
done
expect "$(status "$ADMIN/api/health")" 200 "admin health"
expect "$(compose ps --all --format '{{.Service}} {{.State}} {{.ExitCode}}' | grep '^migrate ')" \
    "migrate exited 0" "migrate service"

step "Only the right things are reachable"
expect "$(compose port admin 8000)" "127.0.0.1:8000" "admin port binding"
expect "$(compose port public 8001)" "127.0.0.1:8001" "public port binding"
# Depending on the compose version, an unpublished port prints nothing, ":0" or an error.
[[ "$(compose port db 5432 2>/dev/null || true)" =~ ^(:0)?$ ]] || fail "the database has a published port"
expect "$(compose exec -T admin id -u)" 10001 "app user"
expect "$(status "$ADMIN/api/docs")" 200 "admin docs"
expect "$(status "$PUBLIC/api/docs")" 404 "public docs"
expect "$(status "$PUBLIC/api/health")" 404 "public admin API"
expect "$(status "$PUBLIC/")" 404 "public home page"
expect "$(status "$PUBLIC/s/anything")" 200 "public share page"
curl -s -D - -o /dev/null "$PUBLIC/s/anything" | grep -qi "^content-security-policy: default-src 'self'" ||
    fail "security headers missing"

step "Create the admin and sign in"
printf 'smoke test password\n' |
    compose run --rm -T admin python -m app.cli create-admin --email ci@example.com --name CI
cookie="$(curl -s -D - -o /dev/null -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' \
    -d '{"email":"ci@example.com","password":"smoke test password"}' "$ADMIN/api/auth/login" |
    sed -n 's/^set-cookie: \(sendy_session=[^;]*\).*/\1/Ip' | tr -d '\r')"
[[ -n "$cookie" ]] || fail "no session cookie"
auth=(-H "Cookie: $cookie" -H 'X-Requested-With: fetch')
raw=(-H 'Content-Type: application/octet-stream')

step "Upload a screenshot and a video (made inside the image: Pillow and ffmpeg must work)"
compose exec -T admin python -c "
import io, sys
from PIL import Image
buffer = io.BytesIO()
Image.new('RGB', (320, 200), (14, 165, 233)).save(buffer, 'PNG')
sys.stdout.buffer.write(buffer.getvalue())" >"$WORK/shot.png"
compose exec -T admin sh -c 'ffmpeg -loglevel error -f lavfi -i testsrc=duration=2:size=320x240:rate=10 \
    -pix_fmt yuv420p /tmp/clip.mp4 && cat /tmp/clip.mp4 && rm /tmp/clip.mp4' >"$WORK/clip.mp4"
shot="$(curl -s "${auth[@]}" "${raw[@]}" --data-binary @"$WORK/shot.png" "$ADMIN/api/items?filename=shot.png" |
    json '["id"]')"
video="$(curl -s "${auth[@]}" "${raw[@]}" --data-binary @"$WORK/clip.mp4" "$ADMIN/api/items?filename=clip.mp4")"
expect "$(json '["has_thumbnail"]' <<<"$video")" True "video poster (ffmpeg)"
video="$(json '["id"]' <<<"$video")"

step "Share them and open the link on the public app"
share="$(curl -s "${auth[@]}" -H 'Content-Type: application/json' \
    -d "{\"title\":\"Smoke test\",\"item_ids\":[\"$shot\",\"$video\"]}" "$ADMIN/api/shares")"
token="$(json '["url"].rsplit("/", 1)[1]' <<<"$share")"
expect "$(curl -s "$PUBLIC/api/public/shares/$token" | json '["items"].__len__()')" 2 "shared items"
expect "$(status "$PUBLIC/api/public/shares/$token/items/$video/file")" 200 "shared video"
expect "$(status "$PUBLIC/api/public/shares/$token/items/$shot/thumbnail")" 200 "shared thumbnail"

step "Back up from inside the container (pg_dump 18), as this user"
mkdir "$WORK/backups"
compose run --rm --user "$(id -u):sendy" -v "$WORK/backups:/backups" admin \
    python -m app.cli backup /backups
backup="$(find "$WORK/backups" -mindepth 1 -maxdepth 1 -name 'sendy-backup-*' ! -name '*.partial')"
[[ -f "$backup/database.dump" ]] || fail "no database dump"
expect "$(json '["items"]' <"$backup/manifest.json")" 2 "items in the backup"

step "All good"
