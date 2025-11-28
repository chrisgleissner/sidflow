#!/usr/bin/env bash
#
# SIDFlow Production Installation Script
# Performs initial deployment of SIDFlow on a Raspberry Pi or similar host
#
# IMPORTANT: This script auto-detects whether sudo is needed for Docker operations.
#            - Rootless Docker: Run directly as your user
#            - Standard Docker: Run with sudo (script will detect and use it)
#            - Override: Set USE_SUDO="" to force no-sudo mode
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

# Default values
INSTALL_DIR="/opt/sidflow"
IMAGE_TAG="latest"
PORT="3000"
ADMIN_USER="admin"
ADMIN_PASSWORD="${SIDFLOW_ADMIN_PASSWORD:-}"
ENVIRONMENT="prd"
# If SIDFLOW_IMAGE already contains a tag (e.g., sidflow:local), don't append IMAGE_TAG later
if [[ "${SIDFLOW_IMAGE:-}" =~ : ]]; then
  DOCKER_IMAGE="${SIDFLOW_IMAGE}"
  IMAGE_TAG=""  # Don't append tag since image already has one
else
  DOCKER_IMAGE="${SIDFLOW_IMAGE:-ghcr.io/chrisgleissner/sidflow}"
fi
SKIP_PULL=false
DRY_RUN=false
FORCE_RECREATE=false
BUILD_IMAGE=false
DOCKERFILE_PATH="${SIDFLOW_DOCKERFILE:-Dockerfile.production}"
# Default to UID/GID 1000 (standard node user from base image)
# This avoids permission mismatches when bind-mounting host directories
CONTAINER_UID="${SIDFLOW_CONTAINER_UID:-1000}"
CONTAINER_GID="${SIDFLOW_CONTAINER_GID:-1000}"

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

# Check if USE_SUDO is explicitly set (even to empty string)
if [[ -v USE_SUDO ]]; then
    # USE_SUDO was set by user - respect it (even if empty for no-sudo mode)
    SUDO_BIN="$USE_SUDO"
else
    # USE_SUDO not set - auto-detect
    if [[ "$EUID" -eq 0 ]]; then
        # Already running as root - don't use sudo
        SUDO_BIN=""
    else
        # Not root - check if we can run Docker without sudo (rootless mode)
        if docker info >/dev/null 2>&1; then
            # Docker works without sudo - likely rootless mode
            SUDO_BIN=""
        elif command -v sudo >/dev/null 2>&1; then
            # Need sudo for Docker
            SUDO_BIN="sudo"
        else
            SUDO_BIN=""
        fi
    fi
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
            # Only set IMAGE_TAG if DOCKER_IMAGE doesn't already contain a tag
            if [[ ! "${DOCKER_IMAGE}" =~ : ]]; then
              IMAGE_TAG="$2"
            fi
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
    as_root mkdir -p "$INSTALL_DIR"
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
if [[ -n "$IMAGE_TAG" ]]; then
  log_info "Docker image:    $DOCKER_IMAGE:$IMAGE_TAG"
else
  log_info "Docker image:    $DOCKER_IMAGE"
fi
log_info "Port:            $PORT"
log_info "Admin user:      $ADMIN_USER"
echo

# Create directory structure
log_info "Creating directory structure..."
# Create workspace subdirectories (hvsc, wav-cache, tags) and data subdirectories
as_root mkdir -p "$INSTALL_DIR"/{workspace/{hvsc,wav-cache,tags},data/{classified,renders,availability},config,scripts,backups}

# Set ownership for container (UID matches container user)
log_info "Setting directory ownership (UID ${CONTAINER_UID}:${CONTAINER_GID})..."
if [[ -n "$SUDO_BIN" ]]; then
    # Ensure workspace and data directories are owned by container user
    as_root chown -R "${CONTAINER_UID}:${CONTAINER_GID}" "$INSTALL_DIR/workspace" "$INSTALL_DIR/data"
else
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
SIDFLOW_SID_PATH=$INSTALL_DIR/workspace/hvsc
SIDFLOW_WAV_CACHE=$INSTALL_DIR/workspace/wav-cache
SIDFLOW_TAGS_PATH=$INSTALL_DIR/workspace/tags
SIDFLOW_DATA_PATH=$INSTALL_DIR/data

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

# Determine final image reference
if [[ -n "$IMAGE_TAG" ]]; then
  FINAL_IMAGE="$DOCKER_IMAGE:$IMAGE_TAG"
else
  FINAL_IMAGE="$DOCKER_IMAGE"
fi

if [[ "$DRY_RUN" != "true" ]]; then
    tee_root "$COMPOSE_FILE" > /dev/null << EOF
# SIDFlow $ENVIRONMENT Docker Compose Configuration
# Generated by install.sh on $(date -Iseconds)

services:
  sidflow:
    image: $FINAL_IMAGE
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
    # read_only: true  # DISABLED: Prevents bash from reading startup script
    user: "${CONTAINER_UID}:${CONTAINER_GID}"
    
    # Resource limits
    deploy:
      resources:
        limits:
          cpus: "8"
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
      - $INSTALL_DIR/workspace:/sidflow/workspace:rw
      - $INSTALL_DIR/data:/sidflow/data:rw
    
    tmpfs:
      - /tmp:exec,mode=1777
      - /app/packages/sidflow-web/.next/cache:uid=${CONTAINER_UID},gid=${CONTAINER_GID},mode=0755
    
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
    # Determine build target tag
    if [[ -n "$IMAGE_TAG" ]]; then
        BUILD_TAG="$DOCKER_IMAGE:$IMAGE_TAG"
    else
        BUILD_TAG="$DOCKER_IMAGE"
    fi
    
    log_info "Building Docker image locally: $BUILD_TAG (Dockerfile: $DOCKERFILE_PATH)"
    log_info "Using UID: $CONTAINER_UID, GID: $CONTAINER_GID"
    if [[ "$DRY_RUN" != "true" ]]; then
        docker build \
            --build-arg SIDFLOW_UID="$CONTAINER_UID" \
            --build-arg SIDFLOW_GID="$CONTAINER_GID" \
            -f "$DOCKERFILE_PATH" \
            -t "$BUILD_TAG" \
            "$(cd "$ROOT_DIR" && pwd)"
        log_success "Docker image built locally"
    else
        echo "[DRY-RUN] docker build --build-arg SIDFLOW_UID=$CONTAINER_UID --build-arg SIDFLOW_GID=$CONTAINER_GID -f $DOCKERFILE_PATH -t $BUILD_TAG $(cd "$ROOT_DIR" && pwd)"
    fi
    # If we built locally, skip pulling
    SKIP_PULL=true
fi

# Pull Docker image
if [[ "$SKIP_PULL" != "true" ]]; then
    if [[ -n "$IMAGE_TAG" ]]; then
      log_info "Pulling Docker image: $DOCKER_IMAGE:$IMAGE_TAG"
      run_cmd docker pull "$DOCKER_IMAGE:$IMAGE_TAG"
    else
      log_info "Pulling Docker image: $DOCKER_IMAGE"
      run_cmd docker pull "$DOCKER_IMAGE"
    fi
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
