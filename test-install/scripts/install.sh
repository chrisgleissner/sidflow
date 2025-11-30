#!/usr/bin/env bash
#
# SIDFlow Production Installation Script
# Performs initial deployment of SIDFlow on a Raspberry Pi or similar host
#
# Usage: install.sh [OPTIONS]
#
# Options:
#   -d, --dir DIR           Base installation directory (default: /opt/sidflow)
#   -t, --tag TAG           Docker image tag to install (default: latest)
#   -p, --port PORT         Port to expose (default: 3000)
#   -u, --user USER         Admin username (default: admin)
#   -P, --password PASS     Admin password (required, or set SIDFLOW_ADMIN_PASSWORD)
#   -e, --env ENV           Environment: stg or prd (default: prd)
#   -r, --force-recreate    Stop/remove any existing containers before starting
#   -B, --build-image       Build Docker image locally before start (uses Dockerfile.production)
#   --skip-pull             Skip pulling the Docker image
#   --dry-run               Show what would be done without executing
#   -h, --help              Show this help message
#
# Environment Variables:
#   SIDFLOW_ADMIN_PASSWORD  Admin password (alternative to -P flag)
#   SIDFLOW_IMAGE           Custom Docker image (default: ghcr.io/chrisgleissner/sidflow)
#
# Examples:
#   install.sh -P 'my-secure-password'
#   install.sh -d /srv/sidflow -t v0.3.28 -e stg
#   SIDFLOW_ADMIN_PASSWORD='secret' install.sh

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Load local overrides (including SIDFLOW_ADMIN_PASSWORD) from .env if present
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ROOT_DIR}/.env"
  set +a
fi

# Default values
INSTALL_DIR="/opt/sidflow"
IMAGE_TAG="latest"
PORT="3000"
ADMIN_USER="admin"
ADMIN_PASSWORD="${SIDFLOW_ADMIN_PASSWORD:-}"
ENVIRONMENT="prd"
DOCKER_IMAGE="${SIDFLOW_IMAGE:-ghcr.io/chrisgleissner/sidflow}"
SKIP_PULL=false
DRY_RUN=false
FORCE_RECREATE=false
BUILD_IMAGE=false
DOCKERFILE_PATH="${SIDFLOW_DOCKERFILE:-Dockerfile.production}"
CONTAINER_UID="${SIDFLOW_CONTAINER_UID:-$(id -u)}"
CONTAINER_GID="${SIDFLOW_CONTAINER_GID:-$(id -g)}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

SUDO_BIN="${USE_SUDO-sudo}"
if [[ "$SUDO_BIN" == "sudo" ]]; then
    SUDO_BIN="sudo -n"
fi
as_root() {
    if [[ -n "$SUDO_BIN" ]]; then
        run_cmd "$SUDO_BIN" "$@"
    else
        run_cmd "$@"
    fi
}

tee_root() {
    if [[ -n "$SUDO_BIN" ]]; then
        "$SUDO_BIN" tee "$@"
    else
        tee "$@"
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
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -r|--force-recreate)
            FORCE_RECREATE=true
            shift
            ;;
        -B|--build-image)
            BUILD_IMAGE=true
            shift
            ;;
        --uid)
            CONTAINER_UID="$2"
            shift 2
            ;;
        --gid)
            CONTAINER_GID="$2"
            shift 2
            ;;
        -u|--user)
            ADMIN_USER="$2"
            shift 2
            ;;
        -P|--password)
            ADMIN_PASSWORD="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --skip-pull)
            SKIP_PULL=true
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

# Resolve INSTALL_DIR to absolute path if it's not already
if [[ "$INSTALL_DIR" != /* ]]; then
    # Create the directory if it doesn't exist so we can resolve its path
    mkdir -p "$INSTALL_DIR"
    INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
fi

# Validate environment
if [[ "$ENVIRONMENT" != "stg" && "$ENVIRONMENT" != "prd" ]]; then
    die "Environment must be 'stg' or 'prd', got: $ENVIRONMENT"
fi

# Validate password
if [[ -z "$ADMIN_PASSWORD" ]]; then
    die "Admin password is required. Use -P or set SIDFLOW_ADMIN_PASSWORD environment variable."
fi

if [[ ${#ADMIN_PASSWORD} -lt 16 ]]; then
    log_warn "Admin password is less than 16 characters. Consider using a stronger password."
fi

# Check prerequisites
command -v docker >/dev/null 2>&1 || die "Docker is required but not installed."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required but not installed."

log_info "SIDFlow Installation"
log_info "===================="
log_info "Environment:     $ENVIRONMENT"
log_info "Install dir:     $INSTALL_DIR"
log_info "Docker image:    $DOCKER_IMAGE:$IMAGE_TAG"
log_info "Port:            $PORT"
log_info "Admin user:      $ADMIN_USER"
echo

# Create directory structure
log_info "Creating directory structure..."
# Include classified/renders/availability so health checks don't fail on first start
as_root mkdir -p "$INSTALL_DIR"/{data/{hvsc,wav-cache,tags,sidflow/{classified,renders,availability}},config,scripts,backups}

# Set ownership for container (UID 1000 - standard node user)
log_info "Setting directory ownership (UID 1000:1000)..."
if [[ -n "$SUDO_BIN" ]]; then
    as_root chown -R "${CONTAINER_UID}:${CONTAINER_GID}" "$INSTALL_DIR/data"
    # Ensure the workspace mounts (hvsc/wav-cache/tags) are writable by the container user
    as_root chown -R "${CONTAINER_UID}:${CONTAINER_GID}" "$INSTALL_DIR/data/hvsc" "$INSTALL_DIR/data/wav-cache" "$INSTALL_DIR/data/tags" "$INSTALL_DIR/data/sidflow"
    # Ensure workspace root exists and is writable for the container user
    as_root mkdir -p "$INSTALL_DIR/workspace"
    as_root chown -R "${CONTAINER_UID}:${CONTAINER_GID}" "$INSTALL_DIR/workspace"
else
    run_cmd mkdir -p "$INSTALL_DIR/workspace"
    run_cmd chmod -R 777 "$INSTALL_DIR/data" "$INSTALL_DIR/workspace" || true
fi

# Create environment file
ENV_FILE="$INSTALL_DIR/config/.env.$ENVIRONMENT"
log_info "Creating environment file: $ENV_FILE"

if [[ "$DRY_RUN" != "true" ]]; then
    tee_root "$ENV_FILE" > /dev/null << EOF
# SIDFlow $ENVIRONMENT Environment Configuration
# Generated by install.sh on $(date -Iseconds)

# Admin credentials
SIDFLOW_ADMIN_USER=$ADMIN_USER
SIDFLOW_ADMIN_PASSWORD=$ADMIN_PASSWORD

# Paths (relative to docker-compose.production.yml location)
SIDFLOW_SID_PATH=$INSTALL_DIR/data/hvsc
SIDFLOW_WAV_CACHE=$INSTALL_DIR/data/wav-cache
SIDFLOW_TAGS_PATH=$INSTALL_DIR/data/tags
SIDFLOW_DATA_PATH=$INSTALL_DIR/data/sidflow

# Port mapping
SIDFLOW_PORT=$PORT
EOF
    # Make env file readable by the invoking user so docker compose can load it
    as_root chown "$USER":"$USER" "$ENV_FILE"
    as_root chmod 600 "$ENV_FILE"
    log_success "Environment file created with restricted permissions"
fi

# Create docker-compose override for environment
COMPOSE_FILE="$INSTALL_DIR/config/docker-compose.$ENVIRONMENT.yml"
log_info "Creating Docker Compose file: $COMPOSE_FILE"

if [[ "$DRY_RUN" != "true" ]]; then
    tee_root "$COMPOSE_FILE" > /dev/null << EOF
# SIDFlow $ENVIRONMENT Docker Compose Configuration
# Generated by install.sh on $(date -Iseconds)

services:
  sidflow:
    image: $DOCKER_IMAGE:$IMAGE_TAG
    container_name: sidflow-$ENVIRONMENT
    restart: unless-stopped
    
    # Security hardening
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
      - NET_BIND_SERVICE
    read_only: true
    user: "${CONTAINER_UID}:${CONTAINER_GID}"
    
    # Resource limits
    deploy:
      resources:
        limits:
          cpus: "4"
          memory: 2g
        reservations:
          cpus: "1"
          memory: 512m
    
    ports:
      - "\${SIDFLOW_PORT:-$PORT}:3000"
    
    environment:
      - NODE_ENV=production
      - SIDFLOW_ADMIN_USER=\${SIDFLOW_ADMIN_USER:-admin}
      - SIDFLOW_ADMIN_PASSWORD=\${SIDFLOW_ADMIN_PASSWORD:?SIDFLOW_ADMIN_PASSWORD is required}
      - SIDFLOW_ROOT=/sidflow
      - SIDFLOW_CONFIG=/sidflow/.sidflow.json
      - SIDFLOW_EXPECT_UID=${CONTAINER_UID}
    
    volumes:
      - \${SIDFLOW_SID_PATH:-$INSTALL_DIR/data/hvsc}:/sidflow/workspace/hvsc:ro
      - \${SIDFLOW_WAV_CACHE:-$INSTALL_DIR/data/wav-cache}:/sidflow/workspace/wav-cache
      - \${SIDFLOW_TAGS_PATH:-$INSTALL_DIR/data/tags}:/sidflow/workspace/tags
      - \${SIDFLOW_DATA_PATH:-$INSTALL_DIR/data/sidflow}:/sidflow/data
      - type: tmpfs
        target: /tmp
        tmpfs:
          size: 100M
          mode: 1777
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
        tag: "sidflow-$ENVIRONMENT"
EOF
    as_root chown "$USER":"$USER" "$COMPOSE_FILE"
    log_success "Docker Compose file created"
fi

# Build Docker image locally if requested
if [[ "$BUILD_IMAGE" == "true" ]]; then
    log_info "Building Docker image locally: $DOCKER_IMAGE:$IMAGE_TAG (Dockerfile: $DOCKERFILE_PATH)"
    log_info "Using UID: $CONTAINER_UID, GID: $CONTAINER_GID"
    if [[ "$DRY_RUN" != "true" ]]; then
        docker build \
            --build-arg SIDFLOW_UID="$CONTAINER_UID" \
            --build-arg SIDFLOW_GID="$CONTAINER_GID" \
            -f "$DOCKERFILE_PATH" \
            -t "$DOCKER_IMAGE:$IMAGE_TAG" \
            "$(cd "$ROOT_DIR" && pwd)"
        log_success "Docker image built locally"
    else
        echo "[DRY-RUN] docker build --build-arg SIDFLOW_UID=$CONTAINER_UID --build-arg SIDFLOW_GID=$CONTAINER_GID -f $DOCKERFILE_PATH -t $DOCKER_IMAGE:$IMAGE_TAG $(cd "$ROOT_DIR" && pwd)"
    fi
    # If we built locally, skip pulling
    SKIP_PULL=true
fi

# Pull Docker image
if [[ "$SKIP_PULL" != "true" ]]; then
    log_info "Pulling Docker image: $DOCKER_IMAGE:$IMAGE_TAG"
    run_cmd docker pull "$DOCKER_IMAGE:$IMAGE_TAG"
    log_success "Docker image pulled"
fi

# Copy deployment scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_info "Installing deployment scripts to $INSTALL_DIR/scripts/"

if [[ "$DRY_RUN" != "true" ]]; then
    for script in "$SCRIPT_DIR"/*.sh; do
        if [[ -f "$script" ]]; then
            as_root cp "$script" "$INSTALL_DIR/scripts/"
            as_root chmod +x "$INSTALL_DIR/scripts/$(basename "$script")"
        fi
    done
    log_success "Deployment scripts installed"
fi

# Create convenience symlinks
log_info "Creating convenience symlinks..."
as_root ln -sf "$INSTALL_DIR/scripts/status.sh" "/usr/local/bin/sidflow-status" 2>/dev/null || true
as_root ln -sf "$INSTALL_DIR/scripts/logs.sh" "/usr/local/bin/sidflow-logs" 2>/dev/null || true
as_root ln -sf "$INSTALL_DIR/scripts/backup.sh" "/usr/local/bin/sidflow-backup" 2>/dev/null || true

# Start the service
log_info "Starting SIDFlow ($ENVIRONMENT)..."
if [[ "$DRY_RUN" != "true" ]]; then
    cd "$INSTALL_DIR/config"
    if [[ "$FORCE_RECREATE" == "true" ]]; then
        log_info "Force recreate enabled — stopping any existing sidflow-$ENVIRONMENT stack..."
        docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" down || true
    fi
    docker compose -f "docker-compose.$ENVIRONMENT.yml" --env-file ".env.$ENVIRONMENT" up -d
    log_success "SIDFlow started"
fi

# Wait for health check
log_info "Waiting for health check..."
TIMEOUT=60
ELAPSED=0
INTERVAL=5

while [[ $ELAPSED -lt $TIMEOUT ]]; do
    if [[ "$DRY_RUN" == "true" ]]; then
        log_success "[DRY-RUN] Would wait for health check"
        break
    fi
    
    if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
        log_success "Health check passed"
        break
    fi
    
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    echo -n "."
done

if [[ $ELAPSED -ge $TIMEOUT && "$DRY_RUN" != "true" ]]; then
    log_warn "Health check timeout. Check logs with: docker logs sidflow-$ENVIRONMENT"
fi

echo
log_success "Installation complete!"
echo
log_info "Useful commands:"
echo "  View status:    $INSTALL_DIR/scripts/status.sh -e $ENVIRONMENT"
echo "  View logs:      $INSTALL_DIR/scripts/logs.sh -e $ENVIRONMENT"
echo "  Run backup:     $INSTALL_DIR/scripts/backup.sh -e $ENVIRONMENT"
echo "  Update image:   $INSTALL_DIR/scripts/update.sh -e $ENVIRONMENT -t <tag>"
echo
log_info "Access SIDFlow at: http://localhost:$PORT"
