# Serveur FPIXEL pour un Space Hugging Face (SDK Docker, port 7860)
FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY web ./web

ENV NODE_ENV=production PORT=7860
EXPOSE 7860
USER node
CMD ["node", "server/index.js"]
