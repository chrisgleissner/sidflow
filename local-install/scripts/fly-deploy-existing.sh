#!/usr/bin/env bash
# Wrapper script to deploy to Fly.io using existing fly.stg.toml
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# Parse arguments
TAG="v0.3.10"
CONFIG_FILE="${REPO_ROOT}/fly.stg.toml"

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v flyctl &> /dev/null; then
    log_error "flyctl not found"
    exit 1
fi

if ! flyctl auth whoami &> /dev/null; then
    log_error "Not authenticated with Fly.io"
    exit 1
fi

log_success "Prerequisites check passed"

# Read app name from config
if [[ ! -f "${CONFIG_FILE}" ]]; then
    log_error "Config file not found: ${CONFIG_FILE}"
    exit 1
fi

APP_NAME=$(grep '^app = ' "${CONFIG_FILE}" | sed 's/app = //' | tr -d "'\"")
if [[ -z "${APP_NAME}" ]]; then
    log_error "Could not determine app name from ${CONFIG_FILE}"
    exit 1
fi

log_info "App name: ${APP_NAME}"
log_info "Image tag: ${TAG}"
log_info "Config: ${CONFIG_FILE}"

# Check if app exists
log_info "Checking if app exists..."
if ! flyctl apps list | grep -q "^${APP_NAME}"; then
    log_error "App '${APP_NAME}' does not exist"
    exit 1
fi

log_success "App exists"

# Update image in config
log_info "Updating image tag in config..."
TEMP_CONFIG="/tmp/fly-deploy-$(date +%s).toml"
cp "${CONFIG_FILE}" "${TEMP_CONFIG}"
sed -i "s|image = .*|image = \"ghcr.io/chrisgleissner/sidflow:${TAG}\"|" "${TEMP_CONFIG}"

# Deploy
log_info "Starting deployment to ${APP_NAME}..."
log_info "This may take several minutes..."

if flyctl deploy \
    --config "${TEMP_CONFIG}" \
    --app "${APP_NAME}" \
    --image "ghcr.io/chrisgleissner/sidflow:${TAG}" \
    --strategy rolling \
    --wait-timeout 300; then
    
    log_success "Deployment completed"
    
    # Cleanup temp config
    rm -f "${TEMP_CONFIG}"
    
    # Verify deployment
    log_info "Verifying deployment..."
    
    # Get app hostname
    APP_HOSTNAME=$(flyctl info --app "${APP_NAME}" --json 2>/dev/null | grep -o '"Hostname":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    if [[ -z "${APP_HOSTNAME}" ]]; then
        log_error "Could not determine app hostname"
        exit 1
    fi
    
    log_info "App URL: https://${APP_HOSTNAME}"
    
    # Check health endpoint
    HEALTH_URL="https://${APP_HOSTNAME}/api/health"
    log_info "Checking health endpoint: ${HEALTH_URL}"
    
    MAX_ATTEMPTS=30
    for attempt in $(seq 1 ${MAX_ATTEMPTS}); do
        log_info "Health check attempt ${attempt}/${MAX_ATTEMPTS}..."
        
        if curl -sf --max-time 10 "${HEALTH_URL}" > /dev/null 2>&1; then
            log_success "✓ Health check passed!"
            log_success "✓ App is reachable at: https://${APP_HOSTNAME}"
            log_info "View logs: flyctl logs --app ${APP_NAME}"
            exit 0
        fi
        
        if [[ ${attempt} -lt ${MAX_ATTEMPTS} ]]; then
            log_info "Waiting 10 seconds before next attempt..."
            sleep 10
        fi
    done
    
    log_error "Health check failed after ${MAX_ATTEMPTS} attempts"
    log_info "The app may still be starting. Check logs: flyctl logs --app ${APP_NAME}"
    exit 1
else
    log_error "Deployment failed"
    rm -f "${TEMP_CONFIG}"
    exit 1
fi
