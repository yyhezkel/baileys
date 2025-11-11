# Intelligent Adaptive Scaling System

## Concept

Instead of blindly following progressive batches, the system:
1. **Monitors performance** - tracks batch timing and success rate
2. **Scales dynamically** - if batch succeeds fast → skip ahead to larger sizes
3. **Learns per session** - remembers max proven batch size
4. **Skips ramping** - starts at proven level on subsequent sends

## Configuration

```typescript
interface SmartSendConfig {
  // Performance thresholds
  fastBatchThresholdMs: number        // If batch completes < this, scale faster (default: 2000ms)
  slowBatchThresholdMs: number        // If batch takes > this, scale slower (default: 10000ms)
  minSuccessRate: number              // Minimum success rate to scale up (default: 0.95 = 95%)

  // Session learning
  enableSessionLearning: boolean      // Remember max successful batch per session (default: true)
  sessionMemoryTTL: number           // How long to remember (ms, default: 24h)

  // Progressive sequence
  progressiveSequence: number[]      // Batch sizes: [100, 500, 1000, 2000, 4000, 5000]
  minRecipientsForSmartSend: number // Threshold to use smart send (default: 100)

  // Safety limits
  maxBatchSize: number               // Never exceed this size (default: 10000)
  maxBatchesPerSecond: number        // Rate limiting (default: 2)
}
```

## Session Learning Storage

```typescript
interface SessionBatchHistory {
  sessionId: string
  maxProvenBatchSize: number         // Largest successful batch
  lastSuccessfulSend: Date
  totalSuccessfulSends: number
  averageBatchTime: number           // Average time per batch
  successRate: number                // Overall success rate
}

// Store per session
const sessionBatchHistory = new Map<string, SessionBatchHistory>()
```

## Dynamic Scaling Logic

### Scenario 1: First Send (No History)
```
Recipients: 5000
History: None

Flow:
1. Send to 1 (anchor) → get messageId [time: 150ms]
2. Send to 100 → SUCCESS [time: 800ms] ✅ FAST!
3. Since fast (< 2000ms), skip 500 and jump to 1000
4. Send to 1000 → SUCCESS [time: 1500ms] ✅ FAST!
5. Skip 2000, jump to 4000
6. Send to 4000 → SUCCESS [time: 3500ms] ✅ MODERATE
7. Send remaining 95 → SUCCESS

Result: Completed in 5 batches instead of 7
Store: maxProvenBatchSize = 4000
```

### Scenario 2: Second Send (With History)
```
Recipients: 5000
History: maxProvenBatchSize = 4000

Flow:
1. Send to 1 (anchor) → get messageId
2. Skip ramping! Jump directly to 4000 (proven level)
3. Send to 4000 → SUCCESS [time: 3200ms]
4. Send remaining 999 → SUCCESS

Result: Completed in just 3 batches! 🚀
```

### Scenario 3: Network Issues (Scale Down)
```
Recipients: 10000
History: maxProvenBatchSize = 5000

Flow:
1. Send to 1 (anchor) → get messageId [time: 150ms]
2. Jump to 5000 (proven level)
3. Send to 5000 → TIMEOUT [time: 15000ms] ❌ SLOW!
4. Scale down! Next batch: 2000
5. Send to 2000 → SUCCESS [time: 2500ms] ✅
6. Try 4000 (one level up)
7. Send to 4000 → SUCCESS [time: 4200ms] ✅
8. Update proven level to 4000
9. Send remaining 2999 → SUCCESS

Result: Adapted to network conditions
Store: maxProvenBatchSize = 4000 (downgraded)
```

## Implementation

### 1. Configuration (Environment Variables)

```env
# .env configuration
SMART_SEND_FAST_THRESHOLD_MS=2000
SMART_SEND_SLOW_THRESHOLD_MS=10000
SMART_SEND_MIN_SUCCESS_RATE=0.95
SMART_SEND_ENABLE_LEARNING=true
SMART_SEND_MEMORY_TTL_HOURS=24
SMART_SEND_MAX_BATCH_SIZE=10000
```

### 2. Config Loading

```typescript
const smartSendConfig: SmartSendConfig = {
  fastBatchThresholdMs: parseInt(process.env.SMART_SEND_FAST_THRESHOLD_MS || '2000'),
  slowBatchThresholdMs: parseInt(process.env.SMART_SEND_SLOW_THRESHOLD_MS || '10000'),
  minSuccessRate: parseFloat(process.env.SMART_SEND_MIN_SUCCESS_RATE || '0.95'),
  enableSessionLearning: process.env.SMART_SEND_ENABLE_LEARNING !== 'false',
  sessionMemoryTTL: parseInt(process.env.SMART_SEND_MEMORY_TTL_HOURS || '24') * 60 * 60 * 1000,
  progressiveSequence: [100, 500, 1000, 2000, 4000, 5000],
  minRecipientsForSmartSend: 100,
  maxBatchSize: parseInt(process.env.SMART_SEND_MAX_BATCH_SIZE || '10000')
}
```

### 3. Session History Management

```typescript
function getSessionHistory(sessionId: string): SessionBatchHistory | null {
  const history = sessionBatchHistory.get(sessionId)
  if (!history) return null

  // Check if expired
  const age = Date.now() - history.lastSuccessfulSend.getTime()
  if (age > smartSendConfig.sessionMemoryTTL) {
    sessionBatchHistory.delete(sessionId)
    return null
  }

  return history
}

function updateSessionHistory(
  sessionId: string,
  batchSize: number,
  batchTime: number,
  success: boolean
) {
  let history = sessionBatchHistory.get(sessionId)

  if (!history) {
    history = {
      sessionId,
      maxProvenBatchSize: 0,
      lastSuccessfulSend: new Date(),
      totalSuccessfulSends: 0,
      averageBatchTime: 0,
      successRate: 1.0
    }
  }

  if (success) {
    // Update max proven batch size
    if (batchSize > history.maxProvenBatchSize) {
      history.maxProvenBatchSize = batchSize
    }

    history.lastSuccessfulSend = new Date()
    history.totalSuccessfulSends++

    // Update rolling average
    history.averageBatchTime =
      (history.averageBatchTime * 0.8) + (batchTime * 0.2)
  }

  sessionBatchHistory.set(sessionId, history)

  logger.info({
    sessionId,
    maxProvenBatchSize: history.maxProvenBatchSize,
    averageBatchTime: history.averageBatchTime
  }, 'Updated session history')
}
```

### 4. Dynamic Batch Creation

```typescript
function createAdaptiveBatches(
  remainingRecipients: string[],
  sessionId: string
): string[][] {
  const batches: string[][] = []
  const sequence = smartSendConfig.progressiveSequence

  // Check session history
  const history = getSessionHistory(sessionId)
  let startIndex = 0

  if (history && history.maxProvenBatchSize > 0) {
    // Skip ramping! Start at proven level
    const provenSize = history.maxProvenBatchSize
    logger.info({
      sessionId,
      provenSize,
      skippingTo: provenSize
    }, 'Using session history - skipping to proven batch size')

    // Find index of proven size in sequence
    startIndex = sequence.findIndex(size => size >= provenSize)
    if (startIndex === -1) startIndex = sequence.length - 1
  }

  let remaining = remainingRecipients.slice()

  // Start from proven level or beginning
  for (let i = startIndex; i < sequence.length; i++) {
    const batchSize = sequence[i]!

    if (remaining.length >= batchSize * 1.5) {
      batches.push(remaining.slice(0, batchSize))
      remaining = remaining.slice(batchSize)
    } else {
      break
    }
  }

  // Add remaining
  if (remaining.length > 0) {
    batches.push(remaining)
  }

  return batches
}
```

### 5. Performance Monitoring

```typescript
async function sendBatchWithMonitoring(
  session: any,
  message: any,
  batch: string[],
  messageId: string,
  options: any
): Promise<{ success: boolean, duration: number }> {
  const startTime = Date.now()

  try {
    await session.socket.sendMessage('status@broadcast', message, {
      statusJidList: batch,
      messageId: messageId,
      ...options
    })

    const duration = Date.now() - startTime

    logger.debug({
      messageId,
      batchSize: batch.length,
      duration,
      performance: duration < smartSendConfig.fastBatchThresholdMs ? 'FAST' :
                   duration > smartSendConfig.slowBatchThresholdMs ? 'SLOW' : 'NORMAL'
    }, 'Batch sent')

    return { success: true, duration }

  } catch (error) {
    const duration = Date.now() - startTime
    logger.error({
      messageId,
      batchSize: batch.length,
      duration,
      error: error.message
    }, 'Batch send failed')

    return { success: false, duration }
  }
}
```

### 6. Dynamic Scaling Decision

```typescript
function shouldScaleUp(
  batchSize: number,
  duration: number,
  sequence: number[]
): { shouldScale: boolean, skipTo?: number } {
  // If FAST, skip ahead
  if (duration < smartSendConfig.fastBatchThresholdMs) {
    const currentIndex = sequence.indexOf(batchSize)
    if (currentIndex !== -1 && currentIndex < sequence.length - 2) {
      const skipTo = sequence[currentIndex + 2] // Skip one level
      logger.info({
        batchSize,
        duration,
        skippingTo: skipTo
      }, 'Fast batch - skipping ahead!')
      return { shouldScale: true, skipTo }
    }
  }

  return { shouldScale: false }
}

function shouldScaleDown(duration: number): boolean {
  return duration > smartSendConfig.slowBatchThresholdMs
}
```

## Usage Example

### With Configuration

```typescript
// In your .env file
SMART_SEND_FAST_THRESHOLD_MS=2000        # If batch < 2s, scale faster
SMART_SEND_SLOW_THRESHOLD_MS=10000       # If batch > 10s, scale slower
SMART_SEND_MIN_SUCCESS_RATE=0.95         # Need 95% success to scale
SMART_SEND_ENABLE_LEARNING=true          # Remember per session
SMART_SEND_MEMORY_TTL_HOURS=24           # Remember for 24 hours
SMART_SEND_MAX_BATCH_SIZE=10000          # Never exceed 10K per batch
```

### API Call

```typescript
// First send - will ramp progressively
POST /api/story/text
{
  "text": "Hello World!",
  "statusJidList": [5000 contacts...],
  "canBeReshared": true
}

// Response
{
  "messageId": "ABC123",
  "totalRecipients": 5000,
  "batches": 6,
  "batchSequence": [100, 1000, 4000, 900],  // Skipped 500 & 2000 due to fast performance
  "totalDuration": 8500,
  "sessionLearning": {
    "maxProvenBatchSize": 4000,
    "willSkipRampingNextTime": true
  }
}

// Second send (same session) - will skip ramping!
POST /api/story/text
{
  "text": "Another update!",
  "statusJidList": [3000 contacts...],
  "canBeReshared": true
}

// Response
{
  "messageId": "XYZ789",
  "totalRecipients": 3000,
  "batches": 2,
  "batchSequence": [4000],  // Jumped straight to proven level! 🚀
  "totalDuration": 4200,
  "sessionLearning": {
    "maxProvenBatchSize": 4000,
    "usedHistoricalData": true
  }
}
```

## Benefits

1. **Learns from experience** - remembers what works for each session
2. **Adapts to network** - scales down when slow, up when fast
3. **Saves time** - skips ramping on subsequent sends
4. **Configurable** - adjust thresholds per deployment
5. **Session-specific** - different accounts may have different limits
6. **Safe** - always starts with anchor, never exceeds limits

## Testing Strategy

```typescript
describe('Intelligent Adaptive Scaling', () => {
  test('first send uses progressive ramping', () => {
    // No history → start at 100
  })

  test('fast batches skip ahead', () => {
    // If batch < 2000ms → skip one level
  })

  test('slow batches scale down', () => {
    // If batch > 10000ms → use smaller size
  })

  test('second send skips to proven level', () => {
    // History: maxProven=5000 → jump to 5000
  })

  test('expired history is ignored', () => {
    // History older than TTL → start fresh
  })

  test('failed batches do not update max proven', () => {
    // Only success updates history
  })
})
```
