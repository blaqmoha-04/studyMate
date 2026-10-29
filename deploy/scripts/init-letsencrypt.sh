#!/usr/bin/env bash
# Obtains a Let's Encrypt certificate and switches Nginx to HTTPS. Run on the server, after DNS points at it.
#   deploy/scripts/init-letsencrypt.sh            (real certificate)
#   STAGING=1 deploy/scripts/init-letsencrypt.sh  (test run that doesn't count against rate limits)
. "$(dirname "$0")/lib.sh"
[ "$MODE" = docker ] || die "Docker mode only"
DOMAIN="$(env_get DOMAIN)"; EMAIL="$(env_get LETSENCRYPT_EMAIL)"
[ -n "$DOMAIN" ] && [ "$DOMAIN" != studymate.example.com ] || die "Set DOMAIN in .env to your real domain"
[ -n "$EMAIL" ] && [ "$EMAIL" != you@example.com ] || die "Set LETSENCRYPT_EMAIL in .env"
mkdir -p certbot/www certbot/conf
sed -i 's#^NGINX_TEMPLATES_DIR=.*#NGINX_TEMPLATES_DIR=./deploy/nginx/templates-http#' .env
log "Starting the stack in HTTP mode…"; docker compose up -d --build
log "Requesting certificate for $DOMAIN (port 80 must be reachable from the internet)…"
extra=(); [ "${STAGING:-0}" = 1 ] && extra+=(--staging)
docker compose --profile tools run --rm certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive "${extra[@]}"
[ -f "certbot/conf/live/$DOMAIN/fullchain.pem" ] || die "Certificate was not issued; check the certbot output above"
sed -i 's#^NGINX_TEMPLATES_DIR=.*#NGINX_TEMPLATES_DIR=./deploy/nginx/templates-https#' .env
docker compose up -d --force-recreate nginx
log "HTTPS enabled. VERIFY it yourself: open https://$DOMAIN and check the padlock. This script has not verified it."
echo "Add automatic renewal (crontab -e):"
echo "  17 3 * * * cd $ROOT && deploy/scripts/renew-certs.sh >> /var/log/studymate-certbot.log 2>&1"
