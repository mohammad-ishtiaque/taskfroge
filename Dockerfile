FROM node:22-alpine AS build
WORKDIR /app 
COPY api/package*.json ./
COPY api/tsconfig*.json ./
RUN npm ci
COPY /api/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev
RUN npm install pino-pretty
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
EXPOSE 4000
ENTRYPOINT [ "npm","run","start" ]