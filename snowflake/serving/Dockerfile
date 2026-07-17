# Serving image for snow-deploy. A tiny nginx that serves static build
# artifacts straight from a mounted Snowflake stage — no per-app image builds.
FROM nginx:1.27-alpine

# Run as non-root; SPCS mounts the stage read-only under /artifacts.
RUN mkdir -p /artifacts \
    && chown -R nginx:nginx /var/cache/nginx /artifacts

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
