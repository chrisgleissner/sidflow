#!/usr/bin/env bash
#
# SIDFlow Update Script
# Updates the Docker image to a specified tag or latest version
#
# Usage: update.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -t, --tag TAG           Docker image tag to update to (default: latest)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   --no-backup             Skip pre-update backup
#   --force                 Force update even if health check fails
#   --dry-run               Show what would be done without executing
#   -h, --help              Show this help message
#
# Environment Variables:
#   SIDFLOW_IMAGE           Custom Docker image (default: ghcr.io/chrisgleissner/sidflow)
#
# Examples:
#   update.sh                           # Update prd to latest
#   update.sh -t v0.3.28                # Update prd to specific version
#   update.sh -e stg -t latest          # Update staging to latest
#   update.sh --dry-run                 # Show what would be done

set -euo pipefail

# Default values
INSTALL_DIR="/opt/sidflow"
IMAGE_TAG="latest"
ENVIRONMENT="prd"
DOCKER_IMAGE="${SIDFLOW_IMAGE:-ghcr.io/chrisgleissner/sidflow}"
NO_BACKUP=false
FORCE=false
DRY_RUN=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

show_help() {
    sed -n '2,/^$/p' "$0" | grep '^#' | sed 's/^# \?//'
    exit 0
}

die() {
    log_error "$@"
    exit 1
}

run_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "[DRY-RUN] $*"
    else
        "$@"
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --no-backup)
            NO_BACKUP=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
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
BACKUP_SCRIPT="$INSTALL_DIR/scripts/backup.sh"

# Verify installation exists
[[ -f "$COMPOSE_FILE" ]] || die "Compose file not found: $COMPOSE_FILE. Run install.sh first."
[[ -f "$ENV_FILE" ]] || die "Environment file not found: $ENV_FILE. Run install.sh first."

log_info "SIDFlow Update"
log_info "=============="
log_info "Environment:     $ENVIRONMENT"
log_info "Install dir:     $INSTALL_DIR"
log_info "Current image:   $(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null | jq -r '.services.sidflow.image // "unknown"' 2>/dev/null || echo "unknown")"
log_info "Target image:    $DOCKER_IMAGE:$IMAGE_TAG"
echo

# Get current container ID for rollback
CONTAINER_NAME="sidflow-$ENVIRONMENT"
CURRENT_IMAGE=$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || echo "")

# Pre-update backup
if [[ "$NO_BACKUP" != "true" && -x "$BACKUP_SCRIPT" ]]; then
    log_info "Creating pre-update backup..."
    if [[ "$DRY_RUN" != "true" ]]; then
        "$BACKUP_SCRIPT" -e "$ENVIRONMENT" -d "$INSTALL_DIR" --quiet || log_warn "Backup failed, continuing anyway"
    else
        echo "[DRY-RUN] $BACKUP_SCRIPT -e $ENVIRONMENT -d $INSTALL_DIR --quiet"
    fi
fi

# Pull new image
log_info "Pulling Docker image: $DOCKER_IMAGE:$IMAGE_TAG"
run_cmd docker pull "$DOCKER_IMAGE:$IMAGE_TAG"
log_success "Docker image pulled"

# Update compose file with new image tag
log_info "Updating Docker Compose configuration..."
if [[ "$DRY_RUN" != "true" ]]; then
    sudo sed -i "s|image: .*|image: $DOCKER_IMAGE:$IMAGE_TAG|" "$COMPOSE_FILE"
    log_success "Configuration updated"
fi

# Stop current container
log_info "Stopping current container..."
if [[ "$DRY_RUN" != "true" ]]; then
    cd "$CONFIG_DIR"
    docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" down --timeout 30 || true
fi

# Start with new image
log_info "Starting container with new image..."
if [[ "$DRY_RUN" != "true" ]]; then
    docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" up -d
fi

# Wait for health check
log_info "Waiting for health check..."
TIMEOUT=120
ELAPSED=0
INTERVAL=5
HEALTH_OK=false

# Get port from env file
PORT=$(grep -E '^SIDFLOW_PORT=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "3000")

while [[ $ELAPSED -lt $TIMEOUT ]]; do
    if [[ "$DRY_RUN" == "true" ]]; then
        log_success "[DRY-RUN] Would wait for health check"
        HEALTH_OK=true
        break
    fi
    
    if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
        log_success "Health check passed"
        HEALTH_OK=true
        break
    fi
    
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    echo -n "."
done
echo

if [[ "$HEALTH_OK" != "true" && "$FORCE" != "true" ]]; then
    log_error "Health check failed after ${TIMEOUT}s"
    
    if [[ -n "$CURRENT_IMAGE" ]]; then
        log_warn "Rolling back to previous image: $CURRENT_IMAGE"
        sudo sed -i "s|image: .*|image: $CURRENT_IMAGE|" "$COMPOSE_FILE"
        docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" down --timeout 10 || true
        docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" up -d
        die "Update failed, rolled back to previous version"
    else
        die "Update failed, no previous image to rollback to"
    fi
fi

# Cleanup old images
log_info "Cleaning up old images..."
run_cmd docker image prune -f --filter "until=24h" 2>/dev/null || true

echo
log_success "Update complete!"
echo
log_info "New image: $DOCKER_IMAGE:$IMAGE_TAG"
log_info "View logs: $INSTALL_DIR/scripts/logs.sh -e $ENVIRONMENT"
