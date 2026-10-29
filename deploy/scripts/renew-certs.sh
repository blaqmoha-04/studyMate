#!/usr/bin/env bash
# Renews certificates that are close to expiry and reloads Nginx. Safe to run daily.
. "$(dirname "$0")/lib.sh"
docker compose --profile tools run --rm certbot renew --webroot -w /var/www/certbot --quiet
docker compose exec -T nginx nginx -s reload
