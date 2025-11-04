# FFmpeg Service API

A microservice for converting media files to WhatsApp-compatible formats using FFmpeg.

## Endpoints

### Health Check
```bash
GET /health
```

Returns the service status.

**Response:**
```json
{
  "status": "ok",
  "service": "ffmpeg-service",
  "timestamp": "2025-10-24T03:15:07.663Z"
}
```

---

### Get Media Info
```bash
POST /info
Content-Type: multipart/form-data
```

Extract metadata from a media file.

**Parameters:**
- `file`: Media file (video, audio, or image)

**Response:**
```json
{
  "success": true,
  "metadata": {
    "format": {...},
    "streams": [...]
  }
}
```

---

### Convert Video
```bash
POST /convert/video
Content-Type: multipart/form-data
```

Convert video to WhatsApp-compatible MP4 format.

**Parameters:**
- `file`: Video file to convert

**Output Format:**
- Codec: H.264 (video) + AAC (audio)
- Container: MP4
- Max Resolution: 1280x720
- Quality: Medium (CRF 28)
- Audio: 128kbps AAC stereo

**Response:**
```json
{
  "success": true,
  "filename": "1698765432-video.mp4",
  "path": "/media/converted/1698765432-video.mp4",
  "size": 5242880,
  "message": "Video converted to WhatsApp-compatible format"
}
```

---

### Convert Audio
```bash
POST /convert/audio
Content-Type: multipart/form-data
```

Convert audio to WhatsApp-compatible format.

**Parameters:**
- `file`: Audio file to convert
- `format` (optional): Output format - `opus` (default) or `mp3`

**Output Format:**
- Opus: 128kbps in OGG container
- MP3: 128kbps

**Response:**
```json
{
  "success": true,
  "filename": "1698765432-audio.opus",
  "path": "/media/converted/1698765432-audio.opus",
  "size": 1048576,
  "message": "Audio converted to WhatsApp-compatible format"
}
```

---

### Convert Image
```bash
POST /convert/image
Content-Type: multipart/form-data
```

Convert image to WhatsApp-compatible format.

**Parameters:**
- `file`: Image file to convert
- `format` (optional): Output format - `jpeg` (default) or `png`

**Output Format:**
- Max Resolution: 4096x4096
- JPEG Quality: High (q:v 2)

**Response:**
```json
{
  "success": true,
  "filename": "1698765432-image.jpeg",
  "path": "/media/converted/1698765432-image.jpeg",
  "size": 2097152,
  "message": "Image converted to WhatsApp-compatible format"
}
```

---

### Generate Thumbnail
```bash
POST /thumbnail
Content-Type: multipart/form-data
```

Generate a thumbnail from a video.

**Parameters:**
- `file`: Video file
- `time` (optional): Time position (format: HH:MM:SS), default: `00:00:01`

**Output:**
- Size: 320x240
- Format: JPEG

**Response:**
```json
{
  "success": true,
  "filename": "1698765432-video.jpg",
  "path": "/media/thumbnails/1698765432-video.jpg",
  "size": 32768,
  "message": "Thumbnail generated successfully"
}
```

---

## Example Usage

### Using cURL

```bash
# Convert video
curl -X POST http://localhost:3001/convert/video \
  -F "file=@/path/to/video.mp4"

# Convert audio to opus
curl -X POST http://localhost:3001/convert/audio \
  -F "file=@/path/to/audio.wav" \
  -F "format=opus"

# Convert image
curl -X POST http://localhost:3001/convert/image \
  -F "file=@/path/to/image.png" \
  -F "format=jpeg"

# Generate thumbnail
curl -X POST http://localhost:3001/thumbnail \
  -F "file=@/path/to/video.mp4" \
  -F "time=00:00:05"

# Get media info
curl -X POST http://localhost:3001/info \
  -F "file=@/path/to/video.mp4"
```

### Using Node.js

```javascript
const FormData = require('form-data')
const fs = require('fs')
const axios = require('axios')

async function convertVideo(filePath) {
  const form = new FormData()
  form.append('file', fs.createReadStream(filePath))

  const response = await axios.post('http://localhost:3001/convert/video', form, {
    headers: form.getHeaders()
  })

  console.log(response.data)
}
```

---

## WhatsApp Media Specifications

### Video
- Format: MP4 (H.264 + AAC)
- Max Size: 16MB recommended
- Max Duration: 90 seconds for status
- Recommended Resolution: 1280x720 or lower

### Audio
- Format: Opus (OGG) or MP3
- Max Size: 16MB
- Bitrate: 128kbps recommended

### Image
- Format: JPEG or PNG
- Max Size: 5MB recommended
- Max Resolution: 4096x4096

---

## Docker Configuration

The service runs on port **3001** and is accessible at:
```
http://localhost:3001
```

Volumes:
- `/media` - Output directory for converted files
- `/temp` - Temporary directory for uploads

Environment Variables:
- `PORT` - Service port (default: 3001)
- `NODE_ENV` - Environment (production/development)
