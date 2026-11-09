#!/bin/sh
# Browser traces: forward POST /otlp/v1/traces to the data plane's OpenTelemetry collector, so
# the browser needs no cross-origin access. Runs at container start (nginx image entrypoint hook).
#   OTEL_COLLECTOR_URL   e.g. http://otel-collector.observability:4318 (unset: spans are dropped)
set -eu

out=/etc/nginx/conf.d/otel.locations
case "${OTEL_COLLECTOR_URL:-}" in
  *[!A-Za-z0-9._:/-]*)
    echo "31-otel.sh: OTEL_COLLECTOR_URL may only hold letters, digits and . _ : / -" >&2
    exit 1
    ;;
esac

if [ -z "${OTEL_COLLECTOR_URL:-}" ]; then
  cat >"$out" <<'CONF'
# No collector: accept browser spans and drop them.
location /otlp/ { return 204; }
CONF
  echo "31-otel.sh: OTEL_COLLECTOR_URL is not set; browser spans are dropped"
  exit 0
fi

cat >"$out" <<CONF
location = /otlp/v1/traces {
    limit_except POST { deny all; }
    limit_req zone=telemetry burst=100 nodelay;
    client_max_body_size 1m;
    proxy_pass ${OTEL_COLLECTOR_URL%/}/v1/traces;
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
}
location /otlp/ { return 404; }
CONF
echo "31-otel.sh: browser spans go to ${OTEL_COLLECTOR_URL}"
