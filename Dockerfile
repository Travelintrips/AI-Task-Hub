FROM node:24-bookworm-slim AS build

WORKDIR /workspace
ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run typecheck
RUN pnpm --filter @workspace/ai-task-center run build
RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/api-server deploy --legacy --prod /runtime/artifacts/api-server \
    && mkdir -p /runtime/artifacts/ai-task-center \
    && cp -R artifacts/api-server/dist /runtime/artifacts/api-server/dist \
    && cp -R artifacts/ai-task-center/dist /runtime/artifacts/ai-task-center/dist

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /runtime/ /app/

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
