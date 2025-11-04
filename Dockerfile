# Multi-stage build for Baileys WhatsApp library
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git openssh-client

# Enable Corepack for Yarn 4.x
RUN corepack enable

WORKDIR /app

# Copy all source code first
COPY . .

# Configure git to use HTTPS instead of SSH for GitHub
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install dependencies and build
RUN yarn install && yarn build

# Production stage - use the same image with everything built
FROM builder AS production

# Install runtime dependencies (ffmpeg for media processing)
RUN apk add --no-cache ffmpeg

# Create directories for sessions and media
RUN mkdir -p /app/sessions /app/Media

VOLUME ["/app/sessions", "/app/Media"]

# Expose API port
EXPOSE 3000

# Run the API server
CMD ["yarn", "api"]
