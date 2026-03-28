# ── Build stage ─────────────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

# Install production deps only first (layer-cache friendly)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=base --chown=appuser:appgroup /app /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "server.js"]
