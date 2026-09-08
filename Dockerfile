FROM node:22-bookworm-slim AS base
RUN npm install --global pnpm@11.19.0
WORKDIR /app

FROM base AS build
RUN apt-get update && apt-get install --yes --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS production-dependencies
RUN apt-get update && apt-get install --yes --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
ARG VERSION=0.1.0
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Keyfolio" \
      org.opencontainers.image.description="Self-hosted encrypted account manager" \
      org.opencontainers.image.source="https://github.com/wxDadadada/account-vault" \
      org.opencontainers.image.url="https://github.com/wxDadadada/account-vault" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 DATA_DIR=/app/data
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4318/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/server/index.js"]
