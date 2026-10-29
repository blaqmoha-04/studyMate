#!/usr/bin/env bash
# Minimal host firewall: allow SSH, HTTP, HTTPS; deny everything else inbound. Run as root ON THE SERVER.
#   SSH_PORT=22 sudo -E deploy/scripts/ufw-setup.sh
# SAFETY: SSH is allowed BEFORE the firewall is enabled so you can't lock yourself out.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
SSH_PORT="${SSH_PORT:-22}"
apt-get install -y ufw >/dev/null
ufw default deny incoming; ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'; ufw allow 80/tcp comment 'HTTP'; ufw allow 443/tcp comment 'HTTPS'
ufw --force enable; ufw status verbose
echo "NOTE: Docker publishes ports by editing iptables directly and can bypass ufw. StudyMate only publishes 80/443, and PostgreSQL is on an internal network with no published port."
