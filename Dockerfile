FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    BUN_INSTALL=/usr/local \
    BUN_VERSION=1.3.1 \
    K6_VERSION=0.52.0

# Copy apt packages list
COPY apt-packages.txt /tmp/apt-packages.txt

# Install all required APT packages (mirrors c64bridge approach)
RUN set -eux; \
    apt-get update; \
    if [ -s /tmp/apt-packages.txt ]; then \
      xargs -a /tmp/apt-packages.txt apt-get install -y --no-install-recommends; \
    fi; \
    rm -rf /var/lib/apt/lists/* /tmp/apt-packages.txt

# Ensure bash is available for GitHub Actions container shell
RUN bash --version

# Install Node.js 24 using n (provides modern Node + npm)
RUN set -eux; \
    npm install -g n; \
    n 24; \
    npm install -g npm@latest

# Install Bun under /usr/local
RUN set -eux; \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip; \
    unzip /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 /tmp/bun/bun-linux-x64/bun /usr/local/bin/bun; \
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx; \
    rm -rf /tmp/bun /tmp/bun.zip

# Install k6 (prebaked for perf runs in CI images)
RUN set -eux; \
    curl -fsSL "https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.tar.gz" -o /tmp/k6.tar.gz; \
    tar -xzf /tmp/k6.tar.gz -C /tmp; \
    install -m 0755 /tmp/k6-v${K6_VERSION}-linux-amd64/k6 /usr/local/bin/k6; \
    rm -rf /tmp/k6.tar.gz /tmp/k6-v${K6_VERSION}-linux-amd64

# Set up workspace
WORKDIR /workspace

# Pre-install Playwright browser (Chromium only to save time in CI)
RUN set -eux; \
    echo '{"dependencies":{"@playwright/test":"^1.40.0"}}' > /tmp/package.json; \
    cd /tmp && bun install && bunx playwright install --with-deps chromium; \
    rm -rf /tmp/package.json /tmp/node_modules /tmp/bun-*

# Use bash for subsequent RUN instructions and scripts
SHELL ["/bin/bash", "-c"]

# Ensure `/bin/sh` points to bash for compatibility with GitHub Actions runner
RUN ln -sf /bin/bash /bin/sh
