FROM node:22-alpine

WORKDIR /app

COPY bridge/server.mjs ./server.mjs
COPY bridge/realtime.mjs ./realtime.mjs
COPY bridge/downloads.mjs ./downloads.mjs
COPY bridge/public ./public
COPY config/release.json ./release.json

ENV NODE_ENV=production

USER node

EXPOSE 8080

CMD ["node", "server.mjs"]
