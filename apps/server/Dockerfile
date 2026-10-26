# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/elements/package.json packages/elements/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY packages/elements packages/elements
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm -r build && pnpm --filter @elemnt/server deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/server/demo ./demo
COPY --from=build /repo/apps/web/dist ./web
ENV ELEMNT_WEB_DIR=/app/web
# Owned by the server's user so a fresh volume mounted here is writable.
RUN mkdir -p /data/blobs && chown node:node /data/blobs
USER node
EXPOSE 8787
CMD ["node", "dist/main.js"]
