FROM node:22.21-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/nextjs/package.json apps/nextjs/package.json
COPY apps/workers/package.json apps/workers/package.json
COPY packages packages
COPY tooling tooling
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @agentscope/nextjs... build

FROM base AS runner
ENV NODE_ENV=production
# Run as the unprivileged `node` user that the `node:22.21-bookworm-slim`
# image ships with (UID 1000). The default user is root, which would let
# a compromised Next.js process read or modify any file on the
# container's filesystem. `--chown=node:node` ensures the copied app
# tree is readable by the unprivileged user; `EXPOSE 3000` and `CMD`
# then run with that user's identity.
COPY --from=build --chown=node:node /app /app
EXPOSE 3000
USER node
CMD ["pnpm", "--filter", "@agentscope/nextjs", "start"]
