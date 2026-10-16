FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie

USER root

COPY setup-gcloud-repository.sh /tmp/setup-gcloud-repository.sh
# Repository registration relies on these packages from the base image.
RUN for package in ca-certificates curl gnupg; do \
        if [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null)" != "install ok installed" ]; then \
            echo "Required base-image package is missing: $package" >&2; \
            exit 1; \
        fi; \
    done \
    && bash /tmp/setup-gcloud-repository.sh \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        fonts-noto-cjk-extra unzip google-cloud-cli \
    && gcloud version \
    && rm /tmp/setup-gcloud-repository.sh \
    && rm -rf /var/lib/apt/lists/*

USER node
