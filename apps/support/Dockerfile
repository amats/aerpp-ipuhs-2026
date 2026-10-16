# syntax=docker/dockerfile:1
FROM node:24-slim AS builder
WORKDIR /workspace
RUN npm install --global pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/support/package.json ./apps/support/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/firestore/package.json ./packages/firestore/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm --filter @aerpp/support... install --frozen-lockfile --network-concurrency=8 --fetch-timeout=180000
COPY apps/support ./apps/support
COPY packages/config ./packages/config
COPY packages/firestore ./packages/firestore
COPY packages/contracts ./packages/contracts
COPY docs/licenses ./docs/licenses
COPY scripts/licenses/collect-license-notices.mjs ./scripts/licenses/collect-license-notices.mjs
RUN node scripts/licenses/collect-license-notices.mjs --app support
# Support's production closure does not contain the Web-only PDF dependency patch.
RUN pnpm --filter @aerpp/support run build \
    && PNPM_CONFIG_ALLOW_UNUSED_PATCHES=true pnpm --filter @aerpp/support deploy --legacy --prod /output

FROM node:24-slim AS runner
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=builder --chown=node:node /output ./
COPY --chown=node:node LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY --from=builder --chown=node:node /workspace/docs/licenses ./docs/licenses
USER node
EXPOSE 8080
CMD ["node", "dist/server.mjs"]
