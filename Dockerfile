FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libsecret-1-dev \
    libsecret-1-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g supergateway @azure-devops/mcp

EXPOSE 8000

ENTRYPOINT ["supergateway"]
