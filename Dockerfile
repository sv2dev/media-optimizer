FROM oven/bun:1.3.14-slim AS base
WORKDIR /app

FROM base AS build
COPY . .
RUN bun install --frozen-lockfile && \
    cd packages/server && \
    bun run build && \
    bun run build:docker

FROM base AS install
ENV NODE_ENV=production
COPY ./package.json bun.lock /app/
RUN bun install --no-save sharp

FROM base AS prod
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=/usr/local/bin/ffmpeg
COPY --from=mwader/static-ffmpeg:8.1.2 /ffmpeg /usr/local/bin/
COPY --from=build /app/packages/server/dist/server/app.js /app/app.js
COPY --from=install /app/node_modules/ /app/node_modules/
EXPOSE 3000
CMD ["bun", "app.js"]
