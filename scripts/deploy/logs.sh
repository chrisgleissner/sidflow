#!/usr/bin/env bash
#
# SIDFlow Logs Script
# View and follow container logs
#
# Usage: logs.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   -n, --lines N           Number of lines to show (default: 100)
#   -f, --follow            Follow log output in real-time
#   --since TIME            Show logs since timestamp (e.g., "1h", "2024-01-01")
#   --until TIME            Show logs until timestamp
#   -h, --help              Show this help message
#
# Examples:
#   logs.sh                     # Show last 100 lines
#   logs.sh -f                  # Follow logs in real-time
#   logs.sh -n 500              # Show last 500 lines
#   logs.sh --since 1h          # Show logs from last hour

set -euo pipefail

# Default values
INSTALL_DIR="/opt/sidflow"
ENVIRONMENT="prd"
LINES=100
FOLLOW=false
SINCE=""
UNTIL=""

# Colors for output
RED='\033[0;31m'
NC='\033[0m'

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
        -n|--lines)
            LINES="$2"
            shift 2
            ;;
        -f|--follow)
            FOLLOW=true
            shift
            ;;
        --since)
            SINCE="$2"
            shift 2
            ;;
        --until)
            UNTIL="$2"
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

# Container name
CONTAINER_NAME="sidflow-$ENVIRONMENT"

# Check if container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    die "Container not found: $CONTAINER_NAME"
fi

# Build docker logs command
DOCKER_CMD="docker logs"

if [[ "$FOLLOW" == "true" ]]; then
    DOCKER_CMD="$DOCKER_CMD -f"
fi

DOCKER_CMD="$DOCKER_CMD --tail $LINES"

if [[ -n "$SINCE" ]]; then
    DOCKER_CMD="$DOCKER_CMD --since $SINCE"
fi

if [[ -n "$UNTIL" ]]; then
    DOCKER_CMD="$DOCKER_CMD --until $UNTIL"
fi

DOCKER_CMD="$DOCKER_CMD $CONTAINER_NAME"

# Execute
exec $DOCKER_CMD
