# API Server Refactoring Plan

## Current State
- File: `src/api-server.ts` (4,249 lines)

## Target Structure

### Types
- `src/types/session.types.ts`
- `src/types/story.types.ts`
- `src/types/contact.types.ts`

### Services
- `src/services/session.service.ts`
- `src/services/contacts.service.ts`
- `src/services/story.service.ts`
- `src/services/warmup.service.ts`
- `src/services/queue.service.ts`

### Database
- `src/database/story.db.ts`
- `src/database/events.db.ts`

### Routes
- `src/routes/session.routes.ts`
- `src/routes/story.routes.ts`
- `src/routes/contacts.routes.ts`
- `src/routes/lists.routes.ts`

### Utils
- `src/utils/jid.utils.ts`
- `src/utils/logger.ts`

### Config
- `src/config/constants.ts`

### Main Orchestrator
- `src/api-server.ts` (target: 100-200 lines)

## Phases

### Phase 1: Foundation
- Create directory structure
- Extract types/interfaces

### Phase 2: Services
- Extract business logic

### Phase 3: Routes
- Split API endpoints

### Phase 4: Integration
- Wire everything together
- Test all endpoints
