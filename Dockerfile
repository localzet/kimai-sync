# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x,linux-musl-arm64-openssl-3.0.x

# Copy dependency manifests
COPY package*.json ./
COPY prisma ./prisma

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build
RUN npm cache clean --force
RUN npm prune --omit=dev

# Production stage
FROM node:22-alpine

WORKDIR /app

ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma schema for runtime
COPY package*.json ./
COPY prisma ./prisma

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3000

CMD ["node", "dist/main"]
