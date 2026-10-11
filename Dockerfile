ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=5173 BACKEND_URL=http://agent-gateway:18000
COPY --from=build /app/dist ./dist
COPY server.mjs upload-stream.mjs package.json ./
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:5173/health || exit 1
CMD ["node", "server.mjs"]
