FROM node:20-alpine AS builder
WORKDIR /app

# 1) Tüm deps (dev dahil) kur
COPY package*.json ./
RUN npm ci

# 2) Kaynakları kopyala
COPY tsconfig.json ./
COPY src ./src

# 3) Build
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Sadece prod deps
COPY package*.json ./
RUN npm ci --omit=dev

# Build çıktısını kopyala
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
