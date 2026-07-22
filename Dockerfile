# Multi-stage build for minimal image size
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript (also copies src/fingerprints/ -> dist/fingerprints/, see
# scripts/copy-fingerprints.mjs — tsc alone doesn't copy non-.ts assets)
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Run as non-root user (Cloud Run best practice)
USER node

# Cloud Run requires PORT 8080
ENV PORT=8080
EXPOSE 8080

# The bundled fingerprint dataset (~2.5MB JSON, ~7.5k technologies) is parsed
# once at startup and held in memory for the process lifetime — small and
# constant, nothing like our sanctions-screening server's ~70MB-per-refresh
# problem. Per-request memory is bounded too: each fetched page is capped at
# 512KB and read via a streamed reader (see src/lib/fetchPage.ts), never
# buffered whole. No NODE_OPTIONS heap tuning needed.

# Health check for Cloud Run
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
