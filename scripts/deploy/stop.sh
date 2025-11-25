#!/usr/bin/env bash
#
# SIDFlow Stop Script
# Stops the SIDFlow container
#
# Usage: stop.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   --timeout SEC           Graceful shutdown timeout in seconds (default: 30)
#   --force                 Force stop (SIGKILL)
#   -h, --help              Show this help message
#
# Examples:
#   stop.sh                     # Stop prd gracefully
#   stop.sh -e stg              # Stop staging
#   stop.sh --force             # Force stop

set -euo pipefail

# Default values
INSTALL_DIR="/opt/sidflow"
ENVIRONMENT="prd"
TIMEOUT=30
FORCE=false

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
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --force)
            FORCE=true
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

# Check prerequisites
command -v docker >/dev/null 2>&1 || die "Docker is required but not installed."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required but not installed."

# Paths
CONFIG_DIR="$INSTALL_DIR/config"
COMPOSE_FILE="$CONFIG_DIR/docker-compose.$ENVIRONMENT.yml"
ENV_FILE="$CONFIG_DIR/.env.$ENVIRONMENT"

# Check if compose file exists
if [[ ! -f "$COMPOSE_FILE" ]]; then
    # Try to stop by container name directly
    CONTAINER_NAME="sidflow-$ENVIRONMENT"
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_info "Stopping container: $CONTAINER_NAME"
        if [[ "$FORCE" == "true" ]]; then
            docker kill "$CONTAINER_NAME" 2>/dev/null || true
        else
            docker stop --time "$TIMEOUT" "$CONTAINER_NAME" 2>/dev/null || true
        fi
        log_success "Container stopped"
    else
        log_info "Container not found: $CONTAINER_NAME"
    fi
    exit 0
fi

log_info "Stopping SIDFlow ($ENVIRONMENT)..."

cd "$CONFIG_DIR"

if [[ "$FORCE" == "true" ]]; then
    docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" kill
else
    docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" down --timeout "$TIMEOUT"
fi

log_success "SIDFlow stopped"
