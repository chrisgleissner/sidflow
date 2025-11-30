#!/usr/bin/env bash
#
# SIDFlow Start Script
# Starts the SIDFlow container
#
# Usage: start.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   --wait                  Wait for health check to pass
#   --timeout SEC           Health check timeout in seconds (default: 60)
#   -h, --help              Show this help message
#
# Examples:
#   start.sh                    # Start prd
#   start.sh -e stg             # Start staging
#   start.sh --wait             # Start and wait for healthy

set -euo pipefail

# Default values
INSTALL_DIR="/opt/sidflow"
ENVIRONMENT="prd"
WAIT=false
TIMEOUT=60

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
        --wait)
            WAIT=true
            shift
            ;;
        --timeout)
            TIMEOUT="$2"
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

# Verify files exist
[[ -f "$COMPOSE_FILE" ]] || die "Compose file not found: $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "Environment file not found: $ENV_FILE"

log_info "Starting SIDFlow ($ENVIRONMENT)..."

cd "$CONFIG_DIR"
docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" up -d

if [[ "$WAIT" == "true" ]]; then
    log_info "Waiting for health check..."
    
    PORT=$(grep -E '^SIDFLOW_PORT=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "3000")
    ELAPSED=0
    INTERVAL=5
    
    while [[ $ELAPSED -lt $TIMEOUT ]]; do
        if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
            log_success "Health check passed"
            break
        fi
        
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
        echo -n "."
    done
    echo
    
    if [[ $ELAPSED -ge $TIMEOUT ]]; then
        die "Health check timeout after ${TIMEOUT}s"
    fi
fi

log_success "SIDFlow started"
