FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/root/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

COPY apt-packages.txt /tmp/apt-packages.txt

RUN set -eux; \
    apt-get update; \
    if [ -s /tmp/apt-packages.txt ]; then \
      xargs -r apt-get install -y --no-install-recommends < /tmp/apt-packages.txt; \
    fi; \
    rm -rf /var/lib/apt/lists/* /tmp/apt-packages.txt

RUN curl -fsSL https://bun.sh/install | bash && \
    ln -sf "${BUN_INSTALL}/bin/bun" /usr/local/bin/bun && \
    ln -sf "${BUN_INSTALL}/bin/bunx" /usr/local/bin/bunx

WORKDIR /workspace
