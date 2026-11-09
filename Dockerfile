# syntax=docker/dockerfile:1
# Build: node, then serve the static bundle with unprivileged nginx (runs as uid 101, port 8080).
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build \
 && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) \
      -size +1k -exec gzip -9 -k {} \;

FROM nginxinc/nginx-unprivileged:1.31-alpine
# The base image can lag Alpine's security fixes: take them at build time.
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --chmod=755 docker/30-flags.sh /docker-entrypoint.d/30-flags.sh
COPY --chmod=755 docker/31-otel.sh /docker-entrypoint.d/31-otel.sh
COPY --chmod=755 docker/32-sentry.sh /docker-entrypoint.d/32-sentry.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
