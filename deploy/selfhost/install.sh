#!/bin/sh
# Installs Elemnt with Docker: Postgres, the Elemnt server and (with a domain) Caddy for HTTPS.
#
#   curl -fsSL https://raw.githubusercontent.com/ar-0911/elemnt/main/deploy/selfhost/install.sh | sh
#
# Options (all optional; you're asked for the domain otherwise):
#   --domain docs.example.com     serve over HTTPS at this name (omit for http://localhost:8787)
#   --sandbox sandbox.example.com second name for widgets (default: sandbox.<domain>)
#   --sites example.com           project websites at <site>.example.com (needs *.example.com DNS)
#   --dir ./elemnt                where to put compose.yml, Caddyfile and .env
#   --version 0.2.0               image tag (default: latest)
#   --yes                         don't ask anything
#
# Running it again in the same folder keeps your .env and just pulls and restarts.
set -eu

REPO_RAW="${ELEMNT_RAW:-https://raw.githubusercontent.com/ar-0911/elemnt/main/deploy/selfhost}"
DIR="./elemnt"
DOMAIN=""
SANDBOX=""
SITES=""
VERSION="latest"
ASK=1
ASKED_DOMAIN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; ASKED_DOMAIN=1; shift 2 ;;
    --sandbox) SANDBOX="$2"; shift 2 ;;
    --sites) SITES="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --yes|-y) ASK=0; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
ask() { # ask "Question" default -> answer on stdout
  if [ "$ASK" = 1 ] && [ -r /dev/tty ]; then
    printf '%s ' "$1" > /dev/tty
    read -r reply < /dev/tty || reply=""
    printf '%s' "${reply:-$2}"
  else
    printf '%s' "$2"
  fi
}
rand_hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
rand_b64() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
valid_host() { printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'; }

command -v docker >/dev/null 2>&1 || fail "Docker isn't installed. Get it from https://docs.docker.com/get-docker/ and run this again."
docker compose version >/dev/null 2>&1 || fail "This needs Docker Compose v2 (the 'docker compose' command)."

mkdir -p "$DIR"
cd "$DIR"

fetch() {
  [ -f "$1" ] && return 0
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$REPO_RAW/$1" -o "$1"
  else wget -qO "$1" "$REPO_RAW/$1"; fi
}
fetch compose.yml
fetch Caddyfile

if [ -f .env ]; then
  say "Found an existing .env in $(pwd); keeping it."
else
  if docker volume inspect elemnt_pgdata >/dev/null 2>&1; then
    fail "There's already an Elemnt database on this machine (volume elemnt_pgdata) but no .env here. Run this from the folder with that install's .env, or remove the old data first: docker volume rm elemnt_pgdata elemnt_blobs"
  fi
  if [ "$ASKED_DOMAIN" = 0 ]; then
    DOMAIN=$(ask "Domain for Elemnt, e.g. docs.example.com (leave empty to run on this machine only):" "")
  fi
  DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z')
  SETUP=$(rand_hex 16)
  if [ -n "$DOMAIN" ]; then
    valid_host "$DOMAIN" || fail "\"$DOMAIN\" doesn't look like a hostname."
    [ -n "$SANDBOX" ] || SANDBOX=$(ask "Second name for widgets [sandbox.$DOMAIN]:" "sandbox.$DOMAIN")
    valid_host "$SANDBOX" || fail "\"$SANDBOX\" doesn't look like a hostname."
    [ "$SANDBOX" != "$DOMAIN" ] || fail "The widget name must differ from $DOMAIN."
    if [ -z "$SITES" ]; then
      SITES=$(ask "Domain for project websites, e.g. example.com gives <site>.example.com (optional, needs a *.example.com DNS record):" "")
    fi
    [ -z "$SITES" ] || valid_host "$SITES" || fail "\"$SITES\" doesn't look like a domain."
    PUBLIC_URL="https://$DOMAIN"
    SANDBOX_URL="https://$SANDBOX"
    PROFILES="https"
  else
    PUBLIC_URL="http://localhost:8787"
    SANDBOX_URL=""
    PROFILES=""
  fi

  umask 077
  cat > .env <<ENV
# Written by install.sh. Keep this file private: it holds your encryption key.
# Change a value, then run: docker compose up -d
ELEMNT_VERSION=$VERSION
COMPOSE_PROFILES=$PROFILES
POSTGRES_PASSWORD=$(rand_hex 24)

# Encrypts stored API keys and tokens. Back it up; you can't read them back without it.
ELEMNT_SECRET_KEY=$(rand_b64)
# Only the setup link printed below can create the first (owner) account.
ELEMNT_SETUP_CODE=$SETUP
ELEMNT_PUBLIC_URL=$PUBLIC_URL
ELEMNT_WORKSPACE=default
${SANDBOX_URL:+ELEMNT_SANDBOX_URL=$SANDBOX_URL}
${SITES:+ELEMNT_SITES_DOMAIN=$SITES}
ELEMNT_WIDGET_SELF_VERIFY=true
ELEMNT_FONTS=google
# ELEMNT_SIGNUP=open            # let anyone join as a viewer (default: invite links only)

# Optional: a server-wide Anthropic API key. Each workspace can also set its own in Settings.
ANTHROPIC_API_KEY=
# Optional: read-only GitHub access for private repos (public repos work without it).
GITHUB_TOKEN=
ENV
  umask 022
  say "Wrote $(pwd)/.env"
fi

# shellcheck disable=SC1091
PUBLIC_URL=$(grep '^ELEMNT_PUBLIC_URL=' .env | cut -d= -f2-)
SETUP=$(grep '^ELEMNT_SETUP_CODE=' .env | cut -d= -f2- || true)

say "Pulling images..."
docker compose pull --quiet || say "Couldn't pull every image; using what's already here."
say "Starting Elemnt..."
docker compose up -d

printf 'Waiting for the server'
i=0
until docker compose exec -T server wget -qO- http://localhost:8787/healthz >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo; fail "The server didn't come up. See: docker compose logs server"; }
  printf '.'
  sleep 2
done
echo

say "Elemnt is running."
if docker compose logs server 2>/dev/null | grep -q "Not set up yet"; then
  echo "Create your owner account here (only this link works until then):"
  echo "  $PUBLIC_URL/signup?setup=$SETUP"
else
  echo "Open $PUBLIC_URL"
fi
case "$PUBLIC_URL" in
  https://*)
    host=${PUBLIC_URL#https://}
    echo
    echo "DNS: point these names at this server's public IP (A/AAAA records), and open ports 80 and 443:"
    echo "  $host"
    sb=$(grep '^ELEMNT_SANDBOX_URL=' .env | cut -d= -f2- | sed 's#https://##')
    [ -z "$sb" ] || echo "  $sb"
    st=$(grep '^ELEMNT_SITES_DOMAIN=' .env | cut -d= -f2-)
    [ -z "$st" ] || echo "  *.$st   (project websites)"
    echo "Certificates are issued automatically on the first visit to each name."
    ;;
esac
echo
echo "Upgrade later with: cd $(pwd) && docker compose pull && docker compose up -d"
