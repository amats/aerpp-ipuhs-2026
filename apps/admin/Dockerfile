# syntax=docker/dockerfile:1
FROM node:24-slim AS dependencies
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/firestore/package.json ./packages/firestore/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/documents/package.json ./packages/documents/package.json
RUN pnpm --filter @aerpp/admin... install --frozen-lockfile --network-concurrency=8 --fetch-timeout=180000

FROM dependencies AS builder
COPY apps/admin ./apps/admin
COPY packages/config ./packages/config
COPY packages/firestore ./packages/firestore
COPY packages/contracts ./packages/contracts
COPY packages/documents ./packages/documents
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY docs/licenses ./docs/licenses
COPY scripts/licenses/collect-license-notices.mjs scripts/licenses/stage-license-notices.mjs ./scripts/licenses/
RUN node scripts/licenses/collect-license-notices.mjs --app admin
WORKDIR /workspace/apps/admin
ARG AERPP_ENVIRONMENT
ARG BUILD_INPUT_SHA
RUN test -n "$BUILD_INPUT_SHA" && node scripts/build-image-app.mjs
RUN test -f .next/standalone/apps/admin/server.js

FROM node:24-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
ARG AERPP_ENVIRONMENT
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION io.aerpp.environment=$AERPP_ENVIRONMENT
WORKDIR /app/apps/admin
COPY --from=builder --chown=node:node /workspace/apps/admin/.next/standalone /app
COPY --from=builder --chown=node:node /workspace/apps/admin/.next/static ./.next/static
COPY --from=builder --chown=node:node /workspace/apps/admin/public ./public
COPY --from=builder --chown=node:node /workspace/LICENSE /workspace/NOTICE /workspace/THIRD_PARTY_NOTICES.md /app/
COPY --from=builder --chown=node:node /workspace/docs/licenses /app/docs/licenses
COPY --from=builder --chown=node:node /workspace/apps/admin/generated/licenses ./generated/licenses
COPY --from=builder --chown=node:node /workspace/apps/admin/scripts/start-image.mjs /workspace/apps/admin/scripts/build-environment.mjs ./scripts/
USER node
EXPOSE 8080
CMD ["node", "scripts/start-image.mjs"]
