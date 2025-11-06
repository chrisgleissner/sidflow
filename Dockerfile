FROM ubuntu:24.04

# Accept build-time hash argument to force cache invalidation when context changes
ARG CONTEXT_HASH

# Non-interactive APT to avoid tzdata or keyboard prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_VERSION=1.3.1

# ---------------------------------------------------------------------------
# 1. Install system dependencies from apt-packages.txt
# ---------------------------------------------------------------------------
COPY apt-packages.txt /tmp/apt-packages.txt

RUN set -euxo pipefail; \
    echo ">>> Rebuild key (context hash): ${CONTEXT_HASH}"; \
    apt-get update; \
    # Read package list directly from file and install in one transaction
    xargs -a /tmp/apt-packages.txt apt-get install -y --no-install-recommends; \
    # Clean up apt cache and temporary files to reduce image size
    rm -rf /var/lib/apt/lists/* /tmp/apt-packages.txt

# ---------------------------------------------------------------------------
# 2. Install Bun runtime
# ---------------------------------------------------------------------------
RUN set -euxo pipefail; \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip; \
    unzip /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 /tmp/bun/bun-linux-x64/bun /usr/local/bin/bun; \
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx; \
    rm -rf /tmp/bun /tmp/bun.zip

# ---------------------------------------------------------------------------
# 3. Set working directory and defaults
# ---------------------------------------------------------------------------
WORKDIR /workspace

# Optional sanity check
RUN bash --version && bun --version

# Default entrypoint is left empty to allow workflows to define commands
