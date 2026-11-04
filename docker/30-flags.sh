#!/bin/sh
# Feature flags: forward the browser's OFREP requests (/ofrep/) to the product's Flipt, adding the
# Flipt environment and namespace. Runs at container start (nginx image entrypoint hook).
#   FLAGS_URL          the product's Flipt, e.g. http://flipt.emr.svc:8080 (unset: every flag is off)
#   FLAGS_ENVIRONMENT  Flipt environment, e.g. production
#   FLAGS_NAMESPACE    the product's Flipt namespace, e.g. emr
# The product's Flipt should allow OFREP without a token (authentication.exclude.ofrep: true) and be
# reachable only from inside the product's runtime; the browser never holds a Flipt token.
set -eu

out=/etc/nginx/conf.d/flags.locations
for v in "${FLAGS_URL:-}" "${FLAGS_ENVIRONMENT:-}" "${FLAGS_NAMESPACE:-}"; do
  case "$v" in
    *[!A-Za-z0-9._:/-]*) bad=1 ;;
    *) bad=0 ;;
  esac
  if [ "$bad" = 1 ]; then
    echo "30-flags.sh: FLAGS_URL, FLAGS_ENVIRONMENT and FLAGS_NAMESPACE may only hold letters, digits and . _ : / -" >&2
    exit 1
  fi
done

if [ -z "${FLAGS_URL:-}" ]; then
  cat >"$out" <<'CONF'
# No flag server: answer OFREP with no flags, so every flag reads as its default (off).
location /ofrep/ {
    default_type application/json;
    return 200 '{"flags":[]}';
}
CONF
  echo "30-flags.sh: FLAGS_URL is not set; every feature flag reads as off"
  exit 0
fi

cat >"$out" <<CONF
location /ofrep/v1/evaluate/ {
    limit_except POST { deny all; }
    proxy_pass ${FLAGS_URL%/}/ofrep/v1/evaluate/;
    proxy_set_header x-flipt-environment "${FLAGS_ENVIRONMENT:-}";
    proxy_set_header x-flipt-namespace "${FLAGS_NAMESPACE:-}";
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
}
location /ofrep/ { return 404; }
CONF
echo "30-flags.sh: feature flags from ${FLAGS_URL} (${FLAGS_ENVIRONMENT:-default}/${FLAGS_NAMESPACE:-default})"
