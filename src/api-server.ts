import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import swaggerUi from 'swagger-ui-express'
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    type WASocket,
    type AnyMessageContent
} from './index.js'
import { Boom } from '@hapi/boom'
import P from 'pino'
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import { swaggerDocument } from './swagger.js'
import pg from 'pg'

// Import route creators
import { createSessionRoutes } from './routes/session.routes.js'
import { createStoryRoutes } from './routes/story.routes.js'
import { createContactsRoutes } from './routes/contacts.routes.js'
import { createListsRoutes } from './routes/lists.routes.js'
import type { SessionData, SessionLog, StoryData, StoryView, StoryLike, StoryReaction, StoryReply, StatusQueueItem } from './api-types/index.js'

const { Pool } = pg

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

app.use(express.json())

// Swagger UI with strict no-cache headers
// Prevent proxies, CDNs, and browsers from caching API documentation
app.use('/api-docs', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.set('Pragma', 'no-cache')
    res.set('Expires', '0')
    next()
})

// @ts-ignore - Type mismatch between express versions
app.use('/api-docs', ...swaggerUi.serve)
// @ts-ignore - Type mismatch between express versions
app.get('/api-docs', swaggerUi.setup(swaggerDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Baileys WhatsApp API Documentation'
}))

// Logger
const logger = P({ level: 'info' })

// PostgreSQL connection pool
const dbPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'baileys',
    user: process.env.DB_USER || 'baileys',
    password: process.env.DB_PASSWORD || 'baileys_password',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
})

// Test database connection
dbPool.on('connect', () => {
    logger.info('Connected to PostgreSQL database')
})

dbPool.on('error', (err: Error) => {
    logger.error({ error: err }, 'PostgreSQL connection error')
})

// Store active sessions
const sessions = new Map<string, SessionData>()

// Store session logs
const sessionLogs = new Map<string, SessionLog[]>()

// Helper function to add log entry
function addSessionLog(sessionId: string, level: 'info' | 'warn' | 'error', message: string, data?: any) {
    if (!sessionLogs.has(sessionId)) {
        sessionLogs.set(sessionId, [])
    }
    const logs = sessionLogs.get(sessionId)!
    logs.push({
        timestamp: new Date(),
        level,
        message,
        data
    })
    // Keep only last 100 logs per session
    if (logs.length > 100) {
        logs.shift()
    }
}

// Store sent stories for resending
const stories = new Map<string, StoryData>()

// Store story views (messageId -> array of views)
const storyViews = new Map<string, StoryView[]>()

// Store story likes (messageId -> array of likes) - the 💚 status like button
const storyLikes = new Map<string, StoryLike[]>()

// Store story reactions (messageId -> array of reactions) - the 8 quick emoji reactions
const storyReactions = new Map<string, StoryReaction[]>()

// Store story text replies (messageId -> array of replies)
const storyReplies = new Map<string, StoryReply[]>()

// Store the most recent status message key per session (for fetchMessageHistory anchor)
const statusMessageAnchors = new Map<string, { key: any, timestamp: any, fromMe: boolean, updatedAt: Date }>()

// Store message anchors from all chats (for fetchMessageHistory)
// Key format: "sessionId:chatJid" -> { key, timestamp, fromMe }
const chatMessageAnchors = new Map<string, { key: any, timestamp: any, fromMe: boolean, updatedAt: Date }>()

// Store contacts per session
// Key format: "sessionId:jid" -> contact data
const contacts = new Map<string, any>()

// Contacts directory for persistent storage
const CONTACTS_DIR = './contacts-storage'

// Initialize contacts storage directory
if (!fs.existsSync(CONTACTS_DIR)) {
    fs.mkdirSync(CONTACTS_DIR, { recursive: true })
}

// Function to load story events from database into memory
async function loadStoryEventsFromDatabase(storyId?: string) {
    try {
        let query = 'SELECT * FROM story_events'
        const params: any[] = []

        if (storyId) {
            query += ' WHERE story_id = $1'
            params.push(storyId)
        }

        query += ' ORDER BY event_timestamp ASC'

        const result = await dbPool.query(query, params)

        logger.info({ eventCount: result.rows.length, storyId }, 'Loading story events from database')

        result.rows.forEach((row: any) => {
            const story = stories.get(row.story_id)
            if (!story) return // Skip events for stories that don't exist

            // Get the message ID from the story
            const messageId = story.messageIds[0] // Use first message ID as primary
            if (!messageId) return

            // Process based on event type
            if (row.event_type === 'view') {
                if (!storyViews.has(messageId)) {
                    storyViews.set(messageId, [])
                }

                const views = storyViews.get(messageId)!
                const existingView = views.find(v => v.viewer === row.participant_number)

                if (!existingView) {
                    views.push({
                        viewer: row.participant_number,
                        deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
                        viewedAt: row.viewed_at ? new Date(row.viewed_at) : undefined,
                        playedAt: row.played_at ? new Date(row.played_at) : undefined
                    })
                }
            } else if (row.event_type === 'like') {
                if (!storyLikes.has(messageId)) {
                    storyLikes.set(messageId, [])
                }

                const likes = storyLikes.get(messageId)!
                const existingLike = likes.find(l => l.liker === row.participant_number)

                if (!existingLike) {
                    likes.push({
                        liker: row.participant_number,
                        timestamp: row.event_timestamp ? new Date(row.event_timestamp) : new Date()
                    })
                }
            } else if (row.event_type === 'reaction') {
                if (!storyReactions.has(messageId)) {
                    storyReactions.set(messageId, [])
                }

                const reactions = storyReactions.get(messageId)!
                const existingReaction = reactions.find(r => r.reactor === row.participant_number)

                if (!existingReaction) {
                    reactions.push({
                        reactor: row.participant_number,
                        emoji: row.emoji || '👍',
                        timestamp: row.event_timestamp ? new Date(row.event_timestamp) : new Date()
                    })
                }
            } else if (row.event_type === 'reply') {
                if (!storyReplies.has(messageId)) {
                    storyReplies.set(messageId, [])
                }

                const replies = storyReplies.get(messageId)!

                replies.push({
                    replier: row.participant_number,
                    message: row.message || '',
                    timestamp: row.event_timestamp ? new Date(row.event_timestamp) : new Date()
                })
            }
        })

        logger.info({
            viewsCount: storyViews.size,
            likesCount: storyLikes.size,
            reactionsCount: storyReactions.size,
            repliesCount: storyReplies.size
        }, 'Story events loaded from database')
    } catch (error) {
        logger.error({ error }, 'Error loading story events from database')
    }
}

// Save contacts to persistent storage
function saveContactsToFile(accountPhoneNumber: string) {
    const accountContacts: any[] = []
    const accountPrefix = `${accountPhoneNumber}:`

    contacts.forEach((contact, key) => {
        if (key.startsWith(accountPrefix)) {
            accountContacts.push(contact)
        }
    })

    const filePath = path.join(CONTACTS_DIR, `${accountPhoneNumber}_contacts.json`)
    fs.writeFileSync(filePath, JSON.stringify(accountContacts, null, 2))
    logger.info({ accountPhoneNumber, count: accountContacts.length }, 'Saved contacts to file')
}

// Load contacts from persistent storage
function loadContactsFromFile(accountPhoneNumber: string) {
    const filePath = path.join(CONTACTS_DIR, `${accountPhoneNumber}_contacts.json`)

    if (!fs.existsSync(filePath)) {
        logger.info({ accountPhoneNumber }, 'No contacts file found for this account')
        return
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8')
        const accountContacts = JSON.parse(data)

        accountContacts.forEach((contact: any) => {
            const key = `${accountPhoneNumber}:${contact.jid}`
            contacts.set(key, contact)
        })

        logger.info({ accountPhoneNumber, count: accountContacts.length }, 'Loaded contacts from file')
    } catch (error: any) {
        logger.error({ accountPhoneNumber, error: error.message }, 'Failed to load contacts')
    }
}

/**
 * Process statusJidList to support plain phone numbers and send_to_own_device option
 * WAHA-compatible: null/undefined statusJidList = send to ALL contacts + default recipients
 * @param statusJidList - Array of phone numbers or JIDs (null/undefined = all contacts + default)
 * @param sendToOwnDevice - Whether to include own device in the list
 * @param sendToAllContacts - Explicit flag to send to all contacts (overrides statusJidList)
 * @param accountPhoneNumber - The account's own phone number
 * @param includeDefaultRecipients - Whether to include default recipients (default: true)
 * @param listName - Name of contact list to send to (optional)
 * @returns Processed array of JIDs
 */
function processStatusJidList(
    statusJidList: string[] | undefined | null,
    sendToOwnDevice: boolean | undefined,
    sendToAllContacts: boolean | undefined,
    accountPhoneNumber: string | undefined,
    includeDefaultRecipients: boolean = true,
    listName?: string
): string[] {
    let jidList: string[] = []

    // If listName is provided, use that list
    if (listName && accountPhoneNumber) {
        const lists = contactLists.get(accountPhoneNumber)
        if (lists && lists.has(listName)) {
            jidList = [...lists.get(listName)!]
            logger.info({ accountPhoneNumber, listName, contacts: jidList.length }, 'Sending status to contact list')
        } else {
            logger.warn({ accountPhoneNumber, listName }, 'Contact list not found')
        }
    }
    // If send_to_all_contacts is explicitly true OR statusJidList is null/undefined, get all contacts
    else if ((sendToAllContacts || statusJidList === null || statusJidList === undefined) && accountPhoneNumber) {
        const accountPrefix = `${accountPhoneNumber}:`
        contacts.forEach((contact, key) => {
            if (key.startsWith(accountPrefix)) {
                // Only include individual contacts with proper phone numbers
                // Exclude:
                // - Groups (@g.us)
                // - LID/Channels (@lid)
                // - Broadcast lists (@broadcast)
                // - Newsletters (@newsletter)
                if (contact.jid.endsWith('@s.whatsapp.net')) {
                    // Additional filter: only include if contact has a name or notify
                    // This helps filter out contacts that are only from groups
                    // (group-only contacts typically don't have name/notify from regular contact sync)
                    if (contact.name || contact.notify) {
                        jidList.push(contact.jid)
                    }
                }
            }
        })

        logger.info({ accountPhoneNumber, totalContacts: jidList.length, totalInMemory: contacts.size }, 'Sending status to filtered contacts (excluding groups, @lid, and unnamed contacts)')
    }
    // If statusJidList is an empty array [], send to nobody (explicit empty list)
    else if (statusJidList && statusJidList.length === 0) {
        logger.info({ accountPhoneNumber }, 'Sending status to nobody (empty statusJidList)')
    }
    // Otherwise, process statusJidList - convert plain phone numbers to JIDs
    else if (statusJidList && statusJidList.length > 0) {
        jidList = statusJidList.map(item => {
            // If already a JID (contains @), use as-is
            if (item.includes('@')) {
                return item
            }
            // Otherwise, treat as phone number and add @s.whatsapp.net
            return `${item}@s.whatsapp.net`
        })
    }

    // Add default status recipients (if enabled and account has them)
    if (includeDefaultRecipients && accountPhoneNumber) {
        const defaultRecipients = defaultStatusRecipients.get(accountPhoneNumber) || []
        if (defaultRecipients.length > 0) {
            // Add default recipients, avoiding duplicates
            defaultRecipients.forEach(jid => {
                if (!jidList.includes(jid)) {
                    jidList.push(jid)
                }
            })
            logger.info({
                accountPhoneNumber,
                defaultRecipientsAdded: defaultRecipients.length,
                totalRecipients: jidList.length
            }, 'Added default status recipients')
        }
    }

    // Add own device if requested (insert at beginning like WAHA does)
    if (sendToOwnDevice && accountPhoneNumber) {
        const ownJid = `${accountPhoneNumber}@s.whatsapp.net`
        // Only add if not already in the list
        if (!jidList.includes(ownJid)) {
            // Insert at beginning
            jidList.unshift(ownJid)
        }
    }

    return jidList
}

/**
 * Smart warmup: Send ONE status, then resend to all contacts in batches
 * This creates only 1 status (not hundreds), and all views accumulate on it
 *
 * Strategy:
 * 1. Send to 1 contact first (get message ID)
 * 2. Resend to active contacts (viewed status in last 7 days) - batches of batchSize
 * 3. Resend to remaining contacts - batches of batchSize
 * 4. No delays - just batch after batch for speed
 *
 * @param sessionId - Session identifier
 * @param batchSize - Number of contacts per batch (default: 1000)
 * @param maxContacts - Maximum contacts to warmup (undefined = all)
 */
async function warmupEncryptionKeys(
    sessionId: string,
    batchSize: number = 1000,
    maxContacts?: number
) {
    try {
        const session = sessions.get(sessionId)
        if (!session || session.status !== 'connected') {
            logger.warn({ sessionId }, 'Cannot warmup: session not connected')
            return
        }

        const accountPhoneNumber = session.accountPhoneNumber
        if (!accountPhoneNumber) {
            logger.warn({ sessionId }, 'Cannot warmup: account phone number not available')
            return
        }

        // Get all contacts
        const allContacts: string[] = []
        const accountPrefix = `${accountPhoneNumber}:`
        contacts.forEach((contact, key) => {
            if (key.startsWith(accountPrefix) && contact.jid.endsWith('@s.whatsapp.net')) {
                allContacts.push(contact.jid)
            }
        })

        if (allContacts.length === 0) {
            logger.info({ sessionId }, 'No contacts to warmup')
            return
        }

        // Limit contacts if maxContacts is specified
        let contactsToWarmup = maxContacts
            ? allContacts.slice(0, maxContacts)
            : allContacts

        // For large lists (>5000), use smart resend strategy
        if (contactsToWarmup.length > 5000) {
            logger.info({
                sessionId,
                totalContacts: contactsToWarmup.length,
                strategy: 'smart-resend'
            }, 'Using smart resend strategy for large contact list')

            // Step 1: Send to first contact to get message ID
            const firstContact = contactsToWarmup[0]!
            logger.info({ sessionId, firstContact }, 'Sending initial status to first contact')

            const initialResult = await session.socket.sendMessage('status@broadcast', {
                text: '.'
            }, {
                statusJidList: [firstContact]
            })

            const messageId = initialResult?.key?.id
            if (!messageId) {
                logger.error({ sessionId }, 'Failed to get message ID from initial send')
                return
            }

            logger.info({ sessionId, messageId }, 'Initial status sent, starting resend to remaining contacts')

            // Step 2: Sort remaining contacts by activity
            // TODO: Track status view timestamps - for now just use all remaining contacts
            const remainingContacts = contactsToWarmup.slice(1)

            // Step 3: Resend in batches (NO DELAYS - just batch after batch)
            const batches = []
            for (let i = 0; i < remainingContacts.length; i += batchSize) {
                batches.push(remainingContacts.slice(i, i + batchSize))
            }

            logger.info({
                sessionId,
                totalBatches: batches.length,
                batchSize,
                remainingContacts: remainingContacts.length
            }, 'Starting batch resend')

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i]!
                logger.info({
                    sessionId,
                    batchNumber: i + 1,
                    batchCount: batches.length,
                    batchSize: batch.length,
                    progress: `${Math.round(((i + 1) / batches.length) * 100)}%`
                }, 'Resending to batch')

                try {
                    // Resend using the SAME message ID
                    await session.socket.sendMessage('status@broadcast', {
                        text: '.'
                    }, {
                        statusJidList: batch,
                        messageId: messageId  // Reuse same ID!
                    })
                } catch (error: any) {
                    logger.error({ sessionId, batchNumber: i + 1, error: error.message }, 'Error resending to batch')
                    // Continue with next batch even if one fails
                }
            }

            logger.info({
                sessionId,
                totalContacts: contactsToWarmup.length,
                batchCount: batches.length
            }, 'Smart resend warmup completed')

        } else {
            // For smaller lists (<5000), use simple approach
            logger.info({
                sessionId,
                totalContacts: contactsToWarmup.length,
                strategy: 'simple-batch'
            }, 'Using simple batch strategy for small contact list')

            const batches = []
            for (let i = 0; i < contactsToWarmup.length; i += batchSize) {
                batches.push(contactsToWarmup.slice(i, i + batchSize))
            }

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i]!
                logger.info({
                    sessionId,
                    batchNumber: i + 1,
                    batchCount: batches.length,
                    batchSize: batch.length,
                    progress: `${Math.round(((i + 1) / batches.length) * 100)}%`
                }, 'Sending warmup batch')

                try {
                    await session.socket.sendMessage('status@broadcast', {
                        text: '.'
                    }, {
                        statusJidList: batch
                    })
                } catch (error: any) {
                    logger.error({ sessionId, batchNumber: i + 1, error: error.message }, 'Error sending warmup batch')
                }
            }

            logger.info({
                sessionId,
                totalContacts: contactsToWarmup.length,
                batchCount: batches.length
            }, 'Simple batch warmup completed')
        }
    } catch (error: any) {
        logger.error({ sessionId, error: error.message }, 'Error in warmup process')
    }
}

/**
 * Create progressive ramping batches
 * Start small and gradually increase batch sizes
 *
 * Examples:
 * - 500 contacts: [100, 399] (1→100→rest)
 * - 2,000 contacts: [100, 500, 1000, 399] (1→100→500→1000→rest)
 * - 20,000 contacts: [100, 500, 1000, 2000, 4000, 5000, 5399] (1→100→500→1000→2000→4000→5000→rest)
 */
function createProgressiveBatches(remainingRecipients: string[]): string[][] {
    const batches: string[][] = []
    const progressiveSequence = [100, 500, 1000, 2000, 4000, 5000]

    let remaining = remainingRecipients.slice() // Copy array

    for (const batchSize of progressiveSequence) {
        // If we have enough contacts for this batch size (at least 1.5x)
        // then create a batch of this size, otherwise send all remaining
        if (remaining.length >= batchSize * 1.5) {
            batches.push(remaining.slice(0, batchSize))
            remaining = remaining.slice(batchSize)
        } else {
            // Not enough for this batch size, send all remaining and stop
            break
        }
    }

    // Add final batch with all remaining recipients
    if (remaining.length > 0) {
        batches.push(remaining)
    }

    return batches
}

/**
 * Smart send status using message anchoring and adaptive batching
 *
 * Process:
 * 1. Send to ONE contact (anchor) to get message ID
 * 2. Resend same message ID to remaining contacts in adaptive batches
 */
async function smartSendStatus(
    session: any,
    message: any,
    recipients: string[],
    options: any = {}
): Promise<any> {
    const startTime = Date.now()

    // If too few recipients, use direct send
    const minRecipientsForSmartSend = 100
    if (recipients.length < minRecipientsForSmartSend) {
        logger.debug({
            recipients: recipients.length,
            threshold: minRecipientsForSmartSend
        }, 'Using direct send (below smart send threshold)')

        const result = await session.socket.sendMessage('status@broadcast', message, {
            statusJidList: recipients,
            ...options
        })

        return {
            key: result.key,
            storyId: result.key?.id,
            messageId: result.key?.id,
            totalRecipients: recipients.length,
            strategy: 'direct-send',
            duration: Date.now() - startTime
        }
    }

    // SMART SEND: Step 1 - Send to anchor contact to get message ID
    const anchorContact = recipients[0]!
    logger.info({
        totalRecipients: recipients.length,
        anchorContact
    }, 'Smart send: Sending to anchor contact')

    const anchorResult = await session.socket.sendMessage('status@broadcast', message, {
        statusJidList: [anchorContact],
        ...options
    })

    const messageId = anchorResult.key?.id
    if (!messageId) {
        throw new Error('Failed to get message ID from anchor send')
    }

    logger.info({ messageId }, 'Smart send: Anchor message sent successfully')

    // SMART SEND: Step 2 - Create progressive ramping batches
    const remainingRecipients = recipients.slice(1)
    const batches = createProgressiveBatches(remainingRecipients)

    logger.info({
        messageId,
        totalRecipients: recipients.length,
        remainingRecipients: remainingRecipients.length,
        totalBatches: batches.length,
        batchSequence: batches.map(b => b.length)
    }, 'Smart send: Created progressive batches, starting resend')

    // SMART SEND: Step 4 - Send batches with same message ID
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]!
        const batchNumber = i + 1

        logger.debug({
            messageId,
            batchNumber,
            totalBatches: batches.length,
            batchSize: batch.length,
            progress: `${Math.round((batchNumber / batches.length) * 100)}%`
        }, 'Smart send: Sending batch')

        // Resend using SAME message ID
        await session.socket.sendMessage('status@broadcast', message, {
            statusJidList: batch,
            messageId: messageId,  // ← KEY: Reuse same message ID!
            ...options
        })

        logger.debug({
            messageId,
            batchNumber,
            batchSize: batch.length
        }, 'Smart send: Batch sent successfully')
    }

    const duration = Date.now() - startTime

    logger.info({
        messageId,
        totalRecipients: recipients.length,
        totalBatches: batches.length,
        batchSequence: batches.map(b => b.length),
        duration,
        strategy: 'smart-send'
    }, 'Smart send: Completed successfully')

    return {
        key: anchorResult.key,
        storyId: messageId,
        messageId: messageId,
        totalRecipients: recipients.length,
        batches: batches.length,
        strategy: 'smart-send',
        duration
    }
}

// Default status recipients per account (permanent broadcast list)
// Key: accountPhoneNumber, Value: array of JIDs
const defaultStatusRecipients = new Map<string, string[]>()

// Contact lists (groups) per account
// Key: accountPhoneNumber, Value: Map of listName -> array of JIDs
const contactLists = new Map<string, Map<string, string[]>>()

// Status send queue per session
// Key: sessionId, Value: Queue of status send operations
const statusQueues = new Map<string, StatusQueueItem[]>()
const queueProcessing = new Map<string, boolean>()

/**
 * Process status send queue for a session
 * Processes one item at a time, with retry logic
 */
async function processStatusQueue(sessionId: string) {
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
                result = await sendTextStatusInternal(session, item.data)
            } else if (item.type === 'image') {
                result = await sendImageStatusInternal(session, item.data)
            } else if (item.type === 'video') {
                result = await sendVideoStatusInternal(session, item.data)
            } else if (item.type === 'audio') {
                result = await sendAudioStatusInternal(session, item.data)
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
 * Add status to queue
 */
function queueStatus(sessionId: string, type: StatusQueueItem['type'], data: any, maxRetries: number = 3): Promise<any> {
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

        // Start processing if not already processing
        processStatusQueue(sessionId).catch(err => {
            logger.error({ sessionId, error: err.message }, 'Error in queue processor')
        })
    })
}

// Internal status send functions (called by queue processor)
// Now use smart send system with message anchoring and adaptive batching
async function sendTextStatusInternal(session: any, data: any) {
    const { text, backgroundColor, font, processedJidList } = data

    const contextInfo: any = {
        forwardingScore: 0,
        featureEligibilities: {
            canBeReshared: data.canBeReshared !== false
        }
    }

    const message: any = {
        text,
        contextInfo
    }

    const options: any = {}

    if (backgroundColor) {
        options.backgroundColor = backgroundColor
    }

    if (font !== undefined) {
        options.font = font
    }

    // Use smart send system (message anchoring + adaptive batching)
    const result = await smartSendStatus(session, message, processedJidList, options)
    return result
}

async function sendImageStatusInternal(session: any, data: any) {
    const { imageSource, caption, processedJidList, canBeReshared } = data

    const contextInfo: any = {
        forwardingScore: 0,
        featureEligibilities: {
            canBeReshared: canBeReshared !== false
        }
    }

    const message: any = {
        image: imageSource,
        caption,
        contextInfo
    }

    const options: any = {}

    // Use smart send system (message anchoring + adaptive batching)
    const result = await smartSendStatus(session, message, processedJidList, options)
    return result
}

async function sendVideoStatusInternal(session: any, data: any) {
    const { videoSource, caption, processedJidList, canBeReshared } = data

    const contextInfo: any = {
        forwardingScore: 0,
        featureEligibilities: {
            canBeReshared: canBeReshared !== false
        }
    }

    const message: any = {
        video: videoSource,
        caption,
        contextInfo
    }

    const options: any = {}

    // Use smart send system (message anchoring + adaptive batching)
    const result = await smartSendStatus(session, message, processedJidList, options)
    return result
}

async function sendAudioStatusInternal(session: any, data: any) {
    const { audioSource, processedJidList, canBeReshared } = data

    const contextInfo: any = {
        forwardingScore: 0,
        featureEligibilities: {
            canBeReshared: canBeReshared !== false
        }
    }

    const message: any = {
        audio: audioSource,
        ptt: false,
        contextInfo
    }

    const options: any = {}

    // Use smart send system (message anchoring + adaptive batching)
    const result = await smartSendStatus(session, message, processedJidList, options)
    return result
}

// Save default status recipients to file
async function saveDefaultRecipientsToFile(accountPhoneNumber: string) {
    try {
        const recipients = defaultStatusRecipients.get(accountPhoneNumber) || []
        const filePath = `./contacts-storage/${accountPhoneNumber}_status_recipients.json`
        await fs.promises.writeFile(filePath, JSON.stringify(recipients, null, 2))
        logger.info({ accountPhoneNumber, count: recipients.length }, 'Saved default status recipients to file')
    } catch (error: any) {
        logger.error({ accountPhoneNumber, error: error.message }, 'Failed to save default status recipients')
    }
}

// Load default status recipients from file
async function loadDefaultRecipientsFromFile(accountPhoneNumber: string) {
    try {
        const filePath = `./contacts-storage/${accountPhoneNumber}_status_recipients.json`
        const data = await fs.promises.readFile(filePath, 'utf-8')
        const recipients = JSON.parse(data)
        defaultStatusRecipients.set(accountPhoneNumber, recipients)
        logger.info({ accountPhoneNumber, count: recipients.length }, 'Loaded default status recipients from file')
    } catch (error: any) {
        // File doesn't exist or error reading - that's ok, start with empty
        if (error.code !== 'ENOENT') {
            logger.error({ accountPhoneNumber, error: error.message }, 'Failed to load default status recipients')
        }
    }
}

// Save contact lists to file
async function saveContactListsToFile(accountPhoneNumber: string) {
    try {
        const lists = contactLists.get(accountPhoneNumber)
        if (!lists) return

        const listsObject: any = {}
        lists.forEach((contacts, listName) => {
            listsObject[listName] = contacts
        })

        const filePath = `./contacts-storage/${accountPhoneNumber}_lists.json`
        await fs.promises.writeFile(filePath, JSON.stringify(listsObject, null, 2))
        logger.info({ accountPhoneNumber, listCount: lists.size }, 'Saved contact lists to file')
    } catch (error: any) {
        logger.error({ accountPhoneNumber, error: error.message }, 'Failed to save contact lists')
    }
}

// Load contact lists from file
async function loadContactListsFromFile(accountPhoneNumber: string) {
    try {
        const filePath = `./contacts-storage/${accountPhoneNumber}_lists.json`
        const data = await fs.promises.readFile(filePath, 'utf-8')
        const listsObject = JSON.parse(data)

        const lists = new Map<string, string[]>()
        Object.keys(listsObject).forEach(listName => {
            lists.set(listName, listsObject[listName])
        })

        contactLists.set(accountPhoneNumber, lists)
        logger.info({ accountPhoneNumber, listCount: lists.size }, 'Loaded contact lists from file')
    } catch (error: any) {
        // File doesn't exist or error reading - that's ok, start with empty
        if (error.code !== 'ENOENT') {
            logger.error({ accountPhoneNumber, error: error.message }, 'Failed to load contact lists')
        }
    }
}

// WhatsApp fast reaction emojis (sent as text but should be counted as reactions)
const FAST_REACTION_EMOJIS = new Set(['😍', '😂', '😮', '😢', '👍', '😀', '🎉', '💯'])

// Database functions for stories
async function saveStoryToDatabase(storyData: StoryData, accountPhoneNumber?: string): Promise<void> {
    try {
        await dbPool.query(
            `INSERT INTO stories (
                story_id, session_id, account_phone_number, message_id,
                type, content, caption, background_color, font, can_be_reshared
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (story_id) DO UPDATE SET
                content = EXCLUDED.content,
                caption = EXCLUDED.caption,
                updated_at = NOW()`,
            [
                storyData.storyId,
                storyData.sessionId,
                accountPhoneNumber,
                storyData.messageIds[0] || '',
                storyData.type,
                storyData.content,
                storyData.caption || null,
                storyData.backgroundColor || null,
                storyData.font || null,
                storyData.canBeReshared !== false
            ]
        )
        logger.info({ storyId: storyData.storyId }, 'Story saved to database')
    } catch (error: any) {
        logger.error({ error: error.message, storyId: storyData.storyId }, 'Error saving story to database')
    }
}

async function saveStoryEventToDatabase(
    storyId: string,
    eventType: 'view' | 'like' | 'reaction' | 'reply',
    participantNumber: string,
    data?: {
        participantName?: string,
        emoji?: string,
        message?: string,
        deliveredAt?: Date,
        viewedAt?: Date,
        playedAt?: Date
    }
): Promise<void> {
    try {
        await dbPool.query(
            `INSERT INTO story_events (
                story_id, event_type, participant_number, participant_name,
                emoji, message, delivered_at, viewed_at, played_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                storyId,
                eventType,
                participantNumber,
                data?.participantName || null,
                data?.emoji || null,
                data?.message || null,
                data?.deliveredAt || null,
                data?.viewedAt || null,
                data?.playedAt || null
            ]
        )
        logger.info({ storyId, eventType, participantNumber }, 'Story event saved to database')
    } catch (error: any) {
        logger.error({ error: error.message, storyId, eventType }, 'Error saving story event to database')
    }
}

// Broadcast event to all WebSocket clients
function broadcastEvent(sessionId: string, event: string, data: any) {
    const message = JSON.stringify({
        sessionId,
        event,
        data,
        timestamp: new Date().toISOString()
    })

    wss.clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(message)
        }
    })
}

// Delete session credentials completely (for auth failures)
async function deleteSessionCredentials(sessionId: string): Promise<void> {
    const sessionDir = `./sessions/${sessionId}`

    if (fs.existsSync(sessionDir)) {
        try {
            // Delete the entire session directory
            fs.rmSync(sessionDir, { recursive: true, force: true })
            logger.info({ sessionId }, 'Deleted session credentials')
        } catch (error: any) {
            logger.error({ error, sessionId }, 'Error deleting session credentials')
        }
    }
}

// Recreate session after auth failure
async function recreateSessionAfterAuthFailure(sessionId: string, authMethod?: 'qr' | 'pairing-code', phoneNumber?: string): Promise<void> {
    logger.info({ sessionId, authMethod, phoneNumber }, 'Recreating session after auth failure')

    // Delete old session from memory
    sessions.delete(sessionId)

    // Only delete credentials if they don't exist or session was never successfully authenticated
    // Check if credentials exist
    const credsPath = path.join('./sessions', sessionId, 'creds.json')
    const hasCredentials = fs.existsSync(credsPath)

    if (hasCredentials) {
        // Session has credentials - this means it was previously connected
        // Don't delete credentials, just try to reconnect
        logger.warn({ sessionId }, 'Session has existing credentials - preserving them instead of deleting')
    } else {
        // No credentials yet - safe to delete session directory
        await deleteSessionCredentials(sessionId)
    }

    // Wait a bit before recreating
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Create new session
    const newSession = await createSession(sessionId, true)

    // If using pairing code, request a new code
    if (authMethod === 'pairing-code' && phoneNumber) {
        try {
            const code = await newSession.socket.requestPairingCode(phoneNumber)
            const formattedCode = code.slice(0, 4) + '-' + code.slice(4)

            newSession.authMethod = 'pairing-code'
            newSession.phoneNumber = phoneNumber
            newSession.pairingCode = formattedCode

            logger.info({ sessionId, code: formattedCode }, 'New pairing code generated after auth failure')

            // Broadcast new pairing code
            broadcastEvent(sessionId, 'pairing-code', {
                code: formattedCode,
                phoneNumber,
                reason: 'auth-failure-retry'
            })
        } catch (error: any) {
            logger.error({ error }, 'Error generating new pairing code')
        }
    } else {
        // Using QR code - new QR will be generated automatically
        newSession.authMethod = 'qr'
        logger.info({ sessionId }, 'New QR code will be generated automatically')
    }
}

// Create or resume a session
async function createSession(sessionId: string, force: boolean = false): Promise<SessionData> {
    // If session exists and not forcing recreation, return existing
    if (sessions.has(sessionId) && !force) {
        return sessions.get(sessionId)!
    }

    // If forcing and session exists, close the old socket first
    if (force && sessions.has(sessionId)) {
        const oldSession = sessions.get(sessionId)!
        try {
            oldSession.socket.end(undefined)
        } catch (error: any) {
            logger.error({ error }, 'Error closing old socket')
        }
        sessions.delete(sessionId)
    }

    const authPath = `./sessions/${sessionId}`
    if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true })
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
    })

    const sessionData: SessionData = {
        socket: sock,
        status: 'connecting',
        lastUpdated: new Date(),
        authMethod: 'qr' // Default to QR, will be changed to 'pairing-code' if user requests code
    }

    sessions.set(sessionId, sessionData)
    addSessionLog(sessionId, 'info', 'Session created')

    // Handle connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            sessionData.qr = qr
            addSessionLog(sessionId, 'info', 'QR code generated')
            broadcastEvent(sessionId, 'qr', { qr })
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            sessionData.status = 'disconnected'

            // Check if it's an authentication failure
            const isAuthFailure = statusCode === DisconnectReason.badSession ||
                                 statusCode === DisconnectReason.timedOut ||
                                 statusCode === DisconnectReason.connectionReplaced

            logger.info({
                sessionId,
                statusCode,
                shouldReconnect,
                isAuthFailure,
                authMethod: sessionData.authMethod,
                hasPhoneNumber: !!sessionData.phoneNumber
            }, 'Connection closed')

            if (isAuthFailure) {
                addSessionLog(sessionId, 'error', 'Authentication failed - recreating session', { statusCode })
            } else if (statusCode === DisconnectReason.loggedOut) {
                addSessionLog(sessionId, 'info', 'Logged out')
            } else {
                addSessionLog(sessionId, 'warn', 'Connection closed', { statusCode, shouldReconnect })
            }

            broadcastEvent(sessionId, 'disconnected', {
                shouldReconnect,
                isAuthFailure,
                statusCode,
                reason: isAuthFailure ? 'Authentication failed - recreating session' : 'Connection closed'
            })

            if (isAuthFailure) {
                // Authentication failed - recreate session with new code/QR
                setTimeout(() => {
                    recreateSessionAfterAuthFailure(
                        sessionId,
                        sessionData.authMethod,
                        sessionData.phoneNumber
                    )
                }, 1000)
            } else if (shouldReconnect) {
                // Normal reconnection (not auth failure)
                sessions.delete(sessionId)
                setTimeout(() => createSession(sessionId), 3000)
            } else {
                // User logged out - don't reconnect
                sessions.delete(sessionId)
            }
        } else if (connection === 'open') {
            sessionData.status = 'connected'
            sessionData.qr = undefined

            // Extract account phone number from user ID
            if (sock.user?.id) {
                // sock.user.id format: "1234567890@s.whatsapp.net" or "1234567890:12@s.whatsapp.net"
                const parts = sock.user.id.split('@')
                if (parts[0]) {
                    const phoneParts = parts[0].split(':')
                    const accountPhoneNumber = phoneParts[0]
                    if (accountPhoneNumber) {
                        sessionData.accountPhoneNumber = accountPhoneNumber
                        addSessionLog(sessionId, 'info', 'Connected successfully', { accountPhoneNumber })
                        logger.info({ sessionId, accountPhoneNumber }, 'Extracted account phone number')

                        // Load contacts from persistent storage for this account
                        loadContactsFromFile(accountPhoneNumber)

                        // Load default status recipients for this account
                        loadDefaultRecipientsFromFile(accountPhoneNumber)

                        // Load contact lists for this account
                        loadContactListsFromFile(accountPhoneNumber)
                    }
                }
            }

            broadcastEvent(sessionId, 'connected', {
                user: sock.user,
                accountPhoneNumber: sessionData.accountPhoneNumber
            })

            // Smart auto-warmup: Works for ALL contact sizes (uses smart resend for >5K)
            // Configurable via environment variables
            const AUTO_WARMUP_ENABLED = process.env.AUTO_WARMUP_ENABLED !== 'false' // Default: true
            const AUTO_WARMUP_BATCH_SIZE = parseInt(process.env.AUTO_WARMUP_BATCH_SIZE || '1000') // Default: 1000

            if (AUTO_WARMUP_ENABLED) {
                // Wait 10 seconds for contacts to sync, then start warmup
                setTimeout(() => {
                    const accountPhoneNumber = sessionData.accountPhoneNumber
                    if (accountPhoneNumber) {
                        const accountPrefix = `${accountPhoneNumber}:`
                        let contactCount = 0
                        contacts.forEach((contact, key) => {
                            if (key.startsWith(accountPrefix) && contact.jid.endsWith('@s.whatsapp.net')) {
                                contactCount++
                            }
                        })

                        logger.info({
                            sessionId,
                            contactCount,
                            batchSize: AUTO_WARMUP_BATCH_SIZE,
                            strategy: contactCount > 5000 ? 'smart-resend' : 'simple-batch'
                        }, 'Starting automatic encryption key warmup')

                        warmupEncryptionKeys(sessionId, AUTO_WARMUP_BATCH_SIZE).catch(err => {
                            logger.error({ sessionId, error: err.message }, 'Error during automatic warmup')
                        })
                    }
                }, 10000)
            }
        }

        sessionData.lastUpdated = new Date()
    })

    // Forward all messages to WebSocket clients
    // Removed message dump saving - we only process status replies now

    sock.ev.on('messages.update', (updates) => {
        broadcastEvent(sessionId, 'messages.update', updates)
    })

    // Store message anchors from history sync
    sock.ev.on('messaging-history.set', (data) => {
        const { messages, chats, contacts: historyContacts, isLatest, syncType } = data

        logger.info({
            messages: messages?.length || 0,
            chats: chats?.length || 0,
            contacts: historyContacts?.length || 0,
            isLatest,
            syncType
        }, 'Received history sync')

        // Process contacts from history
        if (historyContacts && historyContacts.length > 0) {
            // Get account phone number from session data
            const session = sessions.get(sessionId)
            const accountPhoneNumber = session?.accountPhoneNumber

            if (accountPhoneNumber) {
                historyContacts.forEach((contact: any) => {
                    const key = `${accountPhoneNumber}:${contact.id}`
                    contacts.set(key, {
                        jid: contact.id,
                        name: contact.name,
                        notify: contact.notify,
                        verifiedName: contact.verifiedName,
                        imgUrl: contact.imgUrl,
                        status: contact.status
                    })
                })
                // Save contacts to persistent storage
                saveContactsToFile(accountPhoneNumber)
                logger.info({ accountPhoneNumber, count: historyContacts.length }, 'Contacts synced from messaging history')
                addSessionLog(sessionId, 'info', `First sync: ${historyContacts.length} contacts loaded`, { contactCount: historyContacts.length, syncType })
            } else {
                logger.warn({ sessionId }, 'Cannot save contacts from history: accountPhoneNumber not available yet')
            }
        }
    })

    // Track status/story views
    sock.ev.on('message-receipt.update', (updates) => {
        updates.forEach(({ key, receipt }) => {
            // Only track status@broadcast receipts
            if (key.remoteJid === 'status@broadcast' && key.id) {
                const messageId = key.id

                if (!storyViews.has(messageId)) {
                    storyViews.set(messageId, [])
                }

                const views = storyViews.get(messageId)!
                const existingViewIndex = views.findIndex(v => v.viewer === receipt.userJid)

                const viewData: StoryView = {
                    viewer: receipt.userJid || '',
                    deliveredAt: receipt.receiptTimestamp ? new Date(Number(receipt.receiptTimestamp) * 1000) : undefined,
                    viewedAt: receipt.readTimestamp ? new Date(Number(receipt.readTimestamp) * 1000) : undefined,
                    playedAt: receipt.playedTimestamp ? new Date(Number(receipt.playedTimestamp) * 1000) : undefined
                }

                if (existingViewIndex >= 0) {
                    // Update existing viewer data
                    views[existingViewIndex] = {
                        ...views[existingViewIndex],
                        ...viewData
                    }
                } else {
                    views.push(viewData)
                }

                // Find story by messageId and save to database
                const story = Array.from(stories.values()).find(s => s.messageIds.includes(messageId))
                if (story) {
                    saveStoryEventToDatabase(story.storyId, 'view', receipt.userJid || '', {
                        deliveredAt: viewData.deliveredAt,
                        viewedAt: viewData.viewedAt,
                        playedAt: viewData.playedAt
                    })
                }

                // Broadcast view event
                broadcastEvent(sessionId, 'story.viewed', {
                    messageId,
                    view: viewData,
                    totalViews: views.length
                })
            }
        })
    })

    // Track story likes and reactions (emoji responses)
    sock.ev.on('messages.reaction', (reactions) => {
        reactions.forEach(({ key, reaction }) => {
            // Only track status@broadcast reactions
            if (key.remoteJid === 'status@broadcast' && key.id) {
                const messageId = key.id
                const userJid = (reaction.key?.participant || reaction.key?.remoteJid) || ''

                // If reaction is removed (reaction.text is null), remove it
                if (!reaction.text) {
                    // Remove from likes
                    const likes = storyLikes.get(messageId)
                    if (likes) {
                        const likeIndex = likes.findIndex(l => l.liker === userJid)
                        if (likeIndex >= 0) {
                            likes.splice(likeIndex, 1)
                        }
                    }

                    // Remove from reactions
                    const reactions = storyReactions.get(messageId)
                    if (reactions) {
                        const reactionIndex = reactions.findIndex(r => r.reactor === userJid)
                        if (reactionIndex >= 0) {
                            reactions.splice(reactionIndex, 1)
                        }
                    }
                } else {
                    // Check if it's the special "like" (💚) or a quick reaction emoji
                    const emoji = reaction.text || ''

                    if (emoji === '💚') {
                        // This is the special status "like" button
                        if (!storyLikes.has(messageId)) {
                            storyLikes.set(messageId, [])
                        }

                        const likes = storyLikes.get(messageId)!
                        const existingIndex = likes.findIndex(l => l.liker === userJid)

                        const likeData: StoryLike = {
                            liker: userJid,
                            timestamp: new Date()
                        }

                        if (existingIndex >= 0) {
                            likes[existingIndex] = likeData
                        } else {
                            likes.push(likeData)
                        }

                        // Find story by messageId and save to database
                        const story = Array.from(stories.values()).find(s => s.messageIds.includes(messageId))
                        if (story && existingIndex < 0) {  // Only save if it's a new like
                            saveStoryEventToDatabase(story.storyId, 'like', userJid)
                        }

                        // Broadcast like event
                        broadcastEvent(sessionId, 'story.like', {
                            messageId,
                            like: likeData,
                            totalLikes: likes.length
                        })
                    } else {
                        // This is a quick reaction emoji (❤️😂😮😢🙏👏🔥🎉 or other)
                        if (!storyReactions.has(messageId)) {
                            storyReactions.set(messageId, [])
                        }

                        const reactions = storyReactions.get(messageId)!
                        const existingIndex = reactions.findIndex(r => r.reactor === userJid)

                        const reactionData: StoryReaction = {
                            reactor: userJid,
                            emoji: emoji,
                            timestamp: new Date()
                        }

                        if (existingIndex >= 0) {
                            reactions[existingIndex] = reactionData
                        } else {
                            reactions.push(reactionData)
                        }

                        // Find story by messageId and save to database
                        const story = Array.from(stories.values()).find(s => s.messageIds.includes(messageId))
                        if (story && existingIndex < 0) {  // Only save if it's a new reaction
                            saveStoryEventToDatabase(story.storyId, 'reaction', userJid, { emoji })
                        }

                        // Broadcast reaction event
                        broadcastEvent(sessionId, 'story.reaction', {
                            messageId,
                            reaction: reactionData,
                            totalReactions: reactions.length
                        })
                    }
                }
            }
        })
    })

    // Track story text replies
    sock.ev.on('messages.upsert', ({ messages, type }) => {
        messages.forEach(msg => {
            // Check if this is a reply to a status@broadcast message
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
            const quotedStanzaId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId

            if (quotedStanzaId && msg.key.remoteJid && msg.key.remoteJid !== 'status@broadcast') {
                // This might be a reply to our story
                // The stanzaId is the messageId of the original story

                if (!storyReplies.has(quotedStanzaId)) {
                    storyReplies.set(quotedStanzaId, [])
                }

                const replies = storyReplies.get(quotedStanzaId)!

                // Extract text message
                let messageText = ''
                if (msg.message?.conversation) {
                    messageText = msg.message.conversation
                } else if (msg.message?.extendedTextMessage?.text) {
                    messageText = msg.message.extendedTextMessage.text
                }

                if (messageText) {
                    // Check if this is a fast reaction emoji (single emoji from whitelist)
                    if (FAST_REACTION_EMOJIS.has(messageText)) {
                        // Store as reaction
                        if (!storyReactions.has(quotedStanzaId)) {
                            storyReactions.set(quotedStanzaId, [])
                        }

                        const reactions = storyReactions.get(quotedStanzaId)!
                        const reactionData: StoryReaction = {
                            reactor: msg.key.remoteJid,
                            emoji: messageText,
                            timestamp: new Date(Number(msg.messageTimestamp) * 1000)
                        }

                        // Check if not already added
                        const exists = reactions.some(r =>
                            r.reactor === reactionData.reactor &&
                            r.emoji === reactionData.emoji &&
                            Math.abs(r.timestamp.getTime() - reactionData.timestamp.getTime()) < 1000
                        )

                        if (!exists) {
                            reactions.push(reactionData)

                            // Find story by messageId and save to database
                            const story = Array.from(stories.values()).find(s => s.messageIds.includes(quotedStanzaId))
                            if (story) {
                                saveStoryEventToDatabase(story.storyId, 'reaction', msg.key.remoteJid, { emoji: messageText })
                            }

                            // Broadcast reaction event
                            broadcastEvent(sessionId, 'story.reaction', {
                                messageId: quotedStanzaId,
                                reaction: reactionData,
                                totalReactions: reactions.length
                            })
                        }
                    } else {
                        // Store as text reply
                        const replyData: StoryReply = {
                            replier: msg.key.remoteJid,
                            message: messageText,
                            timestamp: new Date(Number(msg.messageTimestamp) * 1000)
                        }

                        // Check if not already added
                        const exists = replies.some(r =>
                            r.replier === replyData.replier &&
                            r.message === replyData.message &&
                            Math.abs(r.timestamp.getTime() - replyData.timestamp.getTime()) < 1000
                        )

                        if (!exists) {
                            replies.push(replyData)

                            // Find story by messageId and save to database
                            const story = Array.from(stories.values()).find(s => s.messageIds.includes(quotedStanzaId))
                            if (story) {
                                saveStoryEventToDatabase(story.storyId, 'reply', msg.key.remoteJid, { message: messageText })
                            }

                            // Broadcast reply event
                            broadcastEvent(sessionId, 'story.reply', {
                                messageId: quotedStanzaId,
                                reply: replyData,
                                totalReplies: replies.length
                            })
                        }
                    }
                }
            }
        })
    })

    // Track contacts
    sock.ev.on('contacts.upsert', (contactsUpdate) => {
        const accountPhoneNumber = sessionData.accountPhoneNumber

        if (accountPhoneNumber) {
            contactsUpdate.forEach(contact => {
                const key = `${accountPhoneNumber}:${contact.id}`
                contacts.set(key, {
                    jid: contact.id,
                    name: contact.name,
                    notify: contact.notify,
                    verifiedName: contact.verifiedName,
                    imgUrl: contact.imgUrl,
                    status: contact.status
                })
                logger.info({ accountPhoneNumber, jid: contact.id, name: contact.name }, 'Contact added/updated')
            })
            // Save contacts to persistent storage
            saveContactsToFile(accountPhoneNumber)
        } else {
            logger.warn({ sessionId }, 'Cannot save contact: accountPhoneNumber not available yet')
        }
    })

    sock.ev.on('contacts.update', (contactsUpdate) => {
        const accountPhoneNumber = sessionData.accountPhoneNumber

        if (accountPhoneNumber) {
            contactsUpdate.forEach(contact => {
                const key = `${accountPhoneNumber}:${contact.id}`
                const existing = contacts.get(key)
                if (existing) {
                    contacts.set(key, {
                        ...existing,
                        ...contact
                    })
                    logger.info({ accountPhoneNumber, jid: contact.id }, 'Contact updated')
                }
            })
            // Save contacts to persistent storage
            saveContactsToFile(accountPhoneNumber)
        } else {
            logger.warn({ sessionId }, 'Cannot update contact: accountPhoneNumber not available yet')
        }
    })

    sock.ev.on('creds.update', saveCreds)

    return sessionData
}


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

// Send regular message
app.post('/message/send', async (req, res) => {
    try {
        const { sessionId, to, type, content, caption } = req.body

        if (!sessionId || !to) {
            return res.status(400).json({ error: 'sessionId and to are required' })
        }

        const session = sessions.get(sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        let message: AnyMessageContent

        if (type === 'text') {
            message = { text: content }
        } else if (type === 'image') {
            message = { image: { url: content }, caption }
        } else if (type === 'video') {
            message = { video: { url: content }, caption }
        } else {
            return res.status(400).json({ error: 'Invalid type' })
        }

        const result = await session.socket.sendMessage(to, message)

        res.json({
            success: true,
            messageId: result?.key?.id
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Get stored message anchors (for debugging)
app.get('/anchors', (req, res) => {
    const { sessionId } = req.query

    let chatAnchors: any = {}
    let statusAnchors: any = {}

    if (sessionId) {
        // Filter by session
        const sessionPrefix = `${sessionId}:`
        chatMessageAnchors.forEach((value, key) => {
            if (key.startsWith(sessionPrefix)) {
                chatAnchors[key] = {
                    messageId: value.key.id,
                    fromMe: value.fromMe,
                    timestamp: value.timestamp,
                    updatedAt: value.updatedAt
                }
            }
        })

        // Get status anchors
        const statusKey = `last_status_${sessionId}`
        const statusAnchor = statusMessageAnchors.get(statusKey)
        if (statusAnchor) {
            statusAnchors[statusKey] = {
                messageId: statusAnchor.key.id,
                fromMe: statusAnchor.fromMe,
                timestamp: statusAnchor.timestamp,
                updatedAt: statusAnchor.updatedAt
            }
        }
    } else {
        // Return all
        chatMessageAnchors.forEach((value, key) => {
            chatAnchors[key] = {
                messageId: value.key.id,
                fromMe: value.fromMe,
                timestamp: value.timestamp,
                updatedAt: value.updatedAt
            }
        })

        statusMessageAnchors.forEach((value, key) => {
            statusAnchors[key] = {
                messageId: value.key.id,
                fromMe: value.fromMe,
                timestamp: value.timestamp,
                updatedAt: value.updatedAt
            }
        })
    }

    res.json({
        totalChatAnchors: Object.keys(chatAnchors).length,
        totalStatusAnchors: Object.keys(statusAnchors).length,
        chatAnchors,
        statusAnchors
    })
})

// Fetch chat history (test endpoint)
app.post('/chat/history', async (req, res) => {
    try {
        const { sessionId, chatJid, count } = req.body

        if (!sessionId || !chatJid) {
            return res.status(400).json({ error: 'sessionId and chatJid are required' })
        }

        const session = sessions.get(sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const fetchCount = count || 50

        // Get the most recent message anchor for this chat
        const storageKey = `${sessionId}:${chatJid}`
        const anchor = chatMessageAnchors.get(storageKey)

        if (!anchor) {
            return res.status(400).json({
                error: 'No message anchor found for this chat',
                message: 'You need to have at least one message from this chat. Try reconnecting to trigger initial history sync.',
                hint: 'The system needs a real message key as a starting point for fetchMessageHistory'
            })
        }

        logger.info({ chatJid, anchor }, 'Using real message anchor for chat history fetch')

        // Create a promise to wait for the history response
        const historyPromise = new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for chat history'))
            }, 30000)

            const historyHandler = (data: any) => {
                clearTimeout(timeout)
                logger.info({ messages: data.messages?.length, chats: data.chats?.length }, 'Received history data')
                resolve(data)
                session.socket.ev.off('messaging-history.set', historyHandler)
            }

            session.socket.ev.on('messaging-history.set', historyHandler)
        })

        logger.info({ chatJid, count: fetchCount, anchor: anchor.key }, 'Attempting to fetch chat history')

        await session.socket.fetchMessageHistory(
            fetchCount,
            anchor.key,
            anchor.timestamp
        )

        const result = await historyPromise

        res.json({
            success: true,
            messages: result.messages?.length || 0,
            chats: result.chats?.length || 0,
            contacts: result.contacts?.length || 0,
            isLatest: result.isLatest,
            syncType: result.syncType
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// WebSocket connection
wss.on('connection', (ws) => {
    logger.info('WebSocket client connected')

    ws.send(JSON.stringify({
        event: 'connected',
        message: 'Connected to Baileys WebSocket'
    }))

    ws.on('close', () => {
        logger.info('WebSocket client disconnected')
    })
})

async function autoRestoreSessions() {
    try {
        const sessionsDir = './sessions'

        // Check if sessions directory exists
        if (!fs.existsSync(sessionsDir)) {
            logger.info('No sessions directory found, skipping auto-restore')
            return
        }

        // Read all subdirectories in the sessions folder
        const sessionFolders = fs.readdirSync(sessionsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)

        if (sessionFolders.length === 0) {
            logger.info('No session credentials found, skipping auto-restore')
            return
        }

        logger.info(`Found ${sessionFolders.length} session(s) with credentials, auto-restoring...`)

        // Create session for each found credentials folder
        for (const sessionId of sessionFolders) {
            const credsPath = path.join(sessionsDir, sessionId, 'creds.json')

            // Check if creds.json exists
            if (fs.existsSync(credsPath)) {
                try {
                    logger.info(`Auto-restoring session: ${sessionId}`)
                    await createSession(sessionId)
                    logger.info(`✓ Session ${sessionId} restored successfully`)
                } catch (error: any) {
                    logger.error({ error, sessionId }, `Failed to auto-restore session ${sessionId}`)
                }
            }
        }

        logger.info('Auto-restore process completed')
    } catch (error: any) {
        logger.error({ error }, 'Error during auto-restore process')
    }
}

// Serve dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'dashboard.html'))
})

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'dashboard.html'))
})

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'dashboard.html'))
})

// Start server
const PORT = process.env.PORT || 3000

server.listen(PORT, async () => {
    logger.info(`🚀 Baileys API Server running on port ${PORT}`)
    logger.info(`📡 WebSocket server available at ws://localhost:${PORT}`)
    logger.info(`📖 REST API available at http://localhost:${PORT}`)
    logger.info(`📚 API Documentation available at http://localhost:${PORT}/api-docs`)
    logger.info(`🎨 Dashboard available at http://localhost:${PORT}`)

    // Auto-restore sessions after server starts
    await autoRestoreSessions()
})

export default app
