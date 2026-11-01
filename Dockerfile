# GM-3D Chess — one image runs both processes:
#   web:   bun server.js   (Next.js standalone app, port 3000)
#   chess: bun index.ts    (Socket.IO service, port 3003)
# compose.yml wires them behind an nginx proxy that routes the
# ?XTransformPort=3003 marker requests to the service (nginx/chess.conf).

# ---- web dependencies -------------------------------------------------------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- chess-service dependencies (small, isolated) ----------------------------
FROM oven/bun:1 AS service-deps
WORKDIR /service
COPY mini-services/chess-server/package.json mini-services/chess-server/bun.lock ./
RUN bun install --frozen-lockfile

# ---- build the Next.js app ----------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `build` runs `next build` and copies .next/static + public into
# .next/standalone, so the runtime image is fully self-contained.
RUN bun run build

# ---- runtime -------------------------------------------------------------------
FROM oven/bun:1-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next.js standalone server (server.js + .next + public)
WORKDIR /app
COPY --from=build --chown=bun:bun /app/.next/standalone ./

# Socket.IO chess service with its own node_modules
COPY --chown=bun:bun mini-services/chess-server/index.ts /service/index.ts
COPY --from=service-deps --chown=bun:bun /service/package.json /service/package.json
COPY --from=service-deps --chown=bun:bun /service/node_modules /service/node_modules

USER bun
EXPOSE 3000 3003

# Default command = web app; the chess container overrides with
# `bun index.ts` and workdir /service (see compose.yml).
CMD ["bun", "server.js"]
