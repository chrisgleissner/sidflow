# Custom CI image with sidplayfp pre-installed
FROM ubuntu:24.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install sidplayfp
RUN apt-get update && apt-get install -y \
    sidplayfp \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Verify installations
RUN sidplayfp --version || echo "sidplayfp installed" && \
    bun --version

WORKDIR /workspace
