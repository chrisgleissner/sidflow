#!/usr/bin/env bash
# Check deployment status and logs for any hosting platform
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $*"; }

# Parse arguments
CONFIG_FILE="${REPO_ROOT}/fly.stg.toml"
SHOW_LOGS=false
CHECK_HEALTH=true

while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--config) CONFIG_FILE="$2"; shift 2 ;;
        -l|--logs) SHOW_LOGS=true; shift ;;
        --no-health) CHECK_HEALTH=false; shift ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# Get app name from config
APP_NAME=$(grep '^app = ' "${CONFIG_FILE}" | sed 's/app = //' | tr -d "'\"")
if [[ -z "${APP_NAME}" ]]; then
    log_error "Could not determine app name from ${CONFIG_FILE}"
    exit 1
fi

log_info "Checking deployment for: ${APP_NAME}"

# Get app info
log_info "Fetching app info..."
APP_INFO=$(flyctl info --app "${APP_NAME}" --json 2>/dev/null || echo "{}")

if [[ "${APP_INFO}" == "{}" ]]; then
    log_error "Could not fetch app info"
    exit 1
fi

# Extract hostname
HOSTNAME=$(echo "${APP_INFO}" | grep -o '"Hostname":"[^"]*"' | cut -d'"' -f4 || echo "")
if [[ -z "${HOSTNAME}" ]]; then
    log_error "Could not determine hostname"
    exit 1
fi

APP_URL="https://${HOSTNAME}"
log_info "App URL: ${APP_URL}"

# Check machine status
log_info "Checking machines..."
MACHINES=$(flyctl machines list --app "${APP_NAME}" --json 2>/dev/null || echo "[]")
MACHINE_COUNT=$(echo "${MACHINES}" | grep -o '"id"' | wc -l)
log_info "Machines: ${MACHINE_COUNT}"

if [[ ${MACHINE_COUNT} -eq 0 ]]; then
    log_error "No machines found"
    exit 1
fi

# Check each machine state
RUNNING_COUNT=0
STOPPED_COUNT=0
echo "${MACHINES}" | grep -o '"state":"[^"]*"' | cut -d'"' -f4 | while read -r state; do
    case "${state}" in
        started) ((RUNNING_COUNT++)) || true ;;
        stopped) ((STOPPED_COUNT++)) || true ;;
        *) log_warning "Machine in state: ${state}" ;;
    esac
done

log_info "Running machines: ${RUNNING_COUNT}, Stopped: ${STOPPED_COUNT}"

# Show recent logs
if [[ "${SHOW_LOGS}" == "true" ]]; then
    log_info "Recent logs (last 50 lines):"
    flyctl logs --app "${APP_NAME}" --lines 50 2>/dev/null || log_warning "Could not fetch logs"
fi

# Health check
if [[ "${CHECK_HEALTH}" == "true" ]]; then
    HEALTH_URL="${APP_URL}/api/health"
    log_info "Checking health endpoint: ${HEALTH_URL}"
    
    if curl -sf --max-time 10 "${HEALTH_URL}" > /dev/null 2>&1; then
        log_success "✓ Health check passed!"
        log_success "✓ App is reachable at: ${APP_URL}"
        exit 0
    else
        log_error "✗ Health check failed"
        log_info "Showing recent logs for debugging:"
        flyctl logs --app "${APP_NAME}" --lines 100 2>/dev/null | tail -30
        exit 1
    fi
fi
