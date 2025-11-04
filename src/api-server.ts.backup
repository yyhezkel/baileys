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

    const options: any = {
        statusJidList: processedJidList
    }

    if (backgroundColor) {
        options.backgroundColor = backgroundColor
    }

    if (font !== undefined) {
        options.font = font
    }

    const result = await session.socket.sendMessage('status@broadcast', message, options)
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

    const options: any = {
        statusJidList: processedJidList
    }

    const result = await session.socket.sendMessage('status@broadcast', message, options)
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

    const options: any = {
        statusJidList: processedJidList
    }

    const result = await session.socket.sendMessage('status@broadcast', message, options)
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

    const options: any = {
        statusJidList: processedJidList
    }

    const result = await session.socket.sendMessage('status@broadcast', message, options)
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

// REST API Endpoints

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        sessions: sessions.size,
        timestamp: new Date().toISOString()
    })
})

// Create/resume a session
app.post('/session/create', async (req, res) => {
    try {
        const { sessionId, force } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = await createSession(sessionId, force || false)

        res.json({
            success: true,
            sessionId,
            status: session.status,
            qr: session.qr,
            forced: force || false,
            message: force ? 'Session force recreated' : 'Session created or resumed'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Request pairing code for session (alternative to QR code)
app.post('/session/:sessionId/request-code', async (req, res) => {
    try {
        const { sessionId } = req.params
        const { phoneNumber } = req.body

        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber is required' })
        }

        // Validate phone number format (should be digits only, no + or spaces)
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '')
        if (cleanPhone.length < 10) {
            return res.status(400).json({ error: 'Invalid phone number format. Use international format without + (e.g., 1234567890)' })
        }

        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        if (session.status === 'connected') {
            return res.status(400).json({ error: 'Session already connected' })
        }

        // Request pairing code
        const code = await session.socket.requestPairingCode(cleanPhone)

        // Format as XXXX-XXXX for better readability
        const formattedCode = code.slice(0, 4) + '-' + code.slice(4)

        // Store auth method and phone number for auto-recovery on failure
        session.authMethod = 'pairing-code'
        session.phoneNumber = cleanPhone
        session.pairingCode = formattedCode

        addSessionLog(sessionId, 'info', 'Pairing code requested', { phoneNumber: cleanPhone, code: formattedCode })
        logger.info({ sessionId, phoneNumber: cleanPhone, code: formattedCode }, 'Pairing code requested')

        res.json({
            success: true,
            code: formattedCode,
            phoneNumber: cleanPhone,
            message: 'Enter this code in your WhatsApp mobile app: WhatsApp > Linked Devices > Link a Device > Link with phone number instead'
        })
    } catch (error: any) {
        logger.error({ error }, 'Error requesting pairing code')
        res.status(500).json({ error: error.message })
    }
})

// Get session status
app.get('/session/:sessionId/status', (req, res) => {
    const { sessionId } = req.params
    const session = sessions.get(sessionId)

    if (!session) {
        return res.status(404).json({ error: 'Session not found' })
    }

    res.json({
        sessionId,
        status: session.status,
        qr: session.qr,
        user: session.socket.user,
        lastUpdated: session.lastUpdated
    })
})

// Get QR code for session
app.get('/session/:sessionId/qr', (req, res) => {
    const { sessionId } = req.params
    const session = sessions.get(sessionId)

    if (!session) {
        return res.status(404).json({ error: 'Session not found' })
    }

    if (!session.qr) {
        return res.status(404).json({ error: 'No QR code available. Session may already be connected.' })
    }

    res.json({
        sessionId,
        qr: session.qr
    })
})

// Get QR code as image for session
app.get('/session/:sessionId/qr-image', async (req, res) => {
    try {
        const { sessionId } = req.params
        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        if (!session.qr) {
            return res.status(404).json({ error: 'No QR code available. Session may already be connected.' })
        }

        // Generate QR code as PNG buffer
        const qrBuffer = await QRCode.toBuffer(session.qr, {
            type: 'png',
            width: 300,
            margin: 2,
            errorCorrectionLevel: 'H'
        })

        // Set headers for image response
        res.set('Content-Type', 'image/png')
        res.set('Content-Length', qrBuffer.length.toString())
        res.send(qrBuffer)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Warm up encryption keys for a session
app.post('/session/:sessionId/warmup', async (req, res) => {
    try {
        const { sessionId } = req.params
        const { batchSize, maxContacts } = req.body

        const session = sessions.get(sessionId)
        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        if (session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const finalBatchSize = batchSize || 1000

        // Get total contact count for estimation
        const accountPhoneNumber = session.accountPhoneNumber
        let totalContacts = 0
        if (accountPhoneNumber) {
            const accountPrefix = `${accountPhoneNumber}:`
            contacts.forEach((contact, key) => {
                if (key.startsWith(accountPrefix) && contact.jid.endsWith('@s.whatsapp.net')) {
                    totalContacts++
                }
            })
        }

        const contactsToWarmup = maxContacts ? Math.min(maxContacts, totalContacts) : totalContacts
        const estimatedBatches = Math.ceil(contactsToWarmup / finalBatchSize)
        const strategy = contactsToWarmup > 5000 ? 'smart-resend' : 'simple-batch'
        const statusCount = contactsToWarmup > 5000 ? 1 : estimatedBatches

        // Start warmup in background
        warmupEncryptionKeys(sessionId, finalBatchSize, maxContacts).catch(err => {
            logger.error({ sessionId, error: err.message }, 'Error during manual warmup')
        })

        res.json({
            success: true,
            message: 'Encryption key warmup started in background',
            config: {
                batchSize: finalBatchSize,
                maxContacts: maxContacts || 'all',
                strategy
            },
            estimation: {
                totalContacts,
                contactsToWarmup,
                estimatedBatches,
                statusesCreated: statusCount,
                note: strategy === 'smart-resend'
                    ? 'Using smart resend - only 1 status will be created, all views accumulate on it'
                    : 'Using simple batch - multiple statuses will be created'
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// List all sessions
app.get('/sessions', (req, res) => {
    const sessionsObject = Object.fromEntries(
        Array.from(sessions.entries()).map(([id, session]) => [
            id,
            {
                status: session.status,
                qr: session.qr,
                pairingCode: session.pairingCode,
                authMethod: session.authMethod,
                accountPhoneNumber: session.accountPhoneNumber,
                lastUpdated: session.lastUpdated
            }
        ])
    )

    res.json({ sessions: sessionsObject })
})

// Get logs for a session
app.get('/session/:sessionId/logs', (req, res) => {
    const { sessionId } = req.params
    const logs = sessionLogs.get(sessionId) || []

    res.json({
        sessionId,
        logs: logs.map(log => ({
            timestamp: log.timestamp.toISOString(),
            level: log.level,
            message: log.message,
            data: log.data
        }))
    })
})

// Delete a session
app.delete('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params
        const { logout } = req.query
        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        // If logout=true, log out from WhatsApp (deletes credentials)
        // Otherwise, just close the socket (keeps credentials for reconnection)
        if (logout === 'true') {
            try {
                await session.socket.logout()
            } catch (error: any) {
                logger.error({ error }, 'Error during logout')
            }

            // Also delete the credentials folder from disk
            const credsPath = `./sessions/${sessionId}`
            if (fs.existsSync(credsPath)) {
                try {
                    fs.rmSync(credsPath, { recursive: true, force: true })
                    logger.info({ sessionId }, 'Deleted credentials folder from disk')
                } catch (error: any) {
                    logger.error({ error, sessionId }, 'Error deleting credentials folder')
                }
            }
        } else {
            try {
                session.socket.end(undefined)
            } catch (error: any) {
                logger.error({ error }, 'Error closing socket')
            }
        }

        sessions.delete(sessionId)
        sessionLogs.delete(sessionId)

        res.json({
            success: true,
            message: logout === 'true' ? 'Session logged out and deleted' : 'Session closed (credentials preserved)',
            loggedOut: logout === 'true'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Create and send a story/status
app.post('/story/create', async (req, res) => {
    try {
        const { sessionId, type, content, caption, statusJidList, backgroundColor, font, canBeReshared, send_to_own_device, send_to_all_contacts, list } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        let message: AnyMessageContent

        // Prepare contextInfo with reshare settings
        const contextInfo: any = {
            forwardingScore: 0,
            featureEligibilities: {
                canBeReshared: canBeReshared !== false // Default to true
            }
        }

        // Prepare story message
        if (type === 'text') {
            message = {
                text: content,
                contextInfo
            }
        } else if (type === 'image') {
            message = {
                image: { url: content },
                caption: caption,
                contextInfo
            }
        } else if (type === 'video') {
            message = {
                video: { url: content },
                caption: caption,
                contextInfo
            }
        } else {
            return res.status(400).json({ error: 'Invalid type. Must be text, image, or video' })
        }

        // Process statusJidList to support plain phone numbers, send_to_own_device, and list
        const processedJidList = processStatusJidList(statusJidList, send_to_own_device, send_to_all_contacts, session.accountPhoneNumber, true, list)

        // Send to status with options
        const options: any = {
            statusJidList: processedJidList
        }

        // Add backgroundColor if provided (for text stories)
        if (backgroundColor) {
            options.backgroundColor = backgroundColor
        }

        // Add font if provided (for text stories)
        if (font !== undefined) {
            options.font = font
        }

        const result = await session.socket.sendMessage(
            'status@broadcast',
            message,
            options
        )

        // Generate unique story ID
        const storyId = `story_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        // Store story data for potential resending
        const storyData: StoryData = {
            storyId,
            sessionId,
            type,
            content,
            caption,
            backgroundColor,
            font,
            canBeReshared: canBeReshared !== false,
            messageIds: [result?.key?.id || ''],
            messageKey: result?.key, // Store for deletion
            messageTimestamp: result?.messageTimestamp ? Number(result.messageTimestamp) : Date.now(),
            sends: [{
                messageId: result?.key?.id || '',
                statusJidList: processedJidList,
                timestamp: new Date()
            }],
            createdAt: new Date()
        }

        stories.set(storyId, storyData)

        // Log status sent to session logs
        addSessionLog(sessionId, 'info', `Status sent: ${type}`, {
            storyId,
            type,
            recipients: processedJidList.length,
            hasCaption: !!caption
        })

        // Log to main server logs for persistence
        logger.info({
            sessionId,
            storyId,
            type,
            content: type === 'text' ? content?.substring(0, 50) : 'media',
            recipients: processedJidList.length
        }, `📤 NEW STATUS POSTED: ${type}`)

        // Save story to database
        const accountPhoneNumber = session.accountPhoneNumber
        if (accountPhoneNumber) {
            await saveStoryToDatabase(storyData, accountPhoneNumber)
        }

        broadcastEvent(sessionId, 'story.sent', { result, storyId })

        res.json({
            success: true,
            storyId,
            messageId: result?.key?.id,
            message: 'Story sent successfully'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Send text status
app.post('/story/text', async (req, res) => {
    try {
        const { sessionId, text, backgroundColor, font, statusJidList, canBeReshared, send_to_own_device, send_to_all_contacts, list } = req.body

        if (!sessionId || !text) {
            return res.status(400).json({ error: 'sessionId and text are required' })
        }

        const session = sessions.get(sessionId)
        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const contextInfo: any = {
            forwardingScore: 0,
            featureEligibilities: {
                canBeReshared: canBeReshared !== false
            }
        }

        const message: AnyMessageContent = {
            text,
            contextInfo
        }

        // Process statusJidList to support plain phone numbers, send_to_own_device, and list
        const processedJidList = processStatusJidList(statusJidList, send_to_own_device, send_to_all_contacts, session.accountPhoneNumber, true, list)

        const options: any = {
            statusJidList: processedJidList
        }

        if (backgroundColor) {
            options.backgroundColor = backgroundColor
        }

        if (font !== undefined) {
            options.font = font
        }

        // Queue the status send with retry mechanism
        const result = await queueStatus(sessionId, 'text', {
            text,
            backgroundColor,
            font,
            processedJidList,
            canBeReshared
        }, 3)

        res.json({
            success: true,
            storyId: result.storyId,
            messageId: result.messageId,
            message: 'Text status queued successfully'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Send image status
app.post('/story/image', async (req, res) => {
    try {
        const { sessionId, url, data, file, caption, statusJidList, canBeReshared, send_to_own_device, send_to_all_contacts, list } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!url && !data && !file) {
            return res.status(400).json({ error: 'One of url, data, or file is required' })
        }

        const session = sessions.get(sessionId)
        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const contextInfo: any = {
            forwardingScore: 0,
            featureEligibilities: {
                canBeReshared: canBeReshared !== false
            }
        }

        let imageSource: any
        if (url) {
            imageSource = { url }
        } else if (data) {
            imageSource = Buffer.from(data, 'base64')
        } else if (file) {
            imageSource = { url: file }
        }

        const message: AnyMessageContent = {
            image: imageSource,
            caption,
            contextInfo
        }

        // Process statusJidList to support plain phone numbers, send_to_own_device, and list
        const processedJidList = processStatusJidList(statusJidList, send_to_own_device, send_to_all_contacts, session.accountPhoneNumber, true, list)

        // Queue the status send with retry mechanism
        const result = await queueStatus(sessionId, 'image', {
            imageSource,
            caption,
            processedJidList,
            canBeReshared,
            content: url || file || 'base64'
        }, 3)

        res.json({
            success: true,
            storyId: result.storyId,
            messageId: result.messageId,
            message: 'Image status queued successfully'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Helper function to send a single video to WhatsApp
async function sendSingleVideoStory(session: SessionData, sessionId: string, videoSource: any, caption: string, statusJidList: string[], canBeReshared: boolean) {
    // Queue the video status send with retry mechanism
    const result = await queueStatus(sessionId, 'video', {
        videoSource,
        caption,
        processedJidList: statusJidList,
        canBeReshared,
        content: typeof videoSource === 'string' ? videoSource : (videoSource.url || 'base64')
    }, 3)

    return {
        storyId: result.storyId,
        messageId: result.messageId
    }
}

// Send video status
app.post('/story/video', async (req, res) => {
    try {
        const { sessionId, url, data, file, caption, statusJidList, canBeReshared, splitLongVideos, send_to_own_device, send_to_all_contacts, list } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!url && !data && !file) {
            return res.status(400).json({ error: 'One of url, data, or file is required' })
        }

        const session = sessions.get(sessionId)
        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        // Process statusJidList to support plain phone numbers, send_to_own_device, and list
        const processedJidList = processStatusJidList(statusJidList, send_to_own_device, send_to_all_contacts, session.accountPhoneNumber, true, list)

        // Check if we should split long videos
        if (splitLongVideos && (url || file)) {
            // Call FFmpeg service to split video
            const ffmpegServiceUrl = process.env.FFMPEG_SERVICE_URL || 'http://ffmpeg:3001'
            const FormData = (await import('form-data')).default
            const axios = (await import('axios')).default
            const fsSync = await import('fs')

            try {
                const form = new FormData()

                // Download video if URL
                let videoPath: string
                if (url) {
                    const response = await axios.get(url, { responseType: 'stream' })
                    videoPath = `/tmp/video_${Date.now()}.mp4`
                    const writer = fsSync.createWriteStream(videoPath)
                    response.data.pipe(writer)
                    await new Promise<void>((resolve, reject) => {
                        writer.on('finish', () => resolve())
                        writer.on('error', reject)
                    })
                    form.append('file', fsSync.createReadStream(videoPath))
                } else {
                    form.append('file', fsSync.createReadStream(file))
                }

                form.append('segmentDuration', '30')

                // Split video
                const splitResponse = await axios.post(`${ffmpegServiceUrl}/split/video`, form, {
                    headers: form.getHeaders(),
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                })

                // Cleanup temp file
                if (url && videoPath!) {
                    fsSync.unlinkSync(videoPath)
                }

                if (!splitResponse.data.success) {
                    throw new Error('Failed to split video')
                }

                const segments = splitResponse.data.segments

                logger.info({
                    sessionId,
                    totalSegments: segments.length,
                    totalDuration: splitResponse.data.totalDuration
                }, 'Sending video segments as stories')

                // Send each segment as a separate story
                const sentStories = []
                for (let i = 0; i < segments.length; i++) {
                    const segment = segments[i]
                    const segmentCaption = segments.length > 1
                        ? `${caption || ''} (${i + 1}/${segments.length})`
                        : caption

                    // Wait 2 seconds between segments to avoid rate limiting
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, 2000))
                    }

                    const segmentPath = segment.path.replace('/media', './Media')
                    const result = await sendSingleVideoStory(
                        session,
                        sessionId,
                        { url: `file://${segmentPath}` },
                        segmentCaption,
                        processedJidList,
                        canBeReshared !== false
                    )

                    sentStories.push({
                        ...result,
                        segmentNumber: i + 1,
                        totalSegments: segments.length
                    })
                }

                res.json({
                    success: true,
                    totalSegments: segments.length,
                    stories: sentStories,
                    message: `Video split into ${segments.length} segments and sent as stories`
                })
            } catch (error: any) {
                logger.error({ error }, 'Error splitting and sending video')
                // Fall back to sending as single video
                logger.info({ sessionId }, 'Falling back to sending as single video')

                let videoSource: any
                if (url) {
                    videoSource = { url }
                } else if (data) {
                    videoSource = Buffer.from(data, 'base64')
                } else if (file) {
                    videoSource = { url: file }
                }

                const result = await sendSingleVideoStory(
                    session,
                    sessionId,
                    videoSource,
                    caption,
                    processedJidList,
                    canBeReshared !== false
                )

                res.json({
                    success: true,
                    ...result,
                    message: 'Video sent as single story (split failed)',
                    splitError: error.message
                })
            }
        } else {
            // Send as single video
            let videoSource: any
            if (url) {
                videoSource = { url }
            } else if (data) {
                videoSource = Buffer.from(data, 'base64')
            } else if (file) {
                videoSource = { url: file }
            }

            const result = await sendSingleVideoStory(
                session,
                sessionId,
                videoSource,
                caption,
                processedJidList,
                canBeReshared !== false
            )

            res.json({
                success: true,
                ...result,
                message: 'Video status sent successfully'
            })
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Send audio status
app.post('/story/audio', async (req, res) => {
    try {
        const { sessionId, url, data, file, statusJidList, canBeReshared, send_to_own_device, send_to_all_contacts, list } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!url && !data && !file) {
            return res.status(400).json({ error: 'One of url, data, or file is required' })
        }

        const session = sessions.get(sessionId)
        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const contextInfo: any = {
            forwardingScore: 0,
            featureEligibilities: {
                canBeReshared: canBeReshared !== false
            }
        }

        let audioSource: any
        if (url) {
            audioSource = { url }
        } else if (data) {
            audioSource = Buffer.from(data, 'base64')
        } else if (file) {
            audioSource = { url: file }
        }

        const message: AnyMessageContent = {
            audio: audioSource,
            ptt: false,
            contextInfo
        }

        // Process statusJidList to support plain phone numbers, send_to_own_device, and list
        const processedJidList = processStatusJidList(statusJidList, send_to_own_device, send_to_all_contacts, session.accountPhoneNumber, true, list)

        // Queue the status send with retry mechanism
        const result = await queueStatus(sessionId, 'audio', {
            audioSource,
            processedJidList,
            canBeReshared,
            content: url || file || 'base64'
        }, 3)

        res.json({
            success: true,
            storyId: result.storyId,
            messageId: result.messageId,
            message: 'Audio status queued successfully'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Resend an existing story to different JIDs
app.post('/story/:storyId/resend', async (req, res) => {
    try {
        const { storyId } = req.params
        const { statusJidList, send_to_own_device, send_to_all_contacts, list } = req.body

        const story = stories.get(storyId)

        if (!story) {
            return res.status(404).json({ error: 'Story not found' })
        }

        const session = sessions.get(story.sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        let message: AnyMessageContent

        // Rebuild the message from stored data
        if (story.type === 'text') {
            message = {
                text: story.content
            }
        } else if (story.type === 'image') {
            message = {
                image: { url: story.content },
                caption: story.caption
            }
        } else if (story.type === 'video') {
            message = {
                video: { url: story.content },
                caption: story.caption
            }
        } else {
            return res.status(400).json({ error: 'Invalid story type' })
        }

        // Process statusJidList to support plain phone numbers, send_to_own_device, and list
        const processedJidList = processStatusJidList(statusJidList, send_to_own_device, send_to_all_contacts, session.accountPhoneNumber, true, list)

        // Prepare send options
        const options: any = {
            statusJidList: processedJidList
        }

        if (story.backgroundColor) {
            options.backgroundColor = story.backgroundColor
        }

        if (story.font !== undefined) {
            options.font = story.font
        }

        // EXPERIMENTAL: Reuse the original message ID to accumulate views
        // This attempts to send to additional recipients with the same message ID
        const originalMessageId = story.messageIds[0]
        if (originalMessageId) {
            options.messageId = originalMessageId
        }

        // Send the story with the same message ID
        const result = await session.socket.sendMessage(
            'status@broadcast',
            message,
            options
        )

        // Update story data with new send
        // Note: If messageId reuse works, result.key.id should match originalMessageId
        const sentMessageId = result?.key?.id || ''
        const usedSameId = sentMessageId === originalMessageId

        if (!usedSameId && sentMessageId) {
            story.messageIds.push(sentMessageId)
        }

        story.sends.push({
            messageId: sentMessageId,
            statusJidList: processedJidList,
            timestamp: new Date(),
            reusedMessageId: usedSameId
        })

        stories.set(storyId, story)

        broadcastEvent(story.sessionId, 'story.resent', { result, storyId })

        res.json({
            success: true,
            storyId,
            messageId: sentMessageId,
            originalMessageId: originalMessageId,
            reusedMessageId: usedSameId,
            totalSends: story.sends.length,
            message: usedSameId
                ? 'Story resent with same message ID - views should accumulate'
                : 'Story resent with new message ID - created separate story post'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Get story information
app.get('/story/:storyId', (req, res) => {
    const { storyId } = req.params
    const story = stories.get(storyId)

    if (!story) {
        return res.status(404).json({ error: 'Story not found' })
    }

    res.json({
        storyId: story.storyId,
        sessionId: story.sessionId,
        type: story.type,
        content: story.content,
        caption: story.caption,
        backgroundColor: story.backgroundColor,
        font: story.font,
        totalSends: story.sends.length,
        sends: story.sends,
        createdAt: story.createdAt
    })
})

// List all stories
app.get('/stories', async (req, res) => {
    try {
        const { sessionId } = req.query

        // If requesting specific session and Map is empty/small, try loading from database
        if (sessionId && stories.size < 10) {
            try {
                const dbResult = await dbPool.query(
                    'SELECT * FROM stories WHERE session_id = $1 ORDER BY created_at DESC LIMIT 50',
                    [sessionId]
                )

                // Populate Map with database stories
                dbResult.rows.forEach((row: any) => {
                    if (!stories.has(row.story_id)) {
                        const storyData: StoryData = {
                            storyId: row.story_id,
                            sessionId: row.session_id,
                            type: row.type,
                            content: row.content,
                            caption: row.caption,
                            backgroundColor: row.background_color,
                            font: row.font,
                            canBeReshared: row.can_be_reshared,
                            messageIds: row.message_id ? [row.message_id] : [],
                            messageKey: row.message_key,
                            messageTimestamp: row.message_timestamp,
                            sends: row.sends || [],
                            createdAt: new Date(row.created_at)
                        }
                        stories.set(row.story_id, storyData)
                    }
                })

                // Load events for the loaded stories
                await loadStoryEventsFromDatabase()
            } catch (dbError) {
                logger.error({ error: dbError }, 'Error loading stories from database')
            }
        }

        let storyList = Array.from(stories.values())

        // Filter by sessionId if provided
        if (sessionId) {
            storyList = storyList.filter(s => s.sessionId === sessionId)
        }

        res.json({
            stories: storyList.map(story => {
            // Get view data for all message IDs associated with this story
            const allViews: StoryView[] = []
            story.messageIds.forEach(messageId => {
                const views = storyViews.get(messageId) || []
                allViews.push(...views)
            })

            // Deduplicate viewers
            const uniqueViewers = new Map<string, StoryView>()
            allViews.forEach(view => {
                const existing = uniqueViewers.get(view.viewer)
                if (!existing || (view.viewedAt && (!existing.viewedAt || view.viewedAt > existing.viewedAt))) {
                    uniqueViewers.set(view.viewer, view)
                }
            })

            const views = Array.from(uniqueViewers.values())

            // Get likes (the special 💚 status like button)
            const allLikes: StoryLike[] = []
            story.messageIds.forEach(messageId => {
                const likes = storyLikes.get(messageId) || []
                allLikes.push(...likes)
            })

            // Get reactions (the 8 quick emoji reactions)
            const allReactions: StoryReaction[] = []
            story.messageIds.forEach(messageId => {
                const reactions = storyReactions.get(messageId) || []
                allReactions.push(...reactions)
            })

            // Get replies
            const allReplies: StoryReply[] = []
            story.messageIds.forEach(messageId => {
                const replies = storyReplies.get(messageId) || []
                allReplies.push(...replies)
            })

            return {
                storyId: story.storyId,
                sessionId: story.sessionId,
                type: story.type,
                content: story.content.substring(0, 100) + (story.content.length > 100 ? '...' : ''),
                totalSends: story.sends.length,
                createdAt: story.createdAt,
                // View statistics
                views: {
                    total: views.length,
                    delivered: views.filter(v => v.deliveredAt).length,
                    viewed: views.filter(v => v.viewedAt).length,
                    played: views.filter(v => v.playedAt).length,
                    dataSource: story.viewsFetchedFromHistory
                        ? 'historical+live'
                        : 'live-only',
                    viewsFetchedFromHistory: story.viewsFetchedFromHistory || false
                },
                // Like statistics (the special 💚 status like button)
                likes: {
                    total: allLikes.length
                },
                // Reaction statistics (WhatsApp fast reaction emojis)
                reactions: {
                    total: allReactions.length,
                    heartEyes: allReactions.filter(r => r.emoji === '😍').length,
                    laughs: allReactions.filter(r => r.emoji === '😂').length,
                    shocked: allReactions.filter(r => r.emoji === '😮').length,
                    sad: allReactions.filter(r => r.emoji === '😢').length,
                    thumbsUp: allReactions.filter(r => r.emoji === '👍').length,
                    grinning: allReactions.filter(r => r.emoji === '😀').length,
                    party: allReactions.filter(r => r.emoji === '🎉').length,
                    hundred: allReactions.filter(r => r.emoji === '💯').length,
                    other: allReactions.filter(r => !['😍', '😂', '😮', '😢', '👍', '😀', '🎉', '💯'].includes(r.emoji)).length
                },
                // Reply statistics
                replies: {
                    total: allReplies.length
                }
            }
        })
    })
    } catch (error: any) {
        logger.error({ error }, 'Error in GET /stories')
        res.status(500).json({ error: 'Failed to load stories' })
    }
})

// Sync stories from WhatsApp history (fetch stories from status@broadcast)
app.post('/stories/sync', async (req, res) => {
    try {
        const { sessionId, count } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const fetchCount = count || 50 // Default to last 50 stories

        // Get the most recent status message anchor for this session
        const storageKey = `last_status_${sessionId}`
        const anchor = statusMessageAnchors.get(storageKey)

        if (!anchor) {
            return res.status(400).json({
                error: 'No status message anchor found',
                message: 'You need to have at least one status message (sent or received) to fetch history. Try sending a story first or wait to receive one.',
                hint: 'The system needs a real message key as a starting point for fetchMessageHistory'
            })
        }

        logger.info({ anchor }, 'Using status message anchor for history sync')

        // Create a promise to wait for the history response
        const historyPromise = new Promise<any[]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for story history'))
            }, 30000)

            const historyHandler = (data: any) => {
                clearTimeout(timeout)
                const messages = data.messages || []

                // Filter to only status@broadcast messages from me
                const storyMessages = messages.filter((msg: any) =>
                    msg.key?.remoteJid === 'status@broadcast' &&
                    msg.key?.fromMe === true
                )

                resolve(storyMessages)
                session.socket.ev.off('messaging-history.set', historyHandler)
            }

            session.socket.ev.on('messaging-history.set', historyHandler)
        })

        // Fetch messages from status@broadcast using the real anchor message
        await session.socket.fetchMessageHistory(
            fetchCount,
            anchor.key,
            anchor.timestamp
        )

        const storyMessages = await historyPromise

        // Process and store the stories
        let syncedCount = 0
        const syncedStories: any[] = []

        for (const msg of storyMessages) {
            // Generate storyId from message ID
            const storyId = `story_synced_${msg.key.id}`

            // Check if already exists
            if (stories.has(storyId)) {
                continue
            }

            // Extract story type and content
            let type: 'text' | 'image' | 'video' = 'text'
            let content = ''
            let caption = ''

            if (msg.message?.imageMessage) {
                type = 'image'
                content = msg.message.imageMessage.url || ''
                caption = msg.message.imageMessage.caption || ''
            } else if (msg.message?.videoMessage) {
                type = 'video'
                content = msg.message.videoMessage.url || ''
                caption = msg.message.videoMessage.caption || ''
            } else if (msg.message?.extendedTextMessage) {
                type = 'text'
                content = msg.message.extendedTextMessage.text || ''
            } else if (msg.message?.conversation) {
                type = 'text'
                content = msg.message.conversation
            }

            // Create story data
            const storyData: StoryData = {
                storyId,
                sessionId,
                type,
                content,
                caption,
                messageIds: [msg.key.id],
                messageKey: msg.key,
                messageTimestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : undefined,
                viewsFetchedFromHistory: true, // Mark as fetched since we got it from history
                sends: [{
                    messageId: msg.key.id,
                    statusJidList: [],
                    timestamp: new Date(Number(msg.messageTimestamp) * 1000)
                }],
                createdAt: new Date(Number(msg.messageTimestamp) * 1000)
            }

            stories.set(storyId, storyData)

            // Store views if available
            if (msg.userReceipt && msg.userReceipt.length > 0) {
                const views: StoryView[] = msg.userReceipt.map((receipt: any) => ({
                    viewer: receipt.userJid,
                    deliveredAt: receipt.receiptTimestamp ? new Date(Number(receipt.receiptTimestamp) * 1000) : undefined,
                    viewedAt: receipt.readTimestamp ? new Date(Number(receipt.readTimestamp) * 1000) : undefined,
                    playedAt: receipt.playedTimestamp ? new Date(Number(receipt.playedTimestamp) * 1000) : undefined
                }))

                storyViews.set(msg.key.id, views)
            }

            syncedCount++
            syncedStories.push({
                storyId,
                type,
                content: content.substring(0, 100),
                views: msg.userReceipt?.length || 0,
                timestamp: new Date(Number(msg.messageTimestamp) * 1000)
            })
        }

        res.json({
            success: true,
            sessionId,
            syncedCount,
            totalFetched: storyMessages.length,
            stories: syncedStories,
            message: `Synced ${syncedCount} stories from WhatsApp`
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Get story views (from in-memory cache - only shows views captured while connected)
app.get('/story/:storyId/views', (req, res) => {
    const { storyId } = req.params
    const story = stories.get(storyId)

    if (!story) {
        return res.status(404).json({ error: 'Story not found' })
    }

    // Get views for all message IDs associated with this story
    const allViews: StoryView[] = []
    story.messageIds.forEach(messageId => {
        const views = storyViews.get(messageId) || []
        allViews.push(...views)
    })

    // Deduplicate viewers (same person might have viewed multiple sends)
    const uniqueViewers = new Map<string, StoryView>()
    allViews.forEach(view => {
        const existing = uniqueViewers.get(view.viewer)
        if (!existing || (view.viewedAt && (!existing.viewedAt || view.viewedAt > existing.viewedAt))) {
            uniqueViewers.set(view.viewer, view)
        }
    })

    const views = Array.from(uniqueViewers.values())

    // Get likes for all message IDs (the special 💚 status like button)
    const allLikes: StoryLike[] = []
    story.messageIds.forEach(messageId => {
        const likes = storyLikes.get(messageId) || []
        allLikes.push(...likes)
    })

    // Deduplicate likes
    const uniqueLikes = new Map<string, StoryLike>()
    allLikes.forEach(like => {
        const existing = uniqueLikes.get(like.liker)
        if (!existing || like.timestamp > existing.timestamp) {
            uniqueLikes.set(like.liker, like)
        }
    })

    const likes = Array.from(uniqueLikes.values())

    // Get reactions for all message IDs (the 8 quick emoji reactions)
    const allReactions: StoryReaction[] = []
    story.messageIds.forEach(messageId => {
        const reactions = storyReactions.get(messageId) || []
        allReactions.push(...reactions)
    })

    // Deduplicate reactions (same person might have reacted to multiple sends)
    const uniqueReactions = new Map<string, StoryReaction>()
    allReactions.forEach(reaction => {
        const existing = uniqueReactions.get(reaction.reactor)
        if (!existing || reaction.timestamp > existing.timestamp) {
            uniqueReactions.set(reaction.reactor, reaction)
        }
    })

    const reactions = Array.from(uniqueReactions.values())

    // Get replies for all message IDs
    const allReplies: StoryReply[] = []
    story.messageIds.forEach(messageId => {
        const replies = storyReplies.get(messageId) || []
        allReplies.push(...replies)
    })

    // Sort replies by timestamp
    const replies = allReplies.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    res.json({
        storyId,
        messageIds: story.messageIds,

        // Views
        totalViews: views.length,
        views: views,
        viewersList: views.map(v => v.viewer),
        viewsBreakdown: {
            delivered: views.filter(v => v.deliveredAt).length,
            viewed: views.filter(v => v.viewedAt).length,
            played: views.filter(v => v.playedAt).length
        },

        // Likes (the special 💚 status like button)
        totalLikes: likes.length,
        likes: likes,
        likersList: likes.map(l => l.liker),

        // Reactions (WhatsApp fast reaction emojis)
        totalReactions: reactions.length,
        reactions: reactions,
        reactionBreakdown: {
            '😍': reactions.filter(r => r.emoji === '😍').length,
            '😂': reactions.filter(r => r.emoji === '😂').length,
            '😮': reactions.filter(r => r.emoji === '😮').length,
            '😢': reactions.filter(r => r.emoji === '😢').length,
            '👍': reactions.filter(r => r.emoji === '👍').length,
            '😀': reactions.filter(r => r.emoji === '😀').length,
            '🎉': reactions.filter(r => r.emoji === '🎉').length,
            '💯': reactions.filter(r => r.emoji === '💯').length,
            other: reactions.filter(r => !['😍', '😂', '😮', '😢', '👍', '😀', '🎉', '💯'].includes(r.emoji)).length
        },

        // Text replies
        totalReplies: replies.length,
        replies: replies,

        dataSource: story.viewsFetchedFromHistory
            ? 'historical + live (merged from WhatsApp history and real-time events)'
            : 'live-only (captured while connected)',
        viewsFetchedFromHistory: story.viewsFetchedFromHistory || false,
        note: story.viewsFetchedFromHistory
            ? 'This includes views/likes/reactions/replies fetched from WhatsApp history plus any new live data. Data is complete.'
            : 'Showing only views/likes/reactions/replies captured while connected. Use POST /story/:storyId/fetch-views to get complete history from WhatsApp.'
    })
})

// Fetch story views from WhatsApp history (works even after reconnect)
app.post('/story/:storyId/fetch-views', async (req, res) => {
    try {
        const { storyId } = req.params
        const { force } = req.body // Allow forcing a re-fetch
        const story = stories.get(storyId)

        if (!story) {
            return res.status(404).json({ error: 'Story not found' })
        }

        // Check if already fetched (unless force=true)
        if (story.viewsFetchedFromHistory && !force) {
            const messageId = story.messageKey?.id
            const existingViews = storyViews.get(messageId) || []

            return res.json({
                success: true,
                storyId,
                source: 'cached (already fetched from WhatsApp)',
                totalViews: existingViews.length,
                views: existingViews,
                viewersList: existingViews.map(v => v.viewer),
                viewsBreakdown: {
                    delivered: existingViews.filter(v => v.deliveredAt).length,
                    viewed: existingViews.filter(v => v.viewedAt).length,
                    played: existingViews.filter(v => v.playedAt).length
                },
                note: 'Views already fetched from WhatsApp history and merged with live data. Use {"force": true} in request body to re-fetch.'
            })
        }

        const session = sessions.get(story.sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        if (!story.messageKey || !story.messageTimestamp) {
            return res.status(400).json({
                error: 'Story missing required data. messageKey or messageTimestamp not available.'
            })
        }

        // Create a promise to wait for the history response
        const historyPromise = new Promise<any[]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for history response'))
            }, 30000) // 30 second timeout

            // Listen for the history sync event
            const historyHandler = (data: any) => {
                clearTimeout(timeout)

                // Find our story message in the returned messages
                const messages = data.messages || []
                const storyMessage = messages.find((msg: any) =>
                    msg.key?.id === story.messageKey.id &&
                    msg.key?.remoteJid === 'status@broadcast'
                )

                if (storyMessage && storyMessage.userReceipt) {
                    resolve(storyMessage.userReceipt)
                } else if (storyMessage) {
                    // Message found but no receipts yet
                    resolve([])
                } else {
                    reject(new Error('Story message not found in history'))
                }

                // Remove the listener
                session.socket.ev.off('messaging-history.set', historyHandler)
            }

            session.socket.ev.on('messaging-history.set', historyHandler)
        })

        // Request the message history
        await session.socket.fetchMessageHistory(
            1, // Just fetch this one message
            story.messageKey,
            story.messageTimestamp
        )

        // Wait for the response
        const userReceipts: any[] = await historyPromise

        // Convert userReceipts to our StoryView format
        const fetchedViews: StoryView[] = userReceipts.map((receipt: any) => ({
            viewer: receipt.userJid,
            deliveredAt: receipt.receiptTimestamp ? new Date(Number(receipt.receiptTimestamp) * 1000) : undefined,
            viewedAt: receipt.readTimestamp ? new Date(Number(receipt.readTimestamp) * 1000) : undefined,
            playedAt: receipt.playedTimestamp ? new Date(Number(receipt.playedTimestamp) * 1000) : undefined
        }))

        // Store the fetched views in storyViews map (merge with any existing live views)
        const messageId = story.messageKey.id
        if (!storyViews.has(messageId)) {
            storyViews.set(messageId, [])
        }

        const existingViews = storyViews.get(messageId)!

        // Merge fetched views with existing views
        fetchedViews.forEach(fetchedView => {
            const existingIndex = existingViews.findIndex(v => v.viewer === fetchedView.viewer)
            if (existingIndex >= 0) {
                // Merge: keep the most recent data for each field
                const existing = existingViews[existingIndex]
                if (existing) {
                    existingViews[existingIndex] = {
                        viewer: fetchedView.viewer,
                        deliveredAt: fetchedView.deliveredAt || existing.deliveredAt,
                        viewedAt: fetchedView.viewedAt || existing.viewedAt,
                        playedAt: fetchedView.playedAt || existing.playedAt
                    }
                }
            } else {
                // New viewer from history
                existingViews.push(fetchedView)
            }
        })

        // Mark that we've fetched views from history
        story.viewsFetchedFromHistory = true
        stories.set(storyId, story)

        // Get all views after merging
        const allViews = storyViews.get(messageId)!

        res.json({
            success: true,
            storyId,
            source: 'whatsapp-history',
            totalViews: allViews.length,
            views: allViews,
            viewersList: allViews.map(v => v.viewer),
            viewsBreakdown: {
                delivered: allViews.filter(v => v.deliveredAt).length,
                viewed: allViews.filter(v => v.viewedAt).length,
                played: allViews.filter(v => v.playedAt).length
            },
            note: 'Views fetched from WhatsApp and stored locally. Future live views will be automatically merged with this data.'
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Delete a story (removes from WhatsApp)
app.delete('/story/:storyId', async (req, res) => {
    try {
        const { storyId } = req.params
        const story = stories.get(storyId)

        if (!story) {
            return res.status(404).json({ error: 'Story not found' })
        }

        const session = sessions.get(story.sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected. Cannot delete story from WhatsApp.' })
        }

        let deleted = false

        // Delete the story from WhatsApp using the message key
        if (story.messageKey) {
            logger.info({ messageKey: story.messageKey }, 'Deleting story from WhatsApp')

            try {
                const result = await session.socket.sendMessage('status@broadcast', {
                    delete: story.messageKey
                })
                logger.info({ result }, 'Delete result from WhatsApp')
                deleted = true
            } catch (deleteError: any) {
                logger.error({ error: deleteError }, 'Error deleting story from WhatsApp')
            }
        } else {
            logger.warn({ storyId }, 'No messageKey found for story')
        }

        // Remove from local storage
        stories.delete(storyId)

        // Clean up views
        story.messageIds.forEach(messageId => {
            storyViews.delete(messageId)
            storyLikes.delete(messageId)
            storyReactions.delete(messageId)
            storyReplies.delete(messageId)
        })

        res.json({
            success: true,
            message: deleted ? 'Story deleted from WhatsApp and API history' : 'Story removed from API history only (WhatsApp deletion may have failed)',
            storyId,
            deletedFromWhatsApp: deleted,
            messageKey: story.messageKey,
            note: deleted ? 'Story has been revoked from all recipients. They will no longer see it.' : 'Story removed from tracking but may still be visible on WhatsApp'
        })
    } catch (error: any) {
        logger.error({ error }, 'Error in delete story endpoint')
        res.status(500).json({ error: error.message })
    }
})

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

// Get contacts for a session
app.get('/contacts', async (req, res) => {
    try {
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        // Get all contacts for this account
        const accountContacts: any[] = []
        const accountPrefix = `${accountPhoneNumber}:`

        contacts.forEach((contact, key) => {
            if (key.startsWith(accountPrefix)) {
                accountContacts.push(contact)
            }
        })

        res.json({
            sessionId,
            accountPhoneNumber,
            totalContacts: accountContacts.length,
            contacts: accountContacts
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Add contacts manually for a session
app.post('/contacts/add', async (req, res) => {
    try {
        const { sessionId, contacts: newContacts } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!newContacts || !Array.isArray(newContacts) || newContacts.length === 0) {
            return res.status(400).json({ error: 'contacts array is required and must not be empty' })
        }

        const session = sessions.get(sessionId)

        if (!session || session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const added: any[] = []
        const updated: any[] = []
        const errors: any[] = []

        // Process each contact
        newContacts.forEach((contact: any, index: number) => {
            try {
                // Validate contact data
                if (!contact.jid && !contact.phone) {
                    errors.push({
                        index,
                        contact,
                        error: 'Either jid or phone is required'
                    })
                    return
                }

                // Convert phone to JID if needed
                let jid = contact.jid
                if (!jid && contact.phone) {
                    // Remove any non-digit characters from phone
                    const cleanPhone = contact.phone.replace(/\D/g, '')
                    jid = `${cleanPhone}@s.whatsapp.net`
                }

                // Ensure JID has proper format
                if (!jid.includes('@')) {
                    jid = `${jid}@s.whatsapp.net`
                }

                const key = `${accountPhoneNumber}:${jid}`
                const existing = contacts.get(key)

                const contactData = {
                    jid,
                    name: contact.name || contact.notify || '',
                    notify: contact.notify || contact.name || '',
                    verifiedName: contact.verifiedName || '',
                    imgUrl: contact.imgUrl || '',
                    status: contact.status || ''
                }

                contacts.set(key, contactData)

                if (existing) {
                    updated.push(contactData)
                } else {
                    added.push(contactData)
                }

                logger.info({
                    accountPhoneNumber,
                    jid,
                    name: contactData.name,
                    action: existing ? 'updated' : 'added'
                }, 'Contact manually added/updated')

            } catch (error: any) {
                errors.push({
                    index,
                    contact,
                    error: error.message
                })
            }
        })

        // Save contacts to persistent storage
        saveContactsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            added: added.length,
            updated: updated.length,
            failed: errors.length,
            addedContacts: added,
            updatedContacts: updated,
            errors: errors.length > 0 ? errors : undefined
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Get default status recipients for a session
app.get('/contacts/status-recipients', async (req, res) => {
    try {
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const recipients = defaultStatusRecipients.get(accountPhoneNumber) || []

        res.json({
            sessionId,
            accountPhoneNumber,
            totalRecipients: recipients.length,
            recipients,
            note: 'These contacts will automatically receive every status you send'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Add default status recipients
app.post('/contacts/status-recipients/add', async (req, res) => {
    try {
        const { sessionId, recipients: newRecipients } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!newRecipients || !Array.isArray(newRecipients) || newRecipients.length === 0) {
            return res.status(400).json({ error: 'recipients array is required and must not be empty' })
        }

        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        // Get existing recipients or initialize empty array
        const existingRecipients = defaultStatusRecipients.get(accountPhoneNumber) || []
        const added: string[] = []
        const skipped: string[] = []

        // Process each recipient
        newRecipients.forEach((recipient: any) => {
            let jid: string

            // Handle different input formats
            if (typeof recipient === 'string') {
                jid = recipient
            } else if (recipient.jid) {
                jid = recipient.jid
            } else if (recipient.phone) {
                const cleanPhone = recipient.phone.replace(/\D/g, '')
                jid = `${cleanPhone}@s.whatsapp.net`
            } else {
                return // Skip invalid recipients
            }

            // Ensure JID has proper format
            if (!jid.includes('@')) {
                jid = `${jid}@s.whatsapp.net`
            }

            // Add if not already in the list
            if (!existingRecipients.includes(jid)) {
                existingRecipients.push(jid)
                added.push(jid)
            } else {
                skipped.push(jid)
            }
        })

        // Update the map and save to file
        defaultStatusRecipients.set(accountPhoneNumber, existingRecipients)
        await saveDefaultRecipientsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            added: added.length,
            skipped: skipped.length,
            totalRecipients: existingRecipients.length,
            addedJids: added,
            skippedJids: skipped.length > 0 ? skipped : undefined,
            note: 'These contacts will now automatically receive every status you send'
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Remove default status recipients
app.post('/contacts/status-recipients/remove', async (req, res) => {
    try {
        const { sessionId, recipients: recipientsToRemove } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!recipientsToRemove || !Array.isArray(recipientsToRemove) || recipientsToRemove.length === 0) {
            return res.status(400).json({ error: 'recipients array is required and must not be empty' })
        }

        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const existingRecipients = defaultStatusRecipients.get(accountPhoneNumber) || []
        const removed: string[] = []
        const notFound: string[] = []

        // Process recipients to remove
        const jidsToRemove = recipientsToRemove.map((recipient: any) => {
            if (typeof recipient === 'string') {
                return recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`
            } else if (recipient.jid) {
                return recipient.jid
            } else if (recipient.phone) {
                const cleanPhone = recipient.phone.replace(/\D/g, '')
                return `${cleanPhone}@s.whatsapp.net`
            }
            return null
        }).filter((jid: any) => jid !== null)

        // Remove JIDs
        const updatedRecipients = existingRecipients.filter(jid => {
            if (jidsToRemove.includes(jid)) {
                removed.push(jid)
                return false
            }
            return true
        })

        // Check which ones were not found
        jidsToRemove.forEach((jid: string) => {
            if (!removed.includes(jid)) {
                notFound.push(jid)
            }
        })

        // Update the map and save to file
        defaultStatusRecipients.set(accountPhoneNumber, updatedRecipients)
        await saveDefaultRecipientsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            removed: removed.length,
            notFound: notFound.length,
            totalRecipients: updatedRecipients.length,
            removedJids: removed,
            notFoundJids: notFound.length > 0 ? notFound : undefined
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Clear all default status recipients
app.delete('/contacts/status-recipients', async (req, res) => {
    try {
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const previousCount = (defaultStatusRecipients.get(accountPhoneNumber) || []).length

        // Clear the list
        defaultStatusRecipients.set(accountPhoneNumber, [])
        await saveDefaultRecipientsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            cleared: previousCount,
            message: `Cleared ${previousCount} default status recipients`
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Delete/remove a contact
app.delete('/contacts/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        // Convert contactId to JID if needed
        let jid = contactId
        if (!jid.includes('@')) {
            jid = `${jid}@s.whatsapp.net`
        }

        const key = `${accountPhoneNumber}:${jid}`
        const existed = contacts.has(key)

        if (existed) {
            contacts.delete(key)
            saveContactsToFile(accountPhoneNumber)
        }

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            deleted: existed,
            jid,
            message: existed ? 'Contact deleted' : 'Contact not found (already deleted)'
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// =============================================================================
// CONTACT LISTS (GROUPS) MANAGEMENT
// =============================================================================

// Get all lists
app.get('/lists', async (req, res) => {
    try {
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const lists = contactLists.get(accountPhoneNumber) || new Map()
        const listsArray: any[] = []

        lists.forEach((contacts, listName) => {
            listsArray.push({
                name: listName,
                contacts: contacts.length
            })
        })

        res.json({
            sessionId,
            accountPhoneNumber,
            totalLists: listsArray.length,
            lists: listsArray
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Create a new list
app.post('/lists/create', async (req, res) => {
    try {
        const { sessionId, listName, contacts: initialContacts } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!listName) {
            return res.status(400).json({ error: 'listName is required' })
        }

        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        // Get or create lists map for this account
        let lists = contactLists.get(accountPhoneNumber)
        if (!lists) {
            lists = new Map()
            contactLists.set(accountPhoneNumber, lists)
        }

        // Check if list already exists
        if (lists.has(listName)) {
            return res.status(400).json({ error: 'List already exists' })
        }

        // Process initial contacts if provided
        const jids: string[] = []
        if (initialContacts && Array.isArray(initialContacts)) {
            initialContacts.forEach((contact: any) => {
                let jid: string
                if (typeof contact === 'string') {
                    jid = contact
                } else if (contact.jid) {
                    jid = contact.jid
                } else if (contact.phone) {
                    const cleanPhone = contact.phone.replace(/\D/g, '')
                    jid = `${cleanPhone}@s.whatsapp.net`
                } else {
                    return
                }

                if (!jid.includes('@')) {
                    jid = `${jid}@s.whatsapp.net`
                }

                if (!jids.includes(jid)) {
                    jids.push(jid)
                }
            })
        }

        // Create the list
        lists.set(listName, jids)
        await saveContactListsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            listName,
            contacts: jids.length,
            message: `List '${listName}' created with ${jids.length} contacts`
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Delete a list
app.delete('/lists/:listName', async (req, res) => {
    try {
        const { listName } = req.params
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const lists = contactLists.get(accountPhoneNumber)

        if (!lists || !lists.has(listName)) {
            return res.status(404).json({ error: 'List not found' })
        }

        const contactCount = lists.get(listName)!.length
        lists.delete(listName)
        await saveContactListsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            listName,
            deletedContacts: contactCount,
            message: `List '${listName}' deleted with ${contactCount} contacts`
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Get contacts in a list
app.get('/lists/:listName/contacts', async (req, res) => {
    try {
        const { listName } = req.params
        const { sessionId } = req.query

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        const session = sessions.get(sessionId as string)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const lists = contactLists.get(accountPhoneNumber)

        if (!lists || !lists.has(listName)) {
            return res.status(404).json({ error: 'List not found' })
        }

        const contactJids = lists.get(listName)!

        res.json({
            sessionId,
            accountPhoneNumber,
            listName,
            totalContacts: contactJids.length,
            contacts: contactJids
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Add contacts to a list
app.post('/lists/:listName/contacts/add', async (req, res) => {
    try {
        const { listName } = req.params
        const { sessionId, contacts: newContacts } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!newContacts || !Array.isArray(newContacts) || newContacts.length === 0) {
            return res.status(400).json({ error: 'contacts array is required and must not be empty' })
        }

        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const lists = contactLists.get(accountPhoneNumber)

        if (!lists || !lists.has(listName)) {
            return res.status(404).json({ error: 'List not found. Create it first using POST /lists/create' })
        }

        const existingContacts = lists.get(listName)!
        const added: string[] = []
        const skipped: string[] = []

        // Process new contacts
        newContacts.forEach((contact: any) => {
            let jid: string
            if (typeof contact === 'string') {
                jid = contact
            } else if (contact.jid) {
                jid = contact.jid
            } else if (contact.phone) {
                const cleanPhone = contact.phone.replace(/\D/g, '')
                jid = `${cleanPhone}@s.whatsapp.net`
            } else {
                return
            }

            if (!jid.includes('@')) {
                jid = `${jid}@s.whatsapp.net`
            }

            if (!existingContacts.includes(jid)) {
                existingContacts.push(jid)
                added.push(jid)
            } else {
                skipped.push(jid)
            }
        })

        lists.set(listName, existingContacts)
        await saveContactListsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            listName,
            added: added.length,
            skipped: skipped.length,
            totalContacts: existingContacts.length,
            addedJids: added,
            skippedJids: skipped.length > 0 ? skipped : undefined
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Remove contacts from a list
app.post('/lists/:listName/contacts/remove', async (req, res) => {
    try {
        const { listName } = req.params
        const { sessionId, contacts: contactsToRemove } = req.body

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' })
        }

        if (!contactsToRemove || !Array.isArray(contactsToRemove) || contactsToRemove.length === 0) {
            return res.status(400).json({ error: 'contacts array is required and must not be empty' })
        }

        const session = sessions.get(sessionId)

        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }

        const accountPhoneNumber = session.accountPhoneNumber

        if (!accountPhoneNumber) {
            return res.status(400).json({ error: 'Account phone number not available' })
        }

        const lists = contactLists.get(accountPhoneNumber)

        if (!lists || !lists.has(listName)) {
            return res.status(404).json({ error: 'List not found' })
        }

        const existingContacts = lists.get(listName)!
        const removed: string[] = []
        const notFound: string[] = []

        // Process contacts to remove
        const jidsToRemove = contactsToRemove.map((contact: any) => {
            if (typeof contact === 'string') {
                return contact.includes('@') ? contact : `${contact}@s.whatsapp.net`
            } else if (contact.jid) {
                return contact.jid
            } else if (contact.phone) {
                const cleanPhone = contact.phone.replace(/\D/g, '')
                return `${cleanPhone}@s.whatsapp.net`
            }
            return null
        }).filter((jid: any) => jid !== null)

        // Remove JIDs
        const updatedContacts = existingContacts.filter(jid => {
            if (jidsToRemove.includes(jid)) {
                removed.push(jid)
                return false
            }
            return true
        })

        // Check which ones were not found
        jidsToRemove.forEach((jid: string) => {
            if (!removed.includes(jid)) {
                notFound.push(jid)
            }
        })

        lists.set(listName, updatedContacts)
        await saveContactListsToFile(accountPhoneNumber)

        res.json({
            success: true,
            sessionId,
            accountPhoneNumber,
            listName,
            removed: removed.length,
            notFound: notFound.length,
            totalContacts: updatedContacts.length,
            removedJids: removed,
            notFoundJids: notFound.length > 0 ? notFound : undefined
        })

    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Auto-restore sessions from credentials on startup
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
