FROM node:20-alpine AS builder
WORKDIR /app

# 1) Dev dahil tüm dependency'ler
COPY package*.json ./
RUN npm ci

# 2) Kaynaklar
COPY tsconfig.json ./
COPY src ./src

# 3) TypeScript build
RUN npm run build

# ---- Runtime ----
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
