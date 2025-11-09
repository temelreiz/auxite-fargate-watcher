# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# 1) Install deps (devDeps dahil)
COPY package*.json ./
RUN npm ci

# 2) Copy sources
COPY tsconfig.json ./
COPY src ./src

# 3) TypeScript build
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Sadece prod deps
COPY package*.json ./
RUN npm ci --omit=dev

# Derlenmiş kod
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
