# Stage 1: Build backend
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server/ ./server/
COPY agents/ ./agents/
COPY brain/ ./brain/
COPY brains/ ./brains/
COPY emotion/ ./emotion/
COPY llm/ ./llm/
COPY memory/ ./memory/
COPY voice/ ./voice/
COPY utils/ ./utils/
COPY avatar/ ./avatar/
COPY storage/ ./storage/
COPY infra/ ./infra/
COPY persona/ ./persona/
RUN npx tsc

# Stage 2: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY avatar/ ../avatar/
RUN npm run build

# Stage 3: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/web/.next ./web/.next
COPY --from=frontend-build /app/web/node_modules ./web/node_modules
COPY --from=frontend-build /app/web/package.json ./web/package.json
COPY --from=frontend-build /app/web/next.config.ts ./web/next.config.ts
COPY --from=frontend-build /app/web/public ./web/public
COPY avatar/assets ./avatar/assets
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server/server.js"]
