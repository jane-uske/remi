# Stage 1: Build backend
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci --registry=https://registry.npmjs.org/ --replace-registry-host=always --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=300000
COPY tsconfig.json ./
COPY server/ ./server/
COPY agents/ ./agents/
COPY brain/ ./brain/
COPY brains/ ./brains/
COPY cold_layer/ ./cold_layer/
COPY capabilities/ ./capabilities/
COPY emotion/ ./emotion/
COPY llm/ ./llm/
COPY memory/ ./memory/
COPY voice/ ./voice/
COPY utils/ ./utils/
COPY avatar/ ./avatar/
COPY storage/ ./storage/
COPY infra/ ./infra/
COPY persona/ ./persona/
COPY plugin/ ./plugin/
RUN npx tsc

# Stage 2: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
ARG NEXT_PUBLIC_REMI_AUTH_MODE
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_VRM_URL
ARG NEXT_PUBLIC_VRM_YAW
ARG NEXT_PUBLIC_VRM_FRAMING
ARG NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT
ARG NEXT_PUBLIC_REM_DEVTOOLS
ENV NEXT_PUBLIC_REMI_AUTH_MODE=$NEXT_PUBLIC_REMI_AUTH_MODE
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_VRM_URL=$NEXT_PUBLIC_VRM_URL
ENV NEXT_PUBLIC_VRM_YAW=$NEXT_PUBLIC_VRM_YAW
ENV NEXT_PUBLIC_VRM_FRAMING=$NEXT_PUBLIC_VRM_FRAMING
ENV NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT=$NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT
ENV NEXT_PUBLIC_REM_DEVTOOLS=$NEXT_PUBLIC_REM_DEVTOOLS
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci --registry=https://registry.npmjs.org/ --replace-registry-host=always --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=300000
COPY web/ ./web/
COPY avatar/ ./avatar/
RUN npm run build --prefix web

# Stage 3: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --registry=https://registry.npmjs.org/ --replace-registry-host=always --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=300000
RUN apk add --no-cache ffmpeg
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/web/.next ./web/.next
COPY --from=frontend-build /app/web/package.json ./web/package.json
COPY --from=frontend-build /app/web/next.config.mjs ./web/next.config.mjs
COPY --from=frontend-build /app/web/public ./web/public
COPY storage/schema.sql ./storage/schema.sql
COPY avatar/assets ./avatar/assets
COPY capabilities/image_generation/workflows ./capabilities/image_generation/workflows
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server/server.js"]
