#!/bin/sh
set -eu

config_path="${KAIZHI_CONFIG_PATH:-/data/config.yaml}"
auth_dir="${KAIZHI_AUTH_DIR:-/data/auths}"
host="${KAIZHI_HOST:-0.0.0.0}"
port="${KAIZHI_PORT:-8317}"

mkdir -p "$(dirname "$config_path")" "$auth_dir"

if [ ! -f "$config_path" ]; then
	cat > "$config_path" <<EOF
host: "$host"
port: $port
auth-dir: "$auth_dir"
api-keys: []
remote-management:
  allow-remote: false
  secret-key: ""
EOF
fi

exec /app/kaizhi-backend -config "$config_path" "$@"
