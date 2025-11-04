# 🔄 Story Resend Feature - Complete Guide

## Overview

The Story Resend feature allows you to:
1. **Create a story once**, get a unique `storyId`
2. **Resend the same story** to different audiences (JID lists)
3. **Track all sends** and their privacy settings

This is perfect for:
- **Gradual rollouts** - Test with close friends, then go public
- **Segmented marketing** - Send to different customer groups
- **A/B testing** - Same content, different audiences
- **VIP exclusives** - Public post first, then exclusive version to VIPs

---

## 📋 How It Works

### The Flow:

```
1. POST /story/send
   ↓
   Returns: storyId + messageId
   ↓
2. POST /story/resend (with storyId + new JID list)
   ↓
   Creates NEW story post with same content
   ↓
   Returns: same storyId + new messageId
   ↓
3. Repeat step 2 for different audiences
```

**Important:** Each resend creates a **separate WhatsApp story post**. They're not "updating" the original - they're creating new posts with the same content but different privacy settings.

---

## 🚀 Quick Start Example

### Step 1: Send Initial Story

```bash
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-whatsapp",
    "type": "text",
    "content": "Big Announcement! 🎉",
    "backgroundColor": "#FF5733",
    "font": 9,
    "statusJidList": [
      "1234567890@s.whatsapp.net",
      "9876543210@s.whatsapp.net"
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "storyId": "story_1729695142000_abc123def",
  "messageId": "3EB0A1B2C3D4E5F6G7H8I9",
  "message": "Story sent successfully"
}
```

**Who sees it:** Only those 2 contacts (private preview)

---

### Step 2: Resend to Everyone

Now make it public using the `storyId`:

```bash
curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695142000_abc123def",
    "statusJidList": []
  }'
```

**Response:**
```json
{
  "success": true,
  "storyId": "story_1729695142000_abc123def",
  "messageId": "3EB0J1K2L3M4N5O6P7Q8R9",
  "totalSends": 2,
  "message": "Story resent successfully"
}
```

**Who sees it:** ALL your contacts (public post)

**Result:**
- **2 separate story posts** on WhatsApp
- Same content, different privacy
- Both tracked under the same `storyId`

---

### Step 3: Check Story Details

```bash
curl https://eee.bot4wa.com/story/story_1729695142000_abc123def
```

**Response:**
```json
{
  "storyId": "story_1729695142000_abc123def",
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Big Announcement! 🎉",
  "backgroundColor": "#FF5733",
  "font": 9,
  "totalSends": 2,
  "sends": [
    {
      "messageId": "3EB0A1B2C3D4E5F6G7H8I9",
      "statusJidList": [
        "1234567890@s.whatsapp.net",
        "9876543210@s.whatsapp.net"
      ],
      "timestamp": "2025-10-23T14:45:42.000Z"
    },
    {
      "messageId": "3EB0J1K2L3M4N5O6P7Q8R9",
      "statusJidList": [],
      "timestamp": "2025-10-23T14:47:15.000Z"
    }
  ],
  "createdAt": "2025-10-23T14:45:42.000Z"
}
```

---

## 📊 Use Cases

### Use Case 1: Gradual Rollout

**Scenario:** Test with close friends before going public

```bash
# 1. Send to close friends first (test audience)
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-whatsapp",
    "type": "image",
    "content": "https://example.com/new-product.jpg",
    "caption": "Launching something amazing! 🚀",
    "statusJidList": [
      "friend1@s.whatsapp.net",
      "friend2@s.whatsapp.net",
      "friend3@s.whatsapp.net"
    ]
  }'

# Get storyId: story_1729695200000_xyz789

# 2. Wait for feedback (30 minutes)
# 3. If feedback is good, go public!

curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695200000_xyz789",
    "statusJidList": []
  }'
```

**Timeline:**
- 2:00 PM - Private preview (3 friends)
- 2:30 PM - Public launch (all contacts)

---

### Use Case 2: VIP Exclusive Content

**Scenario:** Public announcement + VIP bonus content

```bash
# 1. Public announcement to everyone
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "business",
    "type": "text",
    "content": "🎁 NEW PRODUCT LAUNCH!\nLimited time offer - 20% OFF",
    "backgroundColor": "#D4AC0D",
    "font": 9,
    "statusJidList": []
  }'

# Get storyId: story_1729695300000_vip456

# 2. Resend to VIPs with better messaging
# (Note: You'd need to create a NEW story for different content)
# But if content is same with different audience:

curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695300000_vip456",
    "statusJidList": [
      "vip1@s.whatsapp.net",
      "vip2@s.whatsapp.net"
    ]
  }'
```

**Result:**
- Everyone sees: "20% OFF"
- VIPs see it **again** (reminder)

---

### Use Case 3: A/B Testing Audiences

**Scenario:** Same content, different customer segments

```bash
# 1. Send to Segment A (new customers)
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "business",
    "type": "video",
    "content": "/app/Media/product-demo.mp4",
    "caption": "Welcome to our service! 👋",
    "statusJidList": [
      "newcustomer1@s.whatsapp.net",
      "newcustomer2@s.whatsapp.net"
    ]
  }'

# Get storyId: story_1729695400000_seg123

# 2. Resend to Segment B (returning customers)
curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695400000_seg123",
    "statusJidList": [
      "returncustomer1@s.whatsapp.net",
      "returncustomer2@s.whatsapp.net"
    ]
  }'

# 3. Resend to Segment C (VIP customers)
curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695400000_seg123",
    "statusJidList": [
      "vip1@s.whatsapp.net",
      "vip2@s.whatsapp.net"
    ]
  }'
```

**Tracking:**
- 3 separate story posts
- All tracked under same `storyId`
- Monitor engagement per segment via WebSocket events

---

### Use Case 4: Time-Based Content Strategy

**Scenario:** Different timezones, same content

```bash
# 1. Morning post for US East Coast (9 AM EST)
curl -X POST https://eee.bot4wa.com/story/send \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "global-business",
    "type": "text",
    "content": "Good morning! ☀️\nSpecial deal today only!",
    "backgroundColor": "#FFD700",
    "font": 7,
    "statusJidList": [
      "us_customer1@s.whatsapp.net",
      "us_customer2@s.whatsapp.net"
    ]
  }'

# storyId: story_1729695500000_tz001

# 2. Resend for Europe (9 AM CET - 6 hours later)
curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695500000_tz001",
    "statusJidList": [
      "eu_customer1@s.whatsapp.net",
      "eu_customer2@s.whatsapp.net"
    ]
  }'

# 3. Resend for Asia (9 AM SGT - 12 hours later)
curl -X POST https://eee.bot4wa.com/story/resend \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story_1729695500000_tz001",
    "statusJidList": [
      "asia_customer1@s.whatsapp.net",
      "asia_customer2@s.whatsapp.net"
    ]
  }'
```

---

## 🔍 Management Endpoints

### List All Stories

```bash
# All stories
curl https://eee.bot4wa.com/stories

# Stories for specific session
curl https://eee.bot4wa.com/stories?sessionId=my-whatsapp
```

**Response:**
```json
{
  "stories": [
    {
      "storyId": "story_1729695142000_abc123def",
      "sessionId": "my-whatsapp",
      "type": "text",
      "content": "Big Announcement! 🎉",
      "totalSends": 2,
      "createdAt": "2025-10-23T14:45:42.000Z"
    },
    {
      "storyId": "story_1729695200000_xyz789",
      "sessionId": "my-whatsapp",
      "type": "image",
      "content": "https://example.com/new-product.jpg",
      "totalSends": 1,
      "createdAt": "2025-10-23T14:46:40.000Z"
    }
  ]
}
```

---

### Get Specific Story

```bash
curl https://eee.bot4wa.com/story/story_1729695142000_abc123def
```

See full details including all sends and their privacy settings.

---

## 📡 WebSocket Events

### When You Send a Story

```json
{
  "sessionId": "my-whatsapp",
  "event": "story.sent",
  "data": {
    "result": { ... },
    "storyId": "story_1729695142000_abc123def"
  },
  "timestamp": "2025-10-23T14:45:42.000Z"
}
```

### When You Resend a Story

```json
{
  "sessionId": "my-whatsapp",
  "event": "story.resent",
  "data": {
    "result": { ... },
    "storyId": "story_1729695142000_abc123def"
  },
  "timestamp": "2025-10-23T14:47:15.000Z"
}
```

---

## ⚙️ API Reference

### POST /story/send
Send a new story and get a `storyId`.

**Request:**
```json
{
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Hello World!",
  "backgroundColor": "#FF5733",
  "font": 7,
  "statusJidList": []
}
```

**Response:**
```json
{
  "success": true,
  "storyId": "story_1729695142000_abc123def",
  "messageId": "3EB0A1B2C3D4E5F6G7H8I9",
  "message": "Story sent successfully"
}
```

---

### POST /story/resend
Resend existing story to different audience.

**Request:**
```json
{
  "storyId": "story_1729695142000_abc123def",
  "statusJidList": []
}
```

**Response:**
```json
{
  "success": true,
  "storyId": "story_1729695142000_abc123def",
  "messageId": "3EB0J1K2L3M4N5O6P7Q8R9",
  "totalSends": 2,
  "message": "Story resent successfully"
}
```

**Parameters:**
- `storyId` (required) - The story to resend
- `statusJidList` (optional) - New privacy list ([] = all contacts)

---

### GET /story/:storyId
Get detailed story information.

**Response:**
```json
{
  "storyId": "story_1729695142000_abc123def",
  "sessionId": "my-whatsapp",
  "type": "text",
  "content": "Big Announcement! 🎉",
  "backgroundColor": "#FF5733",
  "font": 9,
  "totalSends": 2,
  "sends": [
    {
      "messageId": "3EB0A1B2C3D4E5F6G7H8I9",
      "statusJidList": ["1234567890@s.whatsapp.net"],
      "timestamp": "2025-10-23T14:45:42.000Z"
    },
    {
      "messageId": "3EB0J1K2L3M4N5O6P7Q8R9",
      "statusJidList": [],
      "timestamp": "2025-10-23T14:47:15.000Z"
    }
  ],
  "createdAt": "2025-10-23T14:45:42.000Z"
}
```

---

### GET /stories
List all stories (optionally filtered).

**Query Parameters:**
- `sessionId` (optional) - Filter by session

**Response:**
```json
{
  "stories": [
    {
      "storyId": "story_1729695142000_abc123def",
      "sessionId": "my-whatsapp",
      "type": "text",
      "content": "Big Announcement! 🎉",
      "totalSends": 2,
      "createdAt": "2025-10-23T14:45:42.000Z"
    }
  ]
}
```

---

## 💡 Best Practices

### ✅ DO:
1. **Test first** - Send to yourself or close friends before going public
2. **Track results** - Monitor WebSocket events to see engagement
3. **Segment wisely** - Group customers by behavior, not just demographics
4. **Time it right** - Consider when each audience is most active
5. **Use for retargeting** - Remind VIPs about important announcements

### ❌ DON'T:
1. **Spam** - Don't resend to same people multiple times (they'll see duplicate stories)
2. **Ignore privacy** - Respect that some posts should stay private
3. **Abuse VIP status** - Don't flood premium customers
4. **Forget tracking** - Always check `totalSends` before resending

---

## 🐛 Troubleshooting

### Error: "Story not found"
**Cause:** Invalid `storyId` or story was deleted
**Solution:** List all stories to find valid IDs

```bash
curl https://eee.bot4wa.com/stories
```

---

### Error: "Session not connected"
**Cause:** WhatsApp session disconnected
**Solution:** Check session status

```bash
curl https://eee.bot4wa.com/session/my-whatsapp/status
```

---

### Duplicate Stories Showing Up
**Expected Behavior:** Each resend creates a NEW story post. If you resend to the same JIDs, they'll see the content twice.

**Solution:** Use different `statusJidList` for each resend.

---

## 🎯 Advanced Workflow

### Complete Campaign Example

```javascript
// 1. Create story
const sendResponse = await fetch('https://eee.bot4wa.com/story/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'business',
    type: 'image',
    content: 'https://cdn.example.com/sale.jpg',
    caption: '🔥 48-Hour Flash Sale!',
    statusJidList: ['tester1@s.whatsapp.net']
  })
});

const { storyId } = await sendResponse.json();
console.log('Story ID:', storyId);

// 2. Wait 30 minutes, check feedback

// 3. Gradual rollout
const segments = [
  ['segment_a_1@s.whatsapp.net', 'segment_a_2@s.whatsapp.net'],
  ['segment_b_1@s.whatsapp.net', 'segment_b_2@s.whatsapp.net'],
  [] // Public (all contacts)
];

for (const [index, jidList] of segments.entries()) {
  await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute between sends

  await fetch('https://eee.bot4wa.com/story/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storyId,
      statusJidList: jidList
    })
  });

  console.log(`Sent to segment ${index + 1}`);
}

// 4. Check total sends
const storyData = await fetch(`https://eee.bot4wa.com/story/${storyId}`);
const { totalSends } = await storyData.json();
console.log(`Campaign complete! Total sends: ${totalSends}`);
```

---

**✨ You now have complete control over story distribution and audience targeting!**
