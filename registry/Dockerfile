FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
ENV NODE_ENV=production
ENV REGISTRY_DATA_DIR=/data
ENV PORT=3111
EXPOSE 3111
CMD ["node", "server.js"]
