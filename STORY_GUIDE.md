# 📸 WhatsApp Stories Deep Dive

## What Are WhatsApp Stories?

WhatsApp Stories (also called "Status") are temporary posts that disappear after 24 hours. They work exactly like Instagram/Facebook Stories.

---

## Who Can See Your Stories?

### 1. **All Contacts (Default)**
When you send a story with an **empty `statusJidList`**, it goes to ALL your contacts who have your number saved.

```json
{
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Hello everyone!",
  "statusJidList": []
}
```

**Who sees it:** Everyone in your contact list

---

### 2. **Specific People Only (Privacy Lists)**
Send to only selected contacts by providing their JIDs in `statusJidList`:

```json
{
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Private message for friends",
  "statusJidList": [
    "1234567890@s.whatsapp.net",
    "9876543210@s.whatsapp.net",
    "5555555555@s.whatsapp.net"
  ]
}
```

**Who sees it:** Only the 3 people you listed

---

### 3. **Finding Contact JIDs**

To get someone's JID (WhatsApp ID), you'll receive it in WebSocket events when they message you:

```javascript
// WebSocket message event
{
  "sessionId": "my-whatsapp",
  "event": "messages.upsert",
  "data": {
    "messages": [{
      "key": {
        "remoteJid": "1234567890@s.whatsapp.net",  // ← This is the JID
        "fromMe": false
      },
      "message": { ... }
    }]
  }
}
```

**JID Format:**
- Individual: `1234567890@s.whatsapp.net` (phone number + @s.whatsapp.net)
- Group: `123456789-1234567890@g.us`

---

## Story Types

### 1. **Text Stories**

Simple text posts with customizable backgrounds and fonts.

```json
{
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Hello World! 🌟",
  "backgroundColor": "#FF5733",
  "font": 7,
  "statusJidList": []
}
```

**Parameters:**
- `content` - Your text message (emojis supported ✨)
- `backgroundColor` - Hex color code (#FF5733) or color name (red, blue, etc.)
- `font` - Font style (see Font Types below)

**Available Fonts:**
- `0` - SYSTEM (default)
- `1` - SYSTEM_TEXT
- `2` - FB_SCRIPT (fancy script)
- `6` - SYSTEM_BOLD
- `7` - MORNINGBREEZE_REGULAR (rounded)
- `8` - CALISTOGA_REGULAR (chunky)
- `9` - EXO2_EXTRABOLD (modern bold)
- `10` - COURIERPRIME_BOLD (typewriter)

**Popular Background Colors:**
```
#FF5733 - Orange Red
#C70039 - Deep Pink
#900C3F - Wine Red
#581845 - Deep Purple
#1F618D - Ocean Blue
#117864 - Teal
#D4AC0D - Gold
#145A32 - Forest Green
#000000 - Black (default)
#FFFFFF - White
```

---

### 2. **Image Stories**

Post photos with optional captions.

```json
{
  "sessionId": "my-whatsapp",
  "type": "image",
  "content": "https://example.com/photo.jpg",
  "caption": "Sunset at the beach 🌅",
  "statusJidList": []
}
```

**Image Sources:**
- **URL**: `https://example.com/image.jpg`
- **Local path**: `/app/Media/myimage.jpg` (inside Docker container)
- **Base64**: `data:image/jpeg;base64,/9j/4AAQ...`

**Supported formats:** JPG, PNG, WebP

---

### 3. **Video Stories**

Post short videos (WhatsApp has a 90-second limit).

```json
{
  "sessionId": "my-whatsapp",
  "type": "video",
  "content": "/app/Media/myvideo.mp4",
  "caption": "Check out this clip! 🎬",
  "statusJidList": []
}
```

**Video Sources:**
- **URL**: `https://example.com/video.mp4`
- **Local path**: `/app/Media/myvideo.mp4` (mount your videos via Docker)

**Supported formats:** MP4, MKV, AVI (auto-converted)

**Tips:**
- Keep videos under 90 seconds
- Max file size: ~16MB (WhatsApp compresses larger files)

---

## Privacy & Targeting Examples

### Example 1: Public Story (Everyone)
```bash
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-whatsapp",
    "type": "text",
    "content": "Happy Friday everyone! 🎉",
    "backgroundColor": "#FFD700",
    "font": 7,
    "statusJidList": []
  }'
```
✅ **Visible to:** All your contacts

---

### Example 2: Private Story (Close Friends Only)
```bash
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-whatsapp",
    "type": "image",
    "content": "https://example.com/private-photo.jpg",
    "caption": "Just for you guys 😊",
    "statusJidList": [
      "1234567890@s.whatsapp.net",
      "9876543210@s.whatsapp.net"
    ]
  }'
```
✅ **Visible to:** Only those 2 people
❌ **Hidden from:** Everyone else

---

### Example 3: Business Announcement
```bash
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "business-account",
    "type": "video",
    "content": "/app/Media/product-demo.mp4",
    "caption": "New Product Launch! 🚀 Limited time offer",
    "statusJidList": []
  }'
```
✅ **Visible to:** All customers/followers

---

## How Stories Work Behind the Scenes

### 1. **Broadcasting Mechanism**
```
You → WhatsApp Server → status@broadcast → Contact Devices
```

When you send a story:
1. API sends to `status@broadcast` (special WhatsApp address)
2. WhatsApp distributes to recipients based on `statusJidList`
3. Story appears in recipients' Status tab for 24 hours
4. Recipients can view, but **cannot reply** (unless you enable DMs)

---

### 2. **Story Metadata**
Every story includes:
- **Timestamp** - When posted
- **Expiry** - 24 hours from posting
- **View count** - How many people viewed it
- **Who viewed** - List of viewers (you can see this in WhatsApp)

---

### 3. **Privacy Rules**
- **Blocked contacts** never see your story
- **Contacts who don't have your number** won't see it
- **You must have their number** in your contacts for them to see it

---

## Advanced Use Cases

### Use Case 1: Daily Automated Posts
```javascript
// Post a motivational quote every morning at 9 AM
const quotes = [
  "Start your day with a smile! 😊",
  "Make today amazing! ✨",
  "You've got this! 💪"
];

setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 9 && now.getMinutes() === 0) {
    await fetch('https://eee.bot4wa.com/story/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'my-whatsapp',
        type: 'text',
        content: quotes[now.getDay()],
        backgroundColor: '#FF6B6B',
        font: 7,
        statusJidList: []
      })
    });
  }
}, 60000); // Check every minute
```

---

### Use Case 2: VIP Customer Stories
```javascript
// Send exclusive content to premium customers
const vipCustomers = [
  "customer1@s.whatsapp.net",
  "customer2@s.whatsapp.net",
  "customer3@s.whatsapp.net"
];

await fetch('https://eee.bot4wa.com/story/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'business',
    type: 'image',
    content: 'https://mystore.com/exclusive-deal.jpg',
    caption: '🎁 VIP EXCLUSIVE: 50% OFF - Code: VIP50',
    statusJidList: vipCustomers
  })
});
```

---

### Use Case 3: Event Countdown
```javascript
// Post daily countdown to an event
const eventDate = new Date('2025-12-31');
const today = new Date();
const daysLeft = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));

await fetch('https://eee.bot4wa.com/story/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'my-whatsapp',
    type: 'text',
    content: `🎉 ${daysLeft} DAYS UNTIL NEW YEAR! 🎊`,
    backgroundColor: '#9B59B6',
    font: 9,
    statusJidList: []
  })
});
```

---

## Monitoring Story Performance

When you send a story, you'll receive a WebSocket event:

```json
{
  "sessionId": "my-whatsapp",
  "event": "story.sent",
  "data": {
    "result": {
      "key": {
        "id": "3EB0123456789ABCDEF",
        "remoteJid": "status@broadcast"
      },
      "status": "PENDING"
    }
  },
  "timestamp": "2025-10-23T15:30:00.000Z"
}
```

---

## Best Practices

### ✅ DO:
- Post consistently (1-3 times per day)
- Use eye-catching backgrounds for text stories
- Keep text stories short (2-3 lines max)
- Add emojis for visual appeal 🎨
- Test with `statusJidList` before posting to everyone
- Use high-quality images/videos
- Add captions to media stories

### ❌ DON'T:
- Spam (WhatsApp may ban you)
- Post copyrighted content without permission
- Share sensitive information (stories aren't private DMs)
- Post more than 10 stories in a row (annoying for viewers)
- Use low-quality/blurry media

---

## Troubleshooting

### "Story not appearing for contacts"
**Possible reasons:**
1. Contact doesn't have your number saved
2. You're blocked by that contact
3. Contact's status privacy settings exclude you
4. Invalid JID in `statusJidList`

**Solution:** Use empty `statusJidList: []` to test

---

### "Session not connected"
**Error:** `{ "error": "Session not connected" }`

**Solution:**
```bash
# 1. Check session status
curl https://eee.bot4wa.com/session/my-whatsapp/status

# 2. If disconnected, create new session
curl -X POST https://eee.bot4wa.com/session/create \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"my-whatsapp"}'

# 3. Scan QR code
curl https://eee.bot4wa.com/session/my-whatsapp/qr
```

---

### "Media upload failed"
**Causes:**
- File too large (>16MB)
- Invalid URL
- File format not supported
- Network timeout

**Solution:**
```bash
# Place media in Docker volume
cp myvideo.mp4 ./Media/

# Use local path instead of URL
{
  "content": "/app/Media/myvideo.mp4"
}
```

---

## Quick Reference

| Feature | Parameter | Type | Example |
|---------|-----------|------|---------|
| Text content | `content` | string | `"Hello World!"` |
| Image URL | `content` | string | `"https://example.com/img.jpg"` |
| Video path | `content` | string | `"/app/Media/video.mp4"` |
| Caption | `caption` | string | `"Check this out!"` |
| Background | `backgroundColor` | string | `"#FF5733"` or `"red"` |
| Font | `font` | number | `0-10` (see Font Types) |
| Recipients | `statusJidList` | array | `["1234@s.whatsapp.net"]` |
| All contacts | `statusJidList` | array | `[]` (empty array) |

---

**🚀 You're now a WhatsApp Story expert!**
