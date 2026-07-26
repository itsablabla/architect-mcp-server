FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

COPY --from=builder /app/dist ./dist
COPY dashboard/ ./dashboard/

RUN mkdir -p custom_tools data marketplace && chown -R node:node /app

EXPOSE 3001 3002

ENV NODE_ENV=production
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

USER node

CMD ["node", "dist/index.js"]
