#!/usr/bin/env bash
#
# SIDFlow Restore Script
# Restores SIDFlow data from a backup archive
#
# Usage: restore.sh [OPTIONS]
#
# Options:
#   -i, --input FILE        Backup archive to restore (required)
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   --skip-stop             Don't stop the container before restore
#   --skip-start            Don't start the container after restore
#   --force                 Overwrite existing data without confirmation
#   --dry-run               Show what would be done without executing
#   -h, --help              Show this help message
#
# Examples:
#   restore.sh -i /backup/sidflow-prd-20241125-020000.tar.gz
#   restore.sh -i backup.tar.gz -d /srv/sidflow --force

set -euo pipefail

# Default values
INPUT_FILE=""
INSTALL_DIR="/opt/sidflow"
ENVIRONMENT="prd"
SKIP_STOP=false
SKIP_START=false
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
        -i|--input)
            INPUT_FILE="$2"
            shift 2
            ;;
        -d|--dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --skip-stop)
            SKIP_STOP=true
            shift
            ;;
        --skip-start)
            SKIP_START=true
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

# Validate input file
[[ -n "$INPUT_FILE" ]] || die "Input file is required. Use -i or --input."
[[ -f "$INPUT_FILE" ]] || die "Input file not found: $INPUT_FILE"

# Validate environment
if [[ "$ENVIRONMENT" != "stg" && "$ENVIRONMENT" != "prd" ]]; then
    die "Environment must be 'stg' or 'prd', got: $ENVIRONMENT"
fi

# Check prerequisites
command -v docker >/dev/null 2>&1 || die "Docker is required but not installed."

# Paths
DATA_DIR="$INSTALL_DIR/data"
CONFIG_DIR="$INSTALL_DIR/config"
COMPOSE_FILE="$CONFIG_DIR/docker-compose.$ENVIRONMENT.yml"
ENV_FILE="$CONFIG_DIR/.env.$ENVIRONMENT"
CONTAINER_NAME="sidflow-$ENVIRONMENT"

log_info "SIDFlow Restore"
log_info "==============="
log_info "Environment:     $ENVIRONMENT"
log_info "Input file:      $INPUT_FILE"
log_info "Target dir:      $DATA_DIR"
echo

# Check for existing data
if [[ -d "$DATA_DIR" && "$(ls -A "$DATA_DIR" 2>/dev/null)" ]] && [[ "$FORCE" != "true" ]]; then
    log_warn "Target directory contains existing data: $DATA_DIR"
    read -p "Overwrite existing data? [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || die "Restore cancelled by user"
fi

# Create temporary extraction directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Extract outer archive
log_info "Extracting backup archive..."
run_cmd tar -xzf "$INPUT_FILE" -C "$TEMP_DIR"

# Find the backup directory (handle both nested and flat structures)
BACKUP_DIR=$(find "$TEMP_DIR" -maxdepth 1 -type d -name 'sidflow-*' | head -1)
if [[ -z "$BACKUP_DIR" ]]; then
    BACKUP_DIR="$TEMP_DIR"
fi

# Verify manifest
if [[ -f "$BACKUP_DIR/manifest.json" ]]; then
    log_info "Backup manifest:"
    cat "$BACKUP_DIR/manifest.json"
    echo
else
    log_warn "No manifest found in backup"
fi

# Stop container if running
if [[ "$SKIP_STOP" != "true" ]] && [[ -f "$COMPOSE_FILE" ]]; then
    log_info "Stopping container..."
    if [[ "$DRY_RUN" != "true" ]]; then
        cd "$CONFIG_DIR"
        docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" down --timeout 30 2>/dev/null || true
    fi
fi

# Restore data
log_info "Restoring data..."

# Create data directory if it doesn't exist
run_cmd mkdir -p "$DATA_DIR"

# Restore each archive
for archive in "$BACKUP_DIR"/*.tar.gz; do
    [[ -f "$archive" ]] || continue
    ARCHIVE_NAME=$(basename "$archive" .tar.gz)
    log_info "Restoring $ARCHIVE_NAME..."
    
    if [[ "$ARCHIVE_NAME" == "config" ]]; then
        # Config goes to install dir, not data dir
        run_cmd tar -xzf "$archive" -C "$INSTALL_DIR"
    else
        # Data goes to data dir
        if [[ -d "$DATA_DIR/$ARCHIVE_NAME" ]]; then
            run_cmd rm -rf "$DATA_DIR/$ARCHIVE_NAME"
        fi
        run_cmd tar -xzf "$archive" -C "$DATA_DIR"
    fi
    log_success "$ARCHIVE_NAME restored"
done

# Fix ownership
log_info "Setting directory ownership..."
run_cmd sudo chown -R 1001:1001 "$DATA_DIR"
log_success "Ownership set"

# Start container
if [[ "$SKIP_START" != "true" ]] && [[ -f "$COMPOSE_FILE" ]]; then
    log_info "Starting container..."
    if [[ "$DRY_RUN" != "true" ]]; then
        cd "$CONFIG_DIR"
        docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" up -d
    fi
    
    # Wait for health check
    log_info "Waiting for health check..."
    PORT=$(grep -E '^SIDFLOW_PORT=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "3000")
    TIMEOUT=60
    ELAPSED=0
    
    while [[ $ELAPSED -lt $TIMEOUT ]]; do
        if [[ "$DRY_RUN" == "true" ]]; then
            log_success "[DRY-RUN] Would wait for health check"
            break
        fi
        
        if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
            log_success "Health check passed"
            break
        fi
        
        sleep 5
        ELAPSED=$((ELAPSED + 5))
    done
fi

echo
log_success "Restore complete!"
