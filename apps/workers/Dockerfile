FROM node:22.21-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/workers/package.json apps/workers/package.json
COPY packages packages
COPY tooling tooling
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @agentscope/workers... build

FROM base AS runner
ENV NODE_ENV=production
# Run as the unprivileged `node` user that the `node:22.21-bookworm-slim`
# image ships with (UID 1000). The default user is root, which would let
# a compromised worker process read or modify any file on the
# container's filesystem (including the encrypted per-agent API key
# material that the worker reads from the database). `--chown=node:node`
# ensures the copied app tree is readable by the unprivileged user;
# `CMD` then runs with that user's identity.
COPY --from=build --chown=node:node /app /app
USER node
CMD ["pnpm", "--filter", "@agentscope/workers", "start"]
