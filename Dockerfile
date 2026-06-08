# syntax=docker/dockerfile:1

# ---- Build stage: compile TypeScript -------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage --------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Production deps only; Playwright is optional and skipped here to keep the
# default image small and fast. See the `engine-browser` stage to include it.
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0

CMD ["node", "dist/engine/server.js"]

# ---- Optional variant with Playwright/Chromium for browser rendering ------
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS engine-browser
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npx playwright install --with-deps chromium \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
CMD ["node", "dist/engine/server.js"]
