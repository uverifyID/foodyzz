#!/usr/bin/env bash
# Deploy the app-download QR + smart redirect page to foodyzz.com (Hostinger FTP).
#
#   ./website/deploy-app-qr.sh            # back up, upload, verify
#   ./website/deploy-app-qr.sh --dry-run  # show what would happen, touch nothing
#
# Credentials are read straight out of Firestore (apiConfigSecret/hostinger) at
# run time and never written to disk. Requires gcloud logged in as the account
# that can read the foodyzz-27b3e project.
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

PROJECT="foodyzz-27b3e"
ACCOUNT="rajshrestha@gmail.com"      # NOT the gcloud default — see repo notes
SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SITE_DIR/.deploy-backup/$(date +%Y%m%d-%H%M%S)"

# Files to push. New files are additive; the two marked (overwrite) replace what
# is live, which is why they get backed up first.
NEW_FILES=(
  "app.html"
  "assets/foodyzz-app-qr.png"
  "assets/foodyzz-app-qr.svg"
)
OVERWRITE_FILES=(
  "index.html"       # adds the QR block to the Get-the-App band + ?v= on the CSS
  "css/style.css"    # adds .store-qr
  # Hostinger's CDN caches css/style.css for 7 days and ignores a Cloudflare
  # purge (cf-cache-status: MISS, x-hcdn-cache-status: HIT). These pages carry a
  # ?v= querystring on the stylesheet so a CSS change takes effect immediately
  # instead of waiting out that cache. Bump the version on any future CSS edit.
  "404.html"
  "contact.html"
  "privacy.html"
  "protection.html"
  "terms.html"
)

echo "==> Reading FTP credentials from Firestore ($PROJECT)"
TOKEN="$(gcloud auth print-access-token --account="$ACCOUNT")"
CREDS_JSON="$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/apiConfigSecret/hostinger")"

FTP_HOST="$(printf '%s' "$CREDS_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["fields"]["host"]["stringValue"])')"
FTP_USER="$(printf '%s' "$CREDS_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["fields"]["uname"]["stringValue"])')"
FTP_PASS="$(printf '%s' "$CREDS_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["fields"]["pass"]["stringValue"])')"
unset CREDS_JSON
echo "    host=$FTP_HOST user=$FTP_USER"

# Hostinger serves a shared TLS cert (CN=hostinger.com) that does not carry
# ftp.foodyzz.com, so verifying against the literal host fails. Rather than
# turning verification off, verify against a name the cert really covers and
# pin the connection to the IP that ftp.foodyzz.com resolves to.
FTP_IP="$(dig +short "$FTP_HOST" | head -1)"
[[ -n "$FTP_IP" ]] || { echo "!! could not resolve $FTP_HOST"; exit 1; }
VERIFY_HOST="ftp.hostinger.com"
CURL_TLS=(--ssl-reqd --ftp-pasv --connect-to "$VERIFY_HOST:21:$FTP_IP:21")
BASE="ftp://$VERIFY_HOST"
echo "    TLS verified against $VERIFY_HOST, pinned to $FTP_IP"

NETRC="$(mktemp)"; chmod 600 "$NETRC"
trap 'rm -f "$NETRC"' EXIT
printf 'machine %s login %s password %s\n' "$VERIFY_HOST" "$FTP_USER" "$FTP_PASS" > "$NETRC"
CURL=(curl -fsS --netrc-file "$NETRC" "${CURL_TLS[@]}" --connect-timeout 25 --max-time 180)

if (( DRY_RUN )); then
  echo "==> DRY RUN — remote listing only"
  "${CURL[@]}" "$BASE/"
  echo
  echo "    would upload (new):       ${NEW_FILES[*]}"
  echo "    would upload (overwrite): ${OVERWRITE_FILES[*]}"
  exit 0
fi

echo "==> Backing up the files about to be overwritten -> $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
for f in "${OVERWRITE_FILES[@]}"; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  if "${CURL[@]}" -o "$BACKUP_DIR/$f" "$BASE/$f"; then
    echo "    saved $f ($(wc -c <"$BACKUP_DIR/$f") bytes)"
  else
    echo "!!  could not fetch $f — aborting rather than overwriting blind"; exit 1
  fi
done

echo "==> Uploading"
for f in "${NEW_FILES[@]}" "${OVERWRITE_FILES[@]}"; do
  [[ -f "$SITE_DIR/$f" ]] || { echo "!! missing local file: $f"; exit 1; }
  "${CURL[@]}" -T "$SITE_DIR/$f" "$BASE/$f"
  echo "    uploaded $f"
done

echo "==> Verifying over HTTPS"
fail=0
check() { # url  expected-substring
  body="$(curl -fsSL --max-time 30 "$1" || true)"
  if [[ "$body" == *"$2"* ]]; then echo "    OK   $1"; else echo "    FAIL $1 (missing: $2)"; fail=1; fi
}
check "https://foodyzz.com/app" "apps.apple.com/us/app/foodyzz/id6794564474"
check "https://foodyzz.com/app" "play.google.com/store/apps/details?id=com.foodyzz"
check "https://foodyzz.com/"    "foodyzz-app-qr.png"
# Ask for the exact versioned URL the pages request — the bare URL can sit in
# Hostinger's CDN for days and would give a false negative here.
CSS_V="$(grep -o 'css/style\.css?v=[0-9]*' "$SITE_DIR/index.html" | head -1)"
check "https://foodyzz.com/${CSS_V:-css/style.css}" ".store-qr"
code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 30 "https://foodyzz.com/assets/foodyzz-app-qr.png" || true)"
[[ "$code" == "200" ]] && echo "    OK   QR image (HTTP $code)" || { echo "    FAIL QR image (HTTP $code)"; fail=1; }

if (( fail )); then
  echo "==> Verification FAILED. Roll back with the files in $BACKUP_DIR"
  exit 1
fi
echo "==> Done. https://foodyzz.com/app is live; backup in $BACKUP_DIR"
