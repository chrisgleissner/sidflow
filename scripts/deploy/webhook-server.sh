#!/usr/bin/env bash
#
# SIDFlow Deployment Webhook Handler
# Lightweight HTTP server that triggers deployment updates when called
#
# This script runs as a service on the Raspberry Pi and listens for
# webhook calls from GitHub Actions to trigger deployment updates.
#
# Security:
#   - Requires a secret token to authenticate requests
#   - Only accepts POST requests
#   - Logs all requests for audit trail
#
# Usage: webhook-server.sh [OPTIONS]
#
# Options:
#   -p, --port PORT         Listen port (default: 9000)
#   -s, --secret SECRET     Webhook secret (required, or set WEBHOOK_SECRET)
#   -d, --dir DIR           SIDFlow installation directory (default: /opt/sidflow)
#   --log FILE              Log file path (default: /var/log/sidflow-webhook.log)
#   -h, --help              Show this help message
#
# Environment Variables:
#   WEBHOOK_SECRET          Webhook authentication secret
#
# Systemd Service (save as /etc/systemd/system/sidflow-webhook.service):
#   [Unit]
#   Description=SIDFlow Deployment Webhook Server
#   After=network.target docker.service
#   
#   [Service]
#   Type=simple
#   User=root
#   Environment=WEBHOOK_SECRET=your-secret-here
#   ExecStart=/opt/sidflow/scripts/webhook-server.sh -p 9000
#   Restart=always
#   RestartSec=10
#   
#   [Install]
#   WantedBy=multi-user.target
#
# Examples:
#   webhook-server.sh -s "my-secret-token"
#   WEBHOOK_SECRET="token" webhook-server.sh -p 8080

set -euo pipefail

# Default values
PORT=9000
SECRET="${WEBHOOK_SECRET:-}"
INSTALL_DIR="/opt/sidflow"
LOG_FILE="/var/log/sidflow-webhook.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

show_help() {
    sed -n '2,/^$/p' "$0" | grep '^#' | sed 's/^# \?//'
    exit 0
}

die() {
    log_error "$@"
    exit 1
}

log_request() {
    echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -s|--secret)
            SECRET="$2"
            shift 2
            ;;
        -d|--dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --log)
            LOG_FILE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            ;;
        *)
            die "Unknown option: $1. Use --help for usage."
            ;;
    esac
done

# Validate secret
[[ -n "$SECRET" ]] || die "Webhook secret is required. Use -s or set WEBHOOK_SECRET."

# Check prerequisites
command -v nc >/dev/null 2>&1 || command -v socat >/dev/null 2>&1 || die "netcat (nc) or socat is required."

# Create log file directory if needed
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

log_info "SIDFlow Webhook Server"
log_info "======================"
log_info "Port:        $PORT"
log_info "Install dir: $INSTALL_DIR"
log_info "Log file:    $LOG_FILE"
echo

# HTTP response helpers
send_response() {
    local status="$1"
    local body="$2"
    local content_length=${#body}
    
    echo -e "HTTP/1.1 $status\r"
    echo -e "Content-Type: application/json\r"
    echo -e "Content-Length: $content_length\r"
    echo -e "Connection: close\r"
    echo -e "\r"
    echo -n "$body"
}

# Handle incoming request
handle_request() {
    local request=""
    local headers=""
    local body=""
    local content_length=0
    
    # Read request line
    read -r request
    request="${request%%$'\r'}"
    
    # Read headers
    while IFS= read -r line; do
        line="${line%%$'\r'}"
        [[ -z "$line" ]] && break
        headers="$headers$line\n"
        
        if [[ "$line" =~ ^[Cc]ontent-[Ll]ength:\ *([0-9]+) ]]; then
            content_length="${BASH_REMATCH[1]}"
        fi
    done
    
    # Read body if present
    if [[ $content_length -gt 0 ]]; then
        body=$(head -c "$content_length")
    fi
    
    log_request "Request: $request"
    
    # Parse request
    local method path
    read -r method path _ <<< "$request"
    
    # Only accept POST /deploy
    if [[ "$method" != "POST" ]]; then
        log_request "Rejected: Method not allowed ($method)"
        send_response "405 Method Not Allowed" '{"error":"Method not allowed"}'
        return
    fi
    
    # Parse path and query string
    local endpoint query_string=""
    if [[ "$path" == *"?"* ]]; then
        endpoint="${path%%\?*}"
        query_string="${path#*\?}"
    else
        endpoint="$path"
    fi
    
    case "$endpoint" in
        /health)
            send_response "200 OK" '{"status":"healthy"}'
            return
            ;;
        /deploy/stg|/deploy/prd)
            ;;
        *)
            log_request "Rejected: Not found ($endpoint)"
            send_response "404 Not Found" '{"error":"Not found"}'
            return
            ;;
    esac
    
    # Extract environment from path
    local env="${endpoint##*/}"
    
    # Validate secret from query string or body
    local provided_secret=""
    if [[ "$query_string" =~ secret=([^&]+) ]]; then
        provided_secret="${BASH_REMATCH[1]}"
    elif [[ -n "$body" ]]; then
        # Try to parse JSON body
        provided_secret=$(echo "$body" | grep -oP '"secret"\s*:\s*"\K[^"]+' 2>/dev/null || echo "")
    fi
    
    if [[ "$provided_secret" != "$SECRET" ]]; then
        log_request "Rejected: Invalid secret"
        send_response "401 Unauthorized" '{"error":"Invalid secret"}'
        return
    fi
    
    # Extract tag from query string or body
    local tag="latest"
    if [[ "$query_string" =~ tag=([^&]+) ]]; then
        tag="${BASH_REMATCH[1]}"
    elif [[ -n "$body" ]]; then
        local body_tag=$(echo "$body" | grep -oP '"tag"\s*:\s*"\K[^"]+' 2>/dev/null || echo "")
        [[ -n "$body_tag" ]] && tag="$body_tag"
    fi
    
    log_request "Deploying: env=$env, tag=$tag"
    
    # Trigger deployment in background
    (
        "$INSTALL_DIR/scripts/update.sh" -e "$env" -t "$tag" >> "$LOG_FILE" 2>&1
        log_request "Deployment complete: env=$env, tag=$tag, exit_code=$?"
    ) &
    
    send_response "202 Accepted" "{\"status\":\"deploying\",\"environment\":\"$env\",\"tag\":\"$tag\"}"
}

log_info "Starting webhook server on port $PORT..."
log_request "Server started on port $PORT"

# Use socat if available (more robust), otherwise fallback to netcat
if command -v socat >/dev/null 2>&1; then
    while true; do
        socat TCP-LISTEN:"$PORT",reuseaddr,fork EXEC:"$0 --handle-request",nofork 2>/dev/null || sleep 1
    done
else
    # Netcat-based server (less robust but widely available)
    while true; do
        { handle_request; } | nc -l -p "$PORT" -q 1 2>/dev/null || sleep 1
    done
fi
