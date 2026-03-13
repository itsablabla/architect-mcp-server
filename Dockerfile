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

RUN mkdir -p custom_tools data marketplace && chown -R node:node /app

EXPOSE 3001 3002

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/tools',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

USER node

CMD ["node", "dist/index.js"]
