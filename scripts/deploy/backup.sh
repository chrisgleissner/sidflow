#!/usr/bin/env bash
#
# SIDFlow Backup Script
# Creates compressed backups of SIDFlow data directories
#
# Usage: backup.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -o, --output DIR        Backup output directory (default: /opt/sidflow/backups)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   --full                  Include all data (including wav-cache and hvsc)
#   --retention DAYS        Delete backups older than DAYS (default: 30)
#   --quiet                 Suppress non-essential output
#   --dry-run               Show what would be done without executing
#   -h, --help              Show this help message
#
# Backup Contents:
#   Default (critical data only):
#     - tags/              User ratings and tags (HIGH priority)
#     - sidflow/           LanceDB, classifications (MEDIUM priority)
#
#   Full backup (--full):
#     - All of the above, plus:
#     - hvsc/              SID collection (can re-download)
#     - wav-cache/         Rendered audio (can regenerate)
#
# Cron Example (daily at 2 AM):
#   0 2 * * * /opt/sidflow/scripts/backup.sh --quiet
#
# Examples:
#   backup.sh                           # Default backup
#   backup.sh --full                    # Full backup including HVSC
#   backup.sh -o /mnt/backup            # Backup to custom location
#   backup.sh --retention 7             # Keep only 7 days of backups

set -euo pipefail

# Default values
INSTALL_DIR="/opt/sidflow"
OUTPUT_DIR=""
ENVIRONMENT="prd"
FULL_BACKUP=false
RETENTION_DAYS=30
QUIET=false
DRY_RUN=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { [[ "$QUIET" != "true" ]] && echo -e "${BLUE}[INFO]${NC} $*" || true; }
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
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --full)
            FULL_BACKUP=true
            shift
            ;;
        --retention)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        --quiet)
            QUIET=true
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

# Set default output directory if not specified
OUTPUT_DIR="${OUTPUT_DIR:-$INSTALL_DIR/backups}"

# Validate environment
if [[ "$ENVIRONMENT" != "stg" && "$ENVIRONMENT" != "prd" ]]; then
    die "Environment must be 'stg' or 'prd', got: $ENVIRONMENT"
fi

# Validate source directory exists
DATA_DIR="$INSTALL_DIR/data"
[[ -d "$DATA_DIR" ]] || die "Data directory not found: $DATA_DIR"

# Create backup directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="sidflow-$ENVIRONMENT-$TIMESTAMP"
BACKUP_PATH="$OUTPUT_DIR/$BACKUP_NAME"

log_info "SIDFlow Backup"
log_info "=============="
log_info "Environment:     $ENVIRONMENT"
log_info "Source:          $DATA_DIR"
log_info "Destination:     $BACKUP_PATH"
log_info "Full backup:     $FULL_BACKUP"
[[ "$QUIET" != "true" ]] && echo

# Create output directory
run_cmd mkdir -p "$OUTPUT_DIR"

# Create temporary directory for backup
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Backup critical data (always included)
log_info "Backing up tags (user ratings)..."
if [[ -d "$DATA_DIR/tags" ]]; then
    run_cmd tar -czf "$TEMP_DIR/tags.tar.gz" -C "$DATA_DIR" tags
    log_success "Tags backed up"
else
    log_warn "Tags directory not found, skipping"
fi

log_info "Backing up sidflow data (LanceDB, classifications)..."
if [[ -d "$DATA_DIR/sidflow" ]]; then
    run_cmd tar -czf "$TEMP_DIR/sidflow.tar.gz" -C "$DATA_DIR" sidflow
    log_success "SIDFlow data backed up"
else
    log_warn "SIDFlow data directory not found, skipping"
fi

# Full backup includes additional directories
if [[ "$FULL_BACKUP" == "true" ]]; then
    log_info "Backing up HVSC collection..."
    if [[ -d "$DATA_DIR/hvsc" ]]; then
        run_cmd tar -czf "$TEMP_DIR/hvsc.tar.gz" -C "$DATA_DIR" hvsc
        log_success "HVSC backed up"
    else
        log_warn "HVSC directory not found, skipping"
    fi
    
    log_info "Backing up WAV cache..."
    if [[ -d "$DATA_DIR/wav-cache" ]]; then
        run_cmd tar -czf "$TEMP_DIR/wav-cache.tar.gz" -C "$DATA_DIR" wav-cache
        log_success "WAV cache backed up"
    else
        log_warn "WAV cache directory not found, skipping"
    fi
fi

# Backup configuration
log_info "Backing up configuration..."
CONFIG_DIR="$INSTALL_DIR/config"
if [[ -d "$CONFIG_DIR" ]]; then
    run_cmd tar -czf "$TEMP_DIR/config.tar.gz" -C "$INSTALL_DIR" config
    log_success "Configuration backed up"
fi

# Create backup manifest
log_info "Creating backup manifest..."
if [[ "$DRY_RUN" != "true" ]]; then
    # Build contents array without jq dependency
    CONTENTS_JSON=""
    for archive in "$TEMP_DIR"/*.tar.gz; do
        [[ -f "$archive" ]] || continue
        name=$(basename "$archive" .tar.gz)
        if [[ -n "$CONTENTS_JSON" ]]; then
            CONTENTS_JSON="$CONTENTS_JSON, \"$name\""
        else
            CONTENTS_JSON="\"$name\""
        fi
    done
    
    cat > "$TEMP_DIR/manifest.json" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "environment": "$ENVIRONMENT",
  "type": "$(if [[ "$FULL_BACKUP" == "true" ]]; then echo "full"; else echo "incremental"; fi)",
  "source_dir": "$DATA_DIR",
  "contents": [$CONTENTS_JSON],
  "host": "$(hostname)",
  "user": "$(whoami)"
}
EOF
fi

# Create final backup archive
log_info "Creating backup archive..."
if [[ "$DRY_RUN" != "true" ]]; then
    mkdir -p "$BACKUP_PATH"
    mv "$TEMP_DIR"/* "$BACKUP_PATH/"
    
    # Create combined archive
    tar -czf "$OUTPUT_DIR/$BACKUP_NAME.tar.gz" -C "$OUTPUT_DIR" "$BACKUP_NAME"
    rm -rf "$BACKUP_PATH"
    
    BACKUP_SIZE=$(du -h "$OUTPUT_DIR/$BACKUP_NAME.tar.gz" | cut -f1)
    log_success "Backup created: $OUTPUT_DIR/$BACKUP_NAME.tar.gz ($BACKUP_SIZE)"
fi

# Cleanup old backups
if [[ $RETENTION_DAYS -gt 0 ]]; then
    log_info "Cleaning up backups older than $RETENTION_DAYS days..."
    if [[ "$DRY_RUN" != "true" ]]; then
        find "$OUTPUT_DIR" -name "sidflow-$ENVIRONMENT-*.tar.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
        REMAINING=$(find "$OUTPUT_DIR" -name "sidflow-$ENVIRONMENT-*.tar.gz" 2>/dev/null | wc -l)
        log_success "Cleanup complete. $REMAINING backup(s) remaining."
    else
        echo "[DRY-RUN] Would delete backups older than $RETENTION_DAYS days"
    fi
fi

[[ "$QUIET" != "true" ]] && echo
log_success "Backup complete!"
[[ "$QUIET" != "true" ]] && log_info "Restore with: $INSTALL_DIR/scripts/restore.sh -i $OUTPUT_DIR/$BACKUP_NAME.tar.gz"
