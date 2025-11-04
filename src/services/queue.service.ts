import type { StatusQueueItem, SessionData } from '../api-types/index.js'
import { logger } from '../api-utils/logger.js'

// Status send queue per session
// Key: sessionId, Value: Queue of status send operations
const statusQueues = new Map<string, StatusQueueItem[]>()
const queueProcessing = new Map<string, boolean>()

/**
 * Get queue for session
 */
export function getQueue(sessionId: string): StatusQueueItem[] {
    return statusQueues.get(sessionId) || []
}

/**
 * Get queue processing status
 */
export function isQueueProcessing(sessionId: string): boolean {
    return queueProcessing.get(sessionId) || false
}

/**
 * Set queue processing status
 */
export function setQueueProcessing(sessionId: string, processing: boolean): void {
    queueProcessing.set(sessionId, processing)
}

/**
 * Add status to queue
 */
export function queueStatus(
    sessionId: string,
    type: StatusQueueItem['type'],
    data: any,
    maxRetries: number = 3
): Promise<any> {
    return new Promise((resolve, reject) => {
        const queue = statusQueues.get(sessionId) || []

        const item: StatusQueueItem = {
            type,
            data,
            resolve,
            reject,
            retries: 0,
            maxRetries
        }

        queue.push(item)
        statusQueues.set(sessionId, queue)

        logger.info({
            sessionId,
            type,
            queueLength: queue.length,
            maxRetries
        }, 'Status added to queue')
    })
}

/**
 * Process status send queue for a session
 * This function should be called with session handlers that actually send the statuses
 */
export async function processStatusQueue(
    sessionId: string,
    sessions: Map<string, SessionData>,
    handlers: {
        sendText: (session: SessionData, data: any) => Promise<any>,
        sendImage: (session: SessionData, data: any) => Promise<any>,
        sendVideo: (session: SessionData, data: any) => Promise<any>,
        sendAudio: (session: SessionData, data: any) => Promise<any>
    }
): Promise<void> {
    // Check if already processing
    if (queueProcessing.get(sessionId)) {
        return
    }

    const queue = statusQueues.get(sessionId)
    if (!queue || queue.length === 0) {
        queueProcessing.set(sessionId, false)
        return
    }

    queueProcessing.set(sessionId, true)

    while (queue.length > 0) {
        const item = queue[0]! // Peek first item
        const session = sessions.get(sessionId)

        if (!session || session.status !== 'connected') {
            logger.error({ sessionId }, 'Session not connected, pausing queue')
            item.reject(new Error('Session not connected'))
            queue.shift() // Remove failed item
            continue
        }

        try {
            logger.info({
                sessionId,
                type: item.type,
                queueLength: queue.length,
                retries: item.retries,
                maxRetries: item.maxRetries
            }, 'Processing status from queue')

            let result: any

            // Send the status based on type
            if (item.type === 'text') {
                result = await handlers.sendText(session, item.data)
            } else if (item.type === 'image') {
                result = await handlers.sendImage(session, item.data)
            } else if (item.type === 'video') {
                result = await handlers.sendVideo(session, item.data)
            } else if (item.type === 'audio') {
                result = await handlers.sendAudio(session, item.data)
            }

            // Success! Resolve and remove from queue
            item.resolve(result)
            queue.shift()

            logger.info({
                sessionId,
                type: item.type,
                remainingInQueue: queue.length
            }, 'Status sent successfully')

        } catch (error: any) {
            logger.error({
                sessionId,
                type: item.type,
                error: error.message,
                retries: item.retries,
                maxRetries: item.maxRetries
            }, 'Error sending status')

            item.retries++

            if (item.retries >= item.maxRetries) {
                // Max retries reached, fail this item
                logger.error({ sessionId, type: item.type }, 'Max retries reached, failing item')
                item.reject(new Error(`Failed after ${item.maxRetries} retries: ${error.message}`))
                queue.shift()
            } else {
                // Retry after delay (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, item.retries), 10000) // Max 10 seconds
                logger.info({ sessionId, type: item.type, delay, nextRetry: item.retries + 1 }, 'Retrying after delay')
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
    }

    queueProcessing.set(sessionId, false)
    logger.info({ sessionId }, 'Queue processing completed')
}

/**
 * Clear queue for session
 */
export function clearQueue(sessionId: string): void {
    statusQueues.delete(sessionId)
    queueProcessing.delete(sessionId)
    logger.info({ sessionId }, 'Queue cleared')
}
