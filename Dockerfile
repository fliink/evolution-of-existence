# Image for the studio (studio/). Built from the repo root so lib/ is available.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY lib ./lib
COPY site.config.js ./
COPY studio ./studio
EXPOSE 8080
USER node
CMD ["node", "studio/server.js"]
