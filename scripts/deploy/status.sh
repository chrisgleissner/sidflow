#!/usr/bin/env bash
#
# SIDFlow Status Script
# Displays the current status of SIDFlow deployment
#
# Usage: status.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   --json                  Output in JSON format
#   -h, --help              Show this help message
#
# Examples:
#   status.sh                   # Show prd status
#   status.sh -e stg            # Show staging status
#   status.sh --json            # Output as JSON

set -euo pipefail

# Default values
INSTALL_DIR="/opt/sidflow"
ENVIRONMENT="prd"
JSON_OUTPUT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}✓${NC} $*"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $*"; }
log_error() { echo -e "${RED}✗${NC} $*"; }

show_help() {
    sed -n '2,/^$/p' "$0" | grep '^#' | sed 's/^# \?//'
    exit 0
}

die() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            die "Unknown option: $1. Use --help for usage."
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "stg" && "$ENVIRONMENT" != "prd" ]]; then
    die "Environment must be 'stg' or 'prd', got: $ENVIRONMENT"
fi

# Paths
CONFIG_DIR="$INSTALL_DIR/config"
DATA_DIR="$INSTALL_DIR/data"
COMPOSE_FILE="$CONFIG_DIR/docker-compose.$ENVIRONMENT.yml"
ENV_FILE="$CONFIG_DIR/.env.$ENVIRONMENT"
CONTAINER_NAME="sidflow-$ENVIRONMENT"

# Collect status information
CONTAINER_STATUS="not_found"
CONTAINER_IMAGE=""
CONTAINER_UPTIME=""
CONTAINER_HEALTH=""
HEALTH_RESPONSE=""
PORT="3000"

# Get port from env file
if [[ -f "$ENV_FILE" ]]; then
    PORT=$(grep -E '^SIDFLOW_PORT=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "3000")
fi

# Check container status
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    CONTAINER_STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")
    CONTAINER_IMAGE=$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")
    CONTAINER_UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")
    CONTAINER_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")
fi

# Check health endpoint if container is running
if [[ "$CONTAINER_STATUS" == "running" ]]; then
    HEALTH_RESPONSE=$(curl -sf "http://localhost:$PORT/api/health" 2>/dev/null || echo '{"error": "unreachable"}')
fi

# Calculate disk usage
DISK_USAGE=""
if [[ -d "$DATA_DIR" ]]; then
    DISK_USAGE=$(du -sh "$DATA_DIR" 2>/dev/null | cut -f1 || echo "unknown")
fi

# JSON output
if [[ "$JSON_OUTPUT" == "true" ]]; then
    cat << EOF
{
  "environment": "$ENVIRONMENT",
  "install_dir": "$INSTALL_DIR",
  "container": {
    "name": "$CONTAINER_NAME",
    "status": "$CONTAINER_STATUS",
    "image": "$CONTAINER_IMAGE",
    "started_at": "$CONTAINER_UPTIME",
    "health": "$CONTAINER_HEALTH"
  },
  "port": "$PORT",
  "disk_usage": "$DISK_USAGE",
  "health_check": $HEALTH_RESPONSE
}
EOF
    exit 0
fi

# Human-readable output
echo
echo "═══════════════════════════════════════════════════════"
echo "          SIDFlow Status ($ENVIRONMENT)"
echo "═══════════════════════════════════════════════════════"
echo

echo "Installation"
echo "────────────"
echo "  Directory:     $INSTALL_DIR"
echo "  Config file:   $COMPOSE_FILE"
[[ -f "$COMPOSE_FILE" ]] && log_success "Config exists" || log_error "Config not found"
echo "  Disk usage:    $DISK_USAGE"
echo

echo "Container"
echo "─────────"
echo "  Name:          $CONTAINER_NAME"
echo "  Status:        $CONTAINER_STATUS"
echo "  Image:         $CONTAINER_IMAGE"
echo "  Started:       $CONTAINER_UPTIME"
echo "  Health:        $CONTAINER_HEALTH"
case $CONTAINER_HEALTH in
    healthy) log_success "Container is healthy" ;;
    unhealthy) log_error "Container is unhealthy" ;;
    starting) log_warn "Container is starting" ;;
    *) [[ "$CONTAINER_STATUS" == "running" ]] && log_warn "Health check not configured" || true ;;
esac
echo

echo "Network"
echo "───────"
echo "  Port:          $PORT"
if [[ "$CONTAINER_STATUS" == "running" ]]; then
    if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
        log_success "Health endpoint responding"
    else
        log_error "Health endpoint not responding"
    fi
fi
echo

echo "Health Check Response"
echo "─────────────────────"
if [[ -n "$HEALTH_RESPONSE" && "$HEALTH_RESPONSE" != '{"error": "unreachable"}' ]]; then
    echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"
else
    echo "  (not available)"
fi
echo

echo "Data Directories"
echo "────────────────"
for dir in hvsc wav-cache tags sidflow; do
    path="$DATA_DIR/$dir"
    if [[ -d "$path" ]]; then
        size=$(du -sh "$path" 2>/dev/null | cut -f1 || echo "unknown")
        count=$(find "$path" -type f 2>/dev/null | wc -l || echo "0")
        echo "  $dir: $size ($count files)"
    else
        echo "  $dir: (not found)"
    fi
done
echo

echo "═══════════════════════════════════════════════════════"
