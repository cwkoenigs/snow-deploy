# Serving image for snow-deploy: nginx (static serving) + a Node auth sidecar
# (per-app access control). Both serve every project — no per-app image builds.
FROM nginx:1.27-alpine

# Node powers the auth sidecar that enforces _meta/access.json.
RUN apk add --no-cache nodejs \
    && mkdir -p /artifacts /opt/snow-deploy \
    && chown -R nginx:nginx /var/cache/nginx /artifacts

COPY nginx.conf /etc/nginx/nginx.conf
COPY auth.js /opt/snow-deploy/auth.js
COPY entrypoint.sh /opt/snow-deploy/entrypoint.sh
RUN chmod +x /opt/snow-deploy/entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["/opt/snow-deploy/entrypoint.sh"]
