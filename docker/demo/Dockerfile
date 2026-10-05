# syntax=docker/dockerfile:1
# DEMO ONLY: app + its own throwaway Postgres in one container, filled with fake
# demo data on every start. Data resets whenever the container restarts.
# Never use this for real business data — use the main Dockerfile + docker-compose.
FROM node:22-alpine
RUN apk add --no-cache postgresql16 postgresql16-contrib su-exec
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN ENCRYPTION_KEY=build-only-placeholder-key-0123456789abcdef npm run build
ENV NODE_ENV=production PORT=10000 HOSTNAME=0.0.0.0
EXPOSE 10000
CMD ["sh", "docker/demo/start.sh"]
