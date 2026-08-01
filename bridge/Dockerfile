FROM node:22-alpine

WORKDIR /app

COPY server.mjs ./server.mjs
COPY public ./public

ENV NODE_ENV=production

USER node

EXPOSE 8080

CMD ["node", "server.mjs"]
