FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY resolver-core.js server.js ./

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.js"]
