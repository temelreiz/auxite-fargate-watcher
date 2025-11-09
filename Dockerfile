# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# 1) Dependencies
COPY package*.json ./
RUN npm ci

# 2) TS config + source
COPY tsconfig.json ./
COPY src ./src

# 3) TypeScript build
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Sadece runtime bağımlılıkları
COPY package*.json ./
RUN npm ci --omit=dev

# Build edilmiş kodu al
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
