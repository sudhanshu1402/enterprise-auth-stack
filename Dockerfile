# Build Stage
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production Stage
FROM node:22-alpine

WORKDIR /usr/src/app

# Copy package info and install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built artifacts from the builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Optional: Run as non-root user for security
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
