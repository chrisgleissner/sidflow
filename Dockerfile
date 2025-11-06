FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_VERSION=1.3.1

COPY apt-packages.txt /tmp/apt-packages.txt

RUN set -eux; \
    apt-get update; \
    xargs -a /tmp/apt-packages.txt apt-get install -y --no-install-recommends; \
    rm -rf /var/lib/apt/lists/* /tmp/apt-packages.txt

RUN set -eux; \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip; \
    unzip /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 /tmp/bun/bun-linux-x64/bun /usr/local/bin/bun; \
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx; \
    rm -rf /tmp/bun /tmp/bun.zip

WORKDIR /workspace
