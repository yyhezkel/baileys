# Phase 4 Integration Guide

## Current Status

✅ **Phase 1-2 Complete**: Types and services extracted
✅ **Phase 3 Complete**: Routes extracted into 4 modular files
🚧 **Phase 4 In Progress**: Integration into main api-server.ts

## Files Ready for Integration

- `src/routes/session.routes.ts` - 9 session endpoints
- `src/routes/story.routes.ts` - 12 story endpoints
- `src/routes/contacts.routes.ts` - 7 contact endpoints
- `src/routes/lists.routes.ts` - 6 list endpoints

## Integration Steps

### 1. Add Route Imports (After line 19 in api-server.ts)

```typescript
// Import route creators
import { createSessionRoutes } from './routes/session.routes.js'
import { createStoryRoutes } from './routes/story.routes.js'
import { createContactsRoutes } from './routes/contacts.routes.js'
import { createListsRoutes } from './routes/lists.routes.js'
```

### 2. Mount Routes (Replace lines 1531-4094 with this ~80 line block)

```typescript
// =============================================================================
// REST API ENDPOINTS
// =============================================================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        sessions: sessions.size,
        timestamp: new Date().toISOString()
    })
})

// Mount Session Routes
const sessionRoutes = createSessionRoutes({
    sessions,
    sessionLogs,
    createSession,
    warmupEncryptionKeys,
    addSessionLog,
    contacts
})
app.use('/session', sessionRoutes)

// Mount Story Routes
const storyRoutes = createStoryRoutes({
    sessions,
    stories,
    storyViews,
    storyLikes,
    storyReactions,
    storyReplies,
    statusMessageAnchors,
    dbPool,
    processStatusJidList,
    queueStatus,
    saveStoryToDatabase,
    broadcastEvent,
    loadStoryEventsFromDatabase,
    addSessionLog
})
app.use('/story', storyRoutes)
app.use('/stories', storyRoutes) // Also mount at /stories for compatibility

// Mount Contacts Routes
const contactsRoutes = createContactsRoutes({
    sessions,
    contacts,
    defaultStatusRecipients,
    saveContactsToFile,
    saveDefaultRecipientsToFile
})
app.use('/contacts', contactsRoutes)

// Mount Lists Routes
const listsRoutes = createListsRoutes({
    sessions,
    contactLists,
    saveContactListsToFile
})
app.use('/lists', listsRoutes)

// Additional endpoints (message send, chat history, anchors)
app.post('/message/send', async (req, res) => {
    // Copy implementation from old api-server.ts lines 3093-3129
})

app.get('/anchors', (req, res) => {
    // Copy implementation from old api-server.ts lines 3131-3190
})

app.post('/chat/history', async (req, res) => {
    // Copy implementation from old api-server.ts lines 3192-3274
})
```

### 3. Keep Existing Code

**Lines 1-1530**: All setup code, data structures, and helper functions ✅ KEEP
**Lines 4095-4168**: Auto-restore and server startup ✅ KEEP

## File Size Reduction

- **Before**: 4,168 lines
- **After**: ~1,700 lines (~60% reduction!)
- **Removed**: ~2,500 lines of inline route handlers

## Route Path Changes

⚠️ **Important**: Route paths will change slightly:

### Old vs New Paths

| Old Path | New Path | Status |
|----------|----------|--------|
| `/session/create` | `/session/create` | ✅ Same |
| `/sessions` | `/sessions` | ✅ Same |
| `/story/create` | `/story/create` | ✅ Same |
| `/stories` | `/stories` | ✅ Same |
| `/contacts` | `/contacts` | ✅ Same |
| `/lists` | `/lists` | ✅ Same |

All paths remain the same! The route mounting preserves existing API structure.

## Testing Checklist

After integration, test these endpoints:

### Session Endpoints
- [ ] POST `/session/create`
- [ ] POST `/session/:sessionId/request-code`
- [ ] GET `/session/:sessionId/status`
- [ ] GET `/session/:sessionId/qr`
- [ ] DELETE `/session/:sessionId`

### Story Endpoints
- [ ] POST `/story/text`
- [ ] POST `/story/image`
- [ ] POST `/story/video`
- [ ] GET `/stories`
- [ ] GET `/story/:storyId/views`

### Contact Endpoints
- [ ] GET `/contacts?sessionId=...`
- [ ] POST `/contacts/add`
- [ ] GET `/contacts/status-recipients?sessionId=...`

### List Endpoints
- [ ] GET `/lists?sessionId=...`
- [ ] POST `/lists/create`
- [ ] POST `/lists/:listName/contacts/add`

## Benefits

✅ **Maintainability**: Easy to find and modify route handlers
✅ **Modularity**: Each route file is self-contained
✅ **Testability**: Routes can be tested in isolation
✅ **Scalability**: Easy to add new routes
✅ **Readability**: Clear separation of concerns

## Next Steps

1. Complete the integration following this guide
2. Test all endpoints thoroughly
3. Update REFACTORING_PLAN.md
4. Move to Dashboard Story Logs feature

## Backup

Original file backed up at: `src/api-server.ts.backup`

To restore if needed:
```bash
cp src/api-server.ts.backup src/api-server.ts
```
