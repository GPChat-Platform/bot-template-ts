# docker build -t mon-bot .  &&  docker run --env-file .env -v mon-bot-data:/data mon-bot
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY test ./test
RUN npx tsc && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 OPS_HOST=0.0.0.0
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.OPS_PORT||9100)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/index.js"]
