# Use Node.js 20 Bullseye (Debian)
FROM node:20-bullseye

# Create app directory
WORKDIR /app

# Install build tools and python
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    libxi-dev \
    libglu1-mesa-dev \
    libglew-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Fix python executable for node-gyp
RUN ln -s /usr/bin/python3 /usr/bin/python

# Configure npm to use python3
# npm config set python is not needed with symlink and fails in newer npm versions

# Copy package files (ensure no lockfile issues)
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Start Smart Proxy
CMD [ "node", "blockchain-server.js" ]
