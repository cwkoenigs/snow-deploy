#!/bin/sh
# Start the auth sidecar, then nginx in the foreground. If the sidecar dies,
# nginx auth_request fails closed (502 → no content served).
set -e
node /opt/snow-deploy/auth.js &
exec nginx -g 'daemon off;'
