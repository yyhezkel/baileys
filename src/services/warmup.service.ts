import type { WASocket } from '../index.js'
import { logger } from '../api-utils/logger.js'
import { isIndividualJid } from '../api-utils/jid.utils.js'

/**
 * Smart warmup: Send ONE status, then resend to all contacts in batches
 * This creates only 1 status (not hundreds), and all views accumulate on it
 *
 * Strategy:
 * 1. Send to 1 contact first (get message ID)
 * 2. Resend to remaining contacts - batches of batchSize
 * 3. No delays - just batch after batch for speed
 *
 * @param sessionId - Session identifier
 * @param socket - WhatsApp socket instance
 * @param accountPhoneNumber - Account phone number
 * @param contacts - Contacts map
 * @param batchSize - Number of contacts per batch (default: 1000)
 * @param maxContacts - Maximum contacts to warmup (undefined = all)
 */
export async function warmupEncryptionKeys(
    sessionId: string,
    socket: WASocket,
    accountPhoneNumber: string,
    contacts: Map<string, any>,
    batchSize: number = 1000,
    maxContacts?: number
): Promise<void> {
    // 🔍 CHECK: Is warmup disabled via environment variable?
    const WARMUP_DISABLED = process.env.AUTO_WARMUP_ENABLED === 'false'

    // 🔍 LOG: WARMUP CALLED - Track every warmup invocation
    logger.warn({
        sessionId,
        accountPhoneNumber,
        batchSize,
        maxContacts,
        warmupDisabled: WARMUP_DISABLED,
        envVar: process.env.AUTO_WARMUP_ENABLED,
        timestamp: new Date().toISOString(),
        caller: 'warmupEncryptionKeys'
    }, WARMUP_DISABLED
        ? '⚠️ WARMUP CALLED BUT DISABLED - Returning immediately without sending statuses'
        : '🚨 WARMUP FUNCTION CALLED - Starting encryption key warmup')

    // If warmup is disabled, return immediately without doing anything
    if (WARMUP_DISABLED) {
        logger.info({
            sessionId,
            reason: 'AUTO_WARMUP_ENABLED=false',
            timestamp: new Date().toISOString()
        }, '✅ WARMUP SKIPPED - No statuses sent (warmup disabled)')
        return
    }

    try {
        // Get all individual contacts
        const allContacts: string[] = []
        const accountPrefix = `${accountPhoneNumber}:`
        contacts.forEach((contact, key) => {
            if (key.startsWith(accountPrefix) && isIndividualJid(contact.jid)) {
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
            await warmupWithSmartResend(sessionId, socket, contactsToWarmup, batchSize)
        } else {
            await warmupWithSimpleBatch(sessionId, socket, contactsToWarmup, batchSize)
        }
    } catch (error: any) {
        logger.error({ sessionId, error: error.message }, 'Error in warmup process')
        throw error
    }
}

/**
 * Smart resend warmup strategy for large contact lists (>5000)
 */
async function warmupWithSmartResend(
    sessionId: string,
    socket: WASocket,
    contactsToWarmup: string[],
    batchSize: number
): Promise<void> {
    logger.info({
        sessionId,
        totalContacts: contactsToWarmup.length,
        strategy: 'smart-resend'
    }, 'Using smart resend strategy for large contact list')

    // Step 1: Send to first contact to get message ID
    const firstContact = contactsToWarmup[0]!
    logger.info({ sessionId, firstContact }, 'Sending initial status to first contact')

    // 🔍 LOG: OUTGOING STATUS - Initial warmup status
    logger.warn({
        sessionId,
        type: 'OUTGOING_STATUS',
        source: 'warmup-smart-resend-initial',
        recipient: firstContact,
        recipientCount: 1,
        message: '.',
        timestamp: new Date().toISOString()
    }, '📤 SENDING STATUS: Warmup initial message to first contact')

    const initialResult = await socket.sendMessage('status@broadcast', {
        text: '.'
    }, {
        statusJidList: [firstContact]
    })

    const messageId = initialResult?.key?.id
    if (!messageId) {
        logger.error({ sessionId }, 'Failed to get message ID from initial send')
        throw new Error('Failed to get message ID from initial send')
    }

    logger.info({ sessionId, messageId }, 'Initial status sent, starting resend to remaining contacts')

    // Step 2: Get remaining contacts
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
            // 🔍 LOG: OUTGOING STATUS - Batch resend
            logger.warn({
                sessionId,
                type: 'OUTGOING_STATUS',
                source: 'warmup-smart-resend-batch',
                batchNumber: i + 1,
                batchSize: batch.length,
                totalBatches: batches.length,
                messageId,
                message: '.',
                timestamp: new Date().toISOString()
            }, `📤 SENDING STATUS: Warmup batch ${i + 1}/${batches.length} (${batch.length} contacts)`)

            // Resend using the SAME message ID
            await socket.sendMessage('status@broadcast', {
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
}

/**
 * Simple batch warmup strategy for smaller contact lists (<5000)
 */
async function warmupWithSimpleBatch(
    sessionId: string,
    socket: WASocket,
    contactsToWarmup: string[],
    batchSize: number
): Promise<void> {
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
            // 🔍 LOG: OUTGOING STATUS - Simple batch
            logger.warn({
                sessionId,
                type: 'OUTGOING_STATUS',
                source: 'warmup-simple-batch',
                batchNumber: i + 1,
                batchSize: batch.length,
                totalBatches: batches.length,
                message: '.',
                timestamp: new Date().toISOString()
            }, `📤 SENDING STATUS: Warmup batch ${i + 1}/${batches.length} (${batch.length} contacts)`)

            await socket.sendMessage('status@broadcast', {
                text: '.'
            }, {
                statusJidList: batch
            })
        } catch (error: any) {
            logger.error({ sessionId, batchNumber: i + 1, error: error.message }, 'Error sending warmup batch')
            // Continue with next batch even if one fails
        }
    }

    logger.info({
        sessionId,
        totalContacts: contactsToWarmup.length,
        batchCount: batches.length
    }, 'Simple batch warmup completed')
}
