#!/usr/bin/env bash
# SIDFlow Fly.io Deployment Script
# Usage: ./scripts/deploy/fly-deploy.sh [-e stg|prd] [-t tag] [-r region]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Default values
ENVIRONMENT=""
TAG="latest"
REGION="lhr"  # London
FORCE=false
DRY_RUN=false

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Deploy SIDFlow to Fly.io with environment-specific configuration.

OPTIONS:
    -e, --environment <stg|prd>   Deployment environment (required)
    -t, --tag <tag>               Docker image tag (default: latest)
    -r, --region <region>         Fly.io region (default: lhr)
    -f, --force                   Force deployment without confirmation
    -n, --dry-run                 Show what would be deployed without deploying
    -h, --help                    Show this help message

EXAMPLES:
    # Deploy latest to staging
    $0 -e stg

    # Deploy specific version to production
    $0 -e prd -t v0.3.28

    # Deploy to different region
    $0 -e stg -r lhr

    # Dry run deployment
    $0 -e prd -t v0.3.28 --dry-run

PREREQUISITES:
    1. Install flyctl: curl -L https://fly.io/install.sh | sh
    2. Authenticate: flyctl auth login
    3. Create apps:
       flyctl apps create sidflow-stg --region lhr
       flyctl apps create sidflow-prd --region lhr
    4. Create volumes (one-time, Fly.io supports ONE volume per machine):
       flyctl volumes create sidflow_data --region lhr --size 3 --app sidflow-stg
       flyctl volumes create sidflow_data --region lhr --size 10 --app sidflow-prd
    5. Set secrets:
       flyctl secrets set SOME_SECRET=value --app sidflow-stg
       flyctl secrets set SOME_SECRET=value --app sidflow-prd

ENVIRONMENT:
    FLY_API_TOKEN    Fly.io API token (for CI/CD)

EOF
    exit 0
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check flyctl
    if ! command -v flyctl &> /dev/null; then
        log_error "flyctl not found. Install it from https://fly.io/install"
        exit 1
    fi

    # Check authentication
    if ! flyctl auth whoami &> /dev/null; then
        log_error "Not authenticated with Fly.io. Run: flyctl auth login"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

validate_environment() {
    case "${ENVIRONMENT}" in
        stg|prd)
            log_info "Environment: ${ENVIRONMENT}"
            ;;
        *)
            log_error "Invalid environment: ${ENVIRONMENT}. Must be 'stg' or 'prd'"
            usage
            ;;
    esac
}

get_app_name() {
    echo "sidflow-${ENVIRONMENT}"
}

check_app_exists() {
    local app_name="$1"
    
    if ! flyctl apps list | grep -q "^${app_name}"; then
        log_error "App '${app_name}' does not exist"
        log_info "Create it with: flyctl apps create ${app_name} --region ${REGION}"
        exit 1
    fi
    
    log_success "App '${app_name}' exists"
}

check_volumes() {
    local app_name="$1"
    
    log_info "Checking volumes for ${app_name}..."
    
    local volumes
    volumes=$(flyctl volumes list --app "${app_name}" 2>/dev/null || echo "")
    
    if [[ -z "${volumes}" ]]; then
        log_warning "No volumes found for ${app_name}"
        log_info "Create volumes with:"
        log_info "  flyctl volumes create sidflow_data --region ${REGION} --size 10 --app ${app_name}"
        log_warning "Deployment will continue but may fail without the sidflow_data volume mounted at /mnt/data"
    else
        log_success "Volumes exist for ${app_name}"
    fi
}

build_fly_toml() {
    local app_name="$1"
    local temp_toml="${REPO_ROOT}/fly.${ENVIRONMENT}.toml"
    
    log_info "Generating fly.toml for ${app_name}..."
    
    # Copy base fly.toml and customize for environment
    cp "${REPO_ROOT}/fly.toml" "${temp_toml}"
    
    # Update app name
    sed -i "s/^app = .*/app = \"${app_name}\"/" "${temp_toml}"
    
    # Update region
    sed -i "s/^primary_region = .*/primary_region = \"${REGION}\"/" "${temp_toml}"
    
    # Update image tag
    sed -i "s|image = .*|image = \"ghcr.io/chrisgleissner/sidflow:${TAG}\"|" "${temp_toml}"
    
    echo "${temp_toml}"
}

deploy() {
    local app_name="$1"
    local temp_toml="$2"
    
    log_info "Deploying ${app_name} with image tag: ${TAG}"
    
    if [[ "${DRY_RUN}" == "true" ]]; then
        log_warning "DRY RUN: Would deploy with these settings:"
        log_info "  App: ${app_name}"
        log_info "  Image: ghcr.io/chrisgleissner/sidflow:${TAG}"
        log_info "  Region: ${REGION}"
        log_info "  Config: ${temp_toml}"
        cat "${temp_toml}"
        return 0
    fi
    
    # Confirm deployment for production
    if [[ "${ENVIRONMENT}" == "prd" && "${FORCE}" != "true" ]]; then
        log_warning "You are about to deploy to PRODUCTION"
        read -p "Continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            log_info "Deployment cancelled"
            exit 0
        fi
    fi
    
    # Deploy to Fly.io
    log_info "Starting deployment..."
    flyctl deploy \
        --config "${temp_toml}" \
        --app "${app_name}" \
        --image "ghcr.io/chrisgleissner/sidflow:${TAG}" \
        --strategy rolling \
        --wait-timeout 300
    
    log_success "Deployment completed"
}

verify_deployment() {
    local app_name="$1"
    
    log_info "Verifying deployment..."
    
    # Get app URL
    local app_url
    app_url=$(flyctl info --app "${app_name}" --json | grep -o '"Hostname":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    if [[ -z "${app_url}" ]]; then
        log_warning "Could not determine app URL"
        return 0
    fi
    
    log_info "App URL: https://${app_url}"
    
    # Check health endpoint
    log_info "Checking health endpoint..."
    local health_url="https://${app_url}/api/health"
    local max_attempts=10
    local attempt=1
    
    while [[ ${attempt} -le ${max_attempts} ]]; do
        log_info "Health check attempt ${attempt}/${max_attempts}..."
        
        if curl -sf --max-time 10 "${health_url}" > /dev/null 2>&1; then
            log_success "Health check passed: ${health_url}"
            return 0
        fi
        
        sleep 10
        ((attempt++))
    done
    
    log_warning "Health check did not pass after ${max_attempts} attempts"
    log_info "Check logs with: flyctl logs --app ${app_name}"
}

cleanup() {
    local temp_toml="${REPO_ROOT}/fly.${ENVIRONMENT}.toml"
    if [[ -f "${temp_toml}" ]]; then
        rm -f "${temp_toml}"
    fi
}

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -t|--tag)
                TAG="$2"
                shift 2
                ;;
            -r|--region)
                REGION="$2"
                shift 2
                ;;
            -f|--force)
                FORCE=true
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                ;;
        esac
    done
    
    # Validate required arguments
    if [[ -z "${ENVIRONMENT}" ]]; then
        log_error "Environment is required"
        usage
    fi
    
    validate_environment
    check_prerequisites
    
    local app_name
    app_name=$(get_app_name)
    
    check_app_exists "${app_name}"
    check_volumes "${app_name}"
    
    local temp_toml
    temp_toml=$(build_fly_toml "${app_name}")
    
    trap cleanup EXIT
    
    deploy "${app_name}" "${temp_toml}"
    verify_deployment "${app_name}"
    
    log_success "Deployment to ${ENVIRONMENT} completed successfully!"
    log_info "View logs: flyctl logs --app ${app_name}"
    log_info "Scale app: flyctl scale count 2 --app ${app_name}"
    log_info "SSH access: flyctl ssh console --app ${app_name}"
}

main "$@"
