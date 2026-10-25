# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY apps/server apps/server
RUN pnpm -r build && pnpm --filter @elemnt/server deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/server/demo ./demo
USER node
EXPOSE 8787
CMD ["node", "dist/main.js"]
