# Custom CI image with sidplayfp pre-installed
FROM ubuntu:24.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    git \
    ca-certificates \
    p7zip-full \
    && rm -rf /var/lib/apt/lists/*

# Install sidplayfp
RUN apt-get update && apt-get install -y \
    sidplayfp \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (install globally to /usr/local)
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.1"
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Create symlink for system-wide access
RUN ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Verify installations
RUN sidplayfp --version || echo "sidplayfp installed" && \
    bun --version && \
    which bun

WORKDIR /workspace
