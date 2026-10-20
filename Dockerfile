FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libsecret-1-dev \
    libsecret-1-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g supergateway @azure-devops/mcp @ansible/ansible-mcp-server

WORKDIR /app
COPY gateway.js /app/gateway.js

EXPOSE 8000 8001

ENTRYPOINT ["supergateway"]

