FROM node:20-alpine

# Install common dev tools
RUN apk add --no-cache \
    git \
    bash \
    curl \
    jq \
    python3 \
    make \
    g++

WORKDIR /app

# Copy package definition and install runtime dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy built server
COPY dist/ ./dist/

# Create workspace and socket directories
RUN mkdir -p /workspace /var/run/sidecar

# Default socket and workspace paths
ENV SOCKET_PATH=/var/run/sidecar/sidecar.sock
ENV WORKSPACE_ROOT=/workspace

CMD ["node", "dist/server.js"]
