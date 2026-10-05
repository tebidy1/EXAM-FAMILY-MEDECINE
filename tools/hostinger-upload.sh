#!/usr/bin/env bash
# ============================================================
# Upload the deploy archive to Hostinger's TUS endpoint.
#
# Exists so the permission rule that lets the agent run it can be an exact
# match on one argument-less command, instead of opening `curl` to the whole
# internet. Everything variable lives in tools/.deploy-upload.json (gitignored,
# written fresh for each deploy); the host is checked HERE, so this script can
# only ever talk to Hostinger — a tampered config file cannot redirect it.
#
# Config keys: url, auth_key, rest_auth_key, zip
# Then: hosting_websites_deploy-static-site-archive, then clear the CDN cache.
# ============================================================
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cfg="$here/.deploy-upload.json"
[ -f "$cfg" ] || { echo "missing $cfg" >&2; exit 1; }

read_key() { python -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$cfg" "$1"; }

url=$(read_key url)
auth=$(read_key auth_key)
rest=$(read_key rest_auth_key)
zip=$(read_key zip)

# the one thing this script refuses to be talked out of
host=$(printf '%s' "$url" | sed -E 's#^https://([^/]+).*#\1#')
case "$host" in
  *.hstgr.io) ;;
  *) echo "refusing: $host is not a Hostinger files host" >&2; exit 1 ;;
esac
[ -f "$zip" ] || { echo "missing archive: $zip" >&2; exit 1; }

size=$(stat -c%s "$zip")
echo "uploading $(basename "$zip") — $size bytes → $host"

# TUS needs both keys on both calls; X-Auth alone is answered with openresty 403
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url/site.zip?override=true" \
  -H "X-Auth: $auth" -H "X-Auth-Rest: $rest" -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: $size" -H "Upload-Offset: 0")
echo "create: $code"
[ "$code" = "201" ] || { echo "expected 201" >&2; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$url/site.zip?override=true" \
  -H "X-Auth: $auth" -H "X-Auth-Rest: $rest" -H "Tus-Resumable: 1.0.0" \
  -H "Content-Type: application/offset+octet-stream" -H "Upload-Offset: 0" \
  --data-binary "@$zip")
echo "upload: $code"
[ "$code" = "204" ] || { echo "expected 204" >&2; exit 1; }

echo "done — now deploy the archive and clear the cache"
