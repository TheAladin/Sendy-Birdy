#!/bin/sh
# Every container starts here. SECRET_KEY comes from the environment if set; otherwise one is
# generated on first start and kept in the data volume. The migrate service runs first, so
# it's the one that creates it, and the two apps read the same key. The file is readable by the
# sendy group too, so backups can run as your own user with that group (see docs/self-hosting.md).
set -eu

if [ -z "${SECRET_KEY:-}" ]; then
    key_file=/data/.secret_key
    if [ ! -s "$key_file" ]; then
        (umask 027 && python -c 'import secrets; print(secrets.token_urlsafe(48))' >"$key_file")
    fi
    SECRET_KEY="$(cat "$key_file")"
    export SECRET_KEY
fi

exec "$@"
