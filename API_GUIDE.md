# Baileys WhatsApp API Server Guide

## 🚀 Running the Server

```bash
docker-compose up -d
```

The API runs on `http://localhost:3000`
WebSocket available at `ws://localhost:3000`

---

## 📡 WebSocket Events

Connect to the WebSocket to receive real-time events from WhatsApp:

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Event:', data.event);
    console.log('Session:', data.sessionId);
    console.log('Data:', data.data);
};
```

### Events you'll receive:
- `qr` - QR code generated for scanning
- `connected` - Session successfully connected
- `disconnected` - Session disconnected
- `messages.upsert` - New messages received
- `messages.update` - Message updates (delivered, read, etc.)
- `story.sent` - Story successfully sent

---

## 🔑 REST API Endpoints

### 1. Health Check
```bash
GET /health
```
**Response:**
```json
{
  "status": "ok",
  "sessions": 1,
  "timestamp": "2025-10-23T14:12:46.083Z"
}
```

---

### 2. Create/Resume Session
```bash
POST /session/create
Content-Type: application/json

{
  "sessionId": "my-whatsapp"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "my-whatsapp",
  "status": "connecting",
  "qr": "2@yiORFBiv9b5wPgnLTdzAR+V96cD..."
}
```

---

### 3. Get Session Status
```bash
GET /session/:sessionId/status
```

**Example:**
```bash
curl http://localhost:3000/session/my-whatsapp/status
```

**Response:**
```json
{
  "sessionId": "my-whatsapp",
  "status": "connected",
  "user": {
    "id": "1234567890:1@s.whatsapp.net",
    "name": "My WhatsApp"
  },
  "lastUpdated": "2025-10-23T14:15:00.000Z"
}
```

---

### 4. Get QR Code
```bash
GET /session/:sessionId/qr
```

**Example:**
```bash
curl http://localhost:3000/session/my-whatsapp/qr
```

**Response:**
```json
{
  "sessionId": "my-whatsapp",
  "qr": "2@yiORFBiv9b5wPgnLTdzAR+V96cD..."
}
```

Convert to scannable QR: https://www.qr-code-generator.com/

---

### 5. List All Sessions
```bash
GET /sessions
```

**Response:**
```json
{
  "sessions": [
    {
      "sessionId": "my-whatsapp",
      "status": "connected",
      "hasQr": false,
      "user": {
        "id": "1234567890:1@s.whatsapp.net"
      },
      "lastUpdated": "2025-10-23T14:15:00.000Z"
    }
  ]
}
```

---

### 6. Delete Session
```bash
DELETE /session/:sessionId
```

**Example:**
```bash
curl -X DELETE http://localhost:3000/session/my-whatsapp
```

---

## 📸 Send Story/Status

```bash
POST /story/send
Content-Type: application/json
```

### Text Story
```json
{
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Hello World! This is my status 🌟",
  "statusJidList": []
}
```

### Image Story
```json
{
  "sessionId": "my-whatsapp",
  "type": "image",
  "content": "https://example.com/image.jpg",
  "caption": "Check out this photo!",
  "statusJidList": []
}
```

### Video Story
```json
{
  "sessionId": "my-whatsapp",
  "type": "video",
  "content": "/app/Media/video.mp4",
  "caption": "My video status",
  "statusJidList": []
}
```

**Parameters:**
- `sessionId` - Your session ID
- `type` - `text`, `image`, or `video`
- `content` - Text content or URL/path to media
- `caption` - Caption for media (optional)
- `statusJidList` - Array of JIDs to send to (empty = all contacts)

**Response:**
```json
{
  "success": true,
  "messageId": "3EB0123456789ABCDEF",
  "message": "Story sent successfully"
}
```

---

## 💬 Send Regular Message

```bash
POST /message/send
Content-Type: application/json
```

### Send Text
```json
{
  "sessionId": "my-whatsapp",
  "to": "1234567890@s.whatsapp.net",
  "type": "text",
  "content": "Hello!"
}
```

### Send Image
```json
{
  "sessionId": "my-whatsapp",
  "to": "1234567890@s.whatsapp.net",
  "type": "image",
  "content": "https://example.com/image.jpg",
  "caption": "Check this out"
}
```

---

## 🔧 Usage Examples

### Create Session & Monitor Events
```bash
# Terminal 1: Monitor WebSocket events
wscat -c ws://localhost:3000

# Terminal 2: Create session
curl -X POST http://localhost:3000/session/create \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"my-session"}'

# Terminal 2: Get QR code
curl http://localhost:3000/session/my-session/qr
```

### Send a Story
```bash
curl -X POST http://localhost:3000/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "type": "text",
    "content": "Hello from Baileys API! 🎉"
  }'
```

### Check All Sessions
```bash
curl http://localhost:3000/sessions | jq
```

---

## 📁 File Structure

```
/opt/baileys/
├── sessions/           # Session data (persisted)
│   └── my-whatsapp/    # Each session has its own folder
├── Media/              # Media files
├── src/api-server.ts   # API server code
└── docker-compose.yml
```

---

## 🐛 Troubleshooting

### View Logs
```bash
docker logs baileys-api -f
```

### Restart Container
```bash
docker-compose restart
```

### Clear Session Data
```bash
rm -rf sessions/my-whatsapp/
```

---

## 🔒 Security Notes

- This API has no authentication - add your own auth layer for production
- Use HTTPS in production
- Store session data securely
- Never expose this API directly to the internet without security

---

## 📚 WhatsApp JID Format

- **Individual:** `1234567890@s.whatsapp.net`
- **Group:** `123456789-1234567890@g.us`
- **Status/Story:** `status@broadcast`

---

## ⚡ Quick Start

1. **Start the server:**
   ```bash
   docker-compose up -d
   ```

2. **Create a session:**
   ```bash
   curl -X POST http://localhost:3000/session/create \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"whatsapp1"}'
   ```

3. **Get QR code:**
   ```bash
   curl http://localhost:3000/session/whatsapp1/qr
   ```

4. **Scan QR code with WhatsApp**

5. **Send a story:**
   ```bash
   curl -X POST http://localhost:3000/story/send \
     -H "Content-Type: application/json" \
     -d '{
       "sessionId": "whatsapp1",
       "type": "text",
       "content": "My first story via API!"
     }'
   ```

6. **Monitor events via WebSocket** to receive incoming messages!

---

**Enjoy your WhatsApp API! 🎉**
