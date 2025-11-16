#!/bin/bash

echo "========================================="
echo "  WhatsApp Baileys API - Deployment"
echo "========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Stop services
echo -e "${YELLOW}[1/6]${NC} Stopping services..."
docker-compose down
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Services stopped"
else
    echo -e "${RED}✗${NC} Failed to stop services"
    exit 1
fi
echo ""

# Step 2: Build TypeScript
echo -e "${YELLOW}[2/6]${NC} Building TypeScript..."
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} TypeScript compiled successfully"
else
    echo -e "${RED}✗${NC} TypeScript compilation failed"
    exit 1
fi
echo ""

# Step 3: Build Docker image
echo -e "${YELLOW}[3/6]${NC} Building Docker image..."
docker-compose build baileys
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Docker image built"
else
    echo -e "${RED}✗${NC} Docker build failed"
    exit 1
fi
echo ""

# Step 4: Start services
echo -e "${YELLOW}[4/6]${NC} Starting services..."
docker-compose up -d
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Services started"
else
    echo -e "${RED}✗${NC} Failed to start services"
    exit 1
fi
echo ""

# Step 5: Wait for health check
echo -e "${YELLOW}[5/6]${NC} Waiting for services to be healthy..."
sleep 5

# Check if baileys container is running
if docker ps | grep -q baileys-api; then
    echo -e "${GREEN}✓${NC} Baileys API is running"
else
    echo -e "${RED}✗${NC} Baileys API failed to start"
    echo ""
    echo "Showing last 20 lines of logs:"
    docker-compose logs --tail=20 baileys
    exit 1
fi

# Check if database is running
if docker ps | grep -q baileys-postgres; then
    echo -e "${GREEN}✓${NC} PostgreSQL is running"
else
    echo -e "${RED}✗${NC} PostgreSQL failed to start"
fi

# Check if FFmpeg is running
if docker ps | grep -q baileys-ffmpeg; then
    echo -e "${GREEN}✓${NC} FFmpeg service is running"
else
    echo -e "${RED}✗${NC} FFmpeg service failed to start"
fi
echo ""

# Step 6: Verify API is responding
echo -e "${YELLOW}[6/6]${NC} Verifying API..."
sleep 3

# Try to hit the API
if curl -s http://localhost:3000/metrics/system > /dev/null; then
    echo -e "${GREEN}✓${NC} API is responding"
else
    echo -e "${RED}✗${NC} API is not responding"
    echo ""
    echo "Showing last 30 lines of logs:"
    docker-compose logs --tail=30 baileys
    exit 1
fi

echo ""
echo "========================================="
echo -e "${GREEN}✓ Deployment Successful!${NC}"
echo "========================================="
echo ""
echo "Services:"
echo "  • API Server:    http://localhost:3000"
echo "  • API Docs:      http://localhost:3000/api-docs"
echo "  • Dashboard:     http://localhost:3000/dashboard.html"
echo "  • PostgreSQL:    localhost:5432"
echo "  • FFmpeg:        localhost:3002"
echo ""
echo "New Features:"
echo "  • Webhook:       https://wa.bot4wa.com/webhook/session-stoped"
echo "  • System Metrics: GET /metrics/system"
echo "  • Performance:   GET /metrics/performance"
echo ""
echo "Monitoring:"
echo "  docker-compose logs -f baileys"
echo "  docker stats baileys-api"
echo "  curl http://localhost:3000/metrics/system | jq"
echo ""
