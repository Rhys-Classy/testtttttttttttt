# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Web app: Next.js standalone server.
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S bos && adduser -S bos -G bos && mkdir -p /app/storage && chown bos:bos /app/storage
COPY --from=build --chown=bos:bos /app/.next/standalone ./
COPY --from=build --chown=bos:bos /app/.next/static ./.next/static
USER bos
EXPOSE 3000
CMD ["node", "server.js"]

# Worker, migrations and seed: full source + tsx.
FROM node:22-alpine AS tools
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "src/worker/index.ts"]
