FROM node:20-alpine

# Install FFmpeg and wget
RUN apk add --no-cache ffmpeg wget

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY index.js ./

# Create directories
RUN mkdir -p /temp/uploads /media/converted /media/thumbnails

# Expose port
EXPOSE 3001

# Start service
CMD ["npm", "start"]
