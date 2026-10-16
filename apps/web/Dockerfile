# syntax=docker/dockerfile:1

FROM node:24-slim AS dependencies
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/documents/package.json ./packages/documents/package.json
COPY packages/config/package.json ./packages/config/package.json
RUN pnpm --filter @aerpp/web... install --frozen-lockfile --network-concurrency=8 --fetch-timeout=180000

FROM dependencies AS builder
COPY apps/web ./apps/web
COPY --from=research_assets . ./apps/web/assets/
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY docs/licenses ./docs/licenses
COPY scripts/licenses/collect-license-notices.mjs scripts/licenses/stage-license-notices.mjs ./scripts/licenses/
RUN node scripts/licenses/collect-license-notices.mjs --app web
COPY packages/contracts ./packages/contracts
COPY packages/documents ./packages/documents
COPY packages/config ./packages/config
COPY config/common/llm ./config/common/llm
COPY config/common/survey ./config/common/survey
COPY config/common/documents ./config/common/documents
WORKDIR /workspace/apps/web
# Secret contents do not invalidate Docker's cache; the wrapper supplies their input digest.
ARG BUILD_INPUT_SHA
RUN --mount=type=secret,id=web_build,required=true \
    test -n "$BUILD_INPUT_SHA" && node scripts/build-image-app.mjs
RUN test -f .next/standalone/apps/web/server.js

FROM node:24-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ARG AERPP_ENVIRONMENT
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION io.aerpp.environment=$AERPP_ENVIRONMENT
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/web
COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone /app
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /workspace/apps/web/public ./public
COPY --from=builder --chown=node:node /workspace/LICENSE /workspace/NOTICE /workspace/THIRD_PARTY_NOTICES.md /app/
COPY --from=builder --chown=node:node /workspace/docs/licenses /app/docs/licenses
COPY --from=builder --chown=node:node /workspace/apps/web/generated/licenses ./generated/licenses
COPY --from=builder --chown=node:node /workspace/config/common/llm /app/config/common/llm
RUN mkdir -p /tmp/aerpp-coordination && chown node:node /tmp/aerpp-coordination && chmod 700 /tmp/aerpp-coordination
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
