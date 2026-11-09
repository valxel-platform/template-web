#!/bin/sh
# Browser error reporting (src/errors.ts): serve /sentry.json for the app, and forward
# POST /sentry/envelope/ to Sentry's ingest for the DSN's project, so the browser makes no
# cross-origin calls. Runs at container start (nginx image entrypoint hook).
#   SENTRY_DSN          https://<key>@<host>/<project id> (unset: error reporting is off)
#   SENTRY_ENVIRONMENT  e.g. production (optional)
#   SENTRY_RELEASE      e.g. the image tag (optional)
set -eu

out=/etc/nginx/conf.d/sentry.locations
for v in "${SENTRY_ENVIRONMENT:-}" "${SENTRY_RELEASE:-}"; do
  case "$v" in
    *[!A-Za-z0-9._@+-]*)
      echo "32-sentry.sh: SENTRY_ENVIRONMENT and SENTRY_RELEASE may only hold letters, digits and . _ @ + -" >&2
      exit 1
      ;;
  esac
done

if [ -z "${SENTRY_DSN:-}" ]; then
  cat >"$out" <<'CONF'
# No DSN: error reporting is off.
location = /sentry.json {
    include /etc/nginx/snippets/security-headers.conf;
    default_type application/json;
    return 200 '{"dsn":""}';
}
location /sentry/ { return 404; }
CONF
  echo "32-sentry.sh: SENTRY_DSN is not set; error reporting is off"
  exit 0
fi

# https://<key>@<host>/<project id>, nothing else.
host=$(printf '%s' "$SENTRY_DSN" | sed -n 's#^https://[0-9a-f]\{16,64\}@\([A-Za-z0-9.-]\{1,253\}\)/[0-9]\{1,20\}$#\1#p')
project=$(printf '%s' "$SENTRY_DSN" | sed -n 's#^https://[0-9a-f]\{16,64\}@[A-Za-z0-9.-]\{1,253\}/\([0-9]\{1,20\}\)$#\1#p')
if [ -z "$host" ] || [ -z "$project" ]; then
  echo "32-sentry.sh: SENTRY_DSN must look like https://<key>@<host>/<project id>" >&2
  exit 1
fi

cat >"$out" <<CONF
location = /sentry.json {
    include /etc/nginx/snippets/security-headers.conf;
    add_header Cache-Control "no-cache";
    default_type application/json;
    return 200 '{"dsn":"${SENTRY_DSN}","environment":"${SENTRY_ENVIRONMENT:-}","release":"${SENTRY_RELEASE:-}"}';
}
location = /sentry/envelope/ {
    limit_except POST { deny all; }
    limit_req zone=errors burst=40 nodelay;
    client_max_body_size 1m;
    proxy_pass https://${host}/api/${project}/envelope/;
    proxy_ssl_server_name on;
    proxy_set_header Host ${host};
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
}
location /sentry/ { return 404; }
CONF
echo "32-sentry.sh: browser errors go to Sentry project ${project} at ${host}"
