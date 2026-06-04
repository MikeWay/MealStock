# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Stage 2: runtime
FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY client.html login.html pending.html forgot-password.html reset-password.html ./
EXPOSE 3000
CMD ["sh", "-c", "until node dist/setup-db.js; do echo 'DB not ready, retrying in 3s...'; sleep 3; done && node dist/server.js"]
