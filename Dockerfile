FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY dashboard/ ./dashboard/
COPY assets/ ./assets/

RUN mkdir -p custom_tools data marketplace && chown -R node:node /app

EXPOSE 3001 3002 3003

ENV NODE_ENV=production
ENV ARCHITECT_MCP_HTTP=1
ENV ARCHITECT_MCP_HTTP_PORT=3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

USER node

CMD ["node", "dist/index.js"]
