FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
