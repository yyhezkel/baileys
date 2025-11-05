/**
 * SMART ADAPTIVE BATCH SEND SYSTEM
 *
 * Add this to src/api-server.ts after the warmupEncryptionKeys function
 */

/**
 * Calculate adaptive batch size based on total recipients
 */
function calculateAdaptiveBatchSize(totalRecipients: number): number {
    if (totalRecipients < 500) return 100
    if (totalRecipients < 2000) return 500
    if (totalRecipients < 5000) return 1000
    if (totalRecipients < 10000) return 2000
    if (totalRecipients < 20000) return 5000
    return 10000  // Maximum for enterprise scale
}

/**
 * Smart send status using message anchoring and adaptive batching
 *
 * Process:
 * 1. Send to ONE contact (anchor) to get message ID
 * 2. Resend same message ID to remaining contacts in adaptive batches
 *
 * @param session - WhatsApp session
 * @param message - Message content (text, image, video, etc.)
 * @param recipients - Array of JIDs
 * @param options - Additional send options
 * @returns Send result with metrics
 */
async function smartSendStatus(
    session: any,
    message: any,
    recipients: string[],
    options: any = {}
): Promise<{
    success: boolean
    messageId?: string
    storyId?: string
    totalRecipients: number
    sentSuccessfully: number
    failed: number
    batches: {
        total: number
        successful: number
        failed: number
    }
    failedRecipients: string[]
    duration: number
    strategy: 'smart-send' | 'direct-send'
}> {
    const startTime = Date.now()

    // If too few recipients, use direct send
    const minRecipientsForSmartSend = parseInt(process.env.SMART_SEND_MIN_RECIPIENTS || '100')
    if (recipients.length < minRecipientsForSmartSend) {
        logger.info({
            recipients: recipients.length,
            threshold: minRecipientsForSmartSend
        }, 'Using direct send (below smart send threshold)')

        try {
            const result = await session.socket.sendMessage('status@broadcast', message, {
                statusJidList: recipients,
                ...options
            })

            return {
                success: true,
                messageId: result.key?.id,
                storyId: result.key?.id,
                totalRecipients: recipients.length,
                sentSuccessfully: recipients.length,
                failed: 0,
                batches: { total: 1, successful: 1, failed: 0 },
                failedRecipients: [],
                duration: Date.now() - startTime,
                strategy: 'direct-send'
            }
        } catch (error: any) {
            logger.error({ error: error.message }, 'Direct send failed')
            return {
                success: false,
                totalRecipients: recipients.length,
                sentSuccessfully: 0,
                failed: recipients.length,
                batches: { total: 1, successful: 0, failed: 1 },
                failedRecipients: recipients,
                duration: Date.now() - startTime,
                strategy: 'direct-send'
            }
        }
    }

    // SMART SEND: Step 1 - Send to anchor contact to get message ID
    const anchorContact = recipients[0]!
    logger.info({
        totalRecipients: recipients.length,
        anchorContact
    }, 'Starting smart send - sending to anchor contact')

    let anchorResult: any
    try {
        anchorResult = await session.socket.sendMessage('status@broadcast', message, {
            statusJidList: [anchorContact],
            ...options
        })
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to send to anchor contact')
        return {
            success: false,
            totalRecipients: recipients.length,
            sentSuccessfully: 0,
            failed: recipients.length,
            batches: { total: 0, successful: 0, failed: 0 },
            failedRecipients: recipients,
            duration: Date.now() - startTime,
            strategy: 'smart-send'
        }
    }

    const messageId = anchorResult.key?.id
    if (!messageId) {
        logger.error('Failed to get message ID from anchor send')
        return {
            success: false,
            totalRecipients: recipients.length,
            sentSuccessfully: 0,
            failed: recipients.length,
            batches: { total: 0, successful: 0, failed: 0 },
            failedRecipients: recipients,
            duration: Date.now() - startTime,
            strategy: 'smart-send'
        }
    }

    logger.info({ messageId }, 'Anchor message sent successfully')

    // SMART SEND: Step 2 - Calculate adaptive batch size
    const remainingRecipients = recipients.slice(1)
    const batchSize = calculateAdaptiveBatchSize(recipients.length)

    logger.info({
        totalRecipients: recipients.length,
        remainingRecipients: remainingRecipients.length,
        batchSize
    }, 'Calculated adaptive batch size')

    // SMART SEND: Step 3 - Create batches
    const batches: string[][] = []
    for (let i = 0; i < remainingRecipients.length; i += batchSize) {
        batches.push(remainingRecipients.slice(i, i + batchSize))
    }

    logger.info({
        messageId,
        totalBatches: batches.length,
        batchSize,
        recipients: remainingRecipients.length
    }, 'Starting batch resend')

    // SMART SEND: Step 4 - Send batches with same message ID
    let successfulBatches = 0
    let failedBatches = 0
    const failedRecipients: string[] = []
    let sentSuccessfully = 1  // Start with anchor contact

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]!
        const batchNumber = i + 1

        logger.info({
            messageId,
            batchNumber,
            totalBatches: batches.length,
            batchSize: batch.length,
            progress: `${Math.round((batchNumber / batches.length) * 100)}%`
        }, 'Sending batch')

        try {
            // Resend using SAME message ID
            await session.socket.sendMessage('status@broadcast', message, {
                statusJidList: batch,
                messageId: messageId,  // ← KEY: Reuse same message ID!
                ...options
            })

            successfulBatches++
            sentSuccessfully += batch.length

            logger.info({
                messageId,
                batchNumber,
                batchSize: batch.length,
                totalSent: sentSuccessfully,
                totalRecipients: recipients.length
            }, 'Batch sent successfully')

        } catch (error: any) {
            failedBatches++
            failedRecipients.push(...batch)

            logger.error({
                messageId,
                batchNumber,
                batchSize: batch.length,
                error: error.message
            }, 'Batch send failed')

            // Continue with next batch even if one fails
        }

        // Optional: Add delay between batches (default: 0 for max speed)
        const delayMs = parseInt(process.env.SMART_SEND_BATCH_DELAY || '0')
        if (delayMs > 0 && i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs))
        }
    }

    const duration = Date.now() - startTime
    const success = successfulBatches > 0  // At least one batch succeeded

    logger.info({
        messageId,
        totalRecipients: recipients.length,
        sentSuccessfully,
        failed: failedRecipients.length,
        successfulBatches,
        failedBatches,
        totalBatches: batches.length,
        duration,
        successRate: `${Math.round((sentSuccessfully / recipients.length) * 100)}%`
    }, 'Smart send completed')

    return {
        success,
        messageId,
        storyId: messageId,
        totalRecipients: recipients.length,
        sentSuccessfully,
        failed: failedRecipients.length,
        batches: {
            total: batches.length,
            successful: successfulBatches,
            failed: failedBatches
        },
        failedRecipients,
        duration,
        strategy: 'smart-send'
    }
}

/**
 * Enhanced internal status send function with smart send support
 * This replaces the existing sendTextStatusInternal, sendImageStatusInternal, etc.
 */
async function sendStatusInternalWithSmartSend(
    session: any,
    type: 'text' | 'image' | 'video' | 'audio',
    data: any
): Promise<any> {
    const { processedJidList, canBeReshared } = data

    // Build message based on type
    let message: any = {}
    const options: any = {}

    const contextInfo: any = {
        forwardingScore: 0,
        featureEligibilities: {
            canBeReshared: canBeReshared !== false
        }
    }

    if (type === 'text') {
        const { text, backgroundColor, font } = data
        message = { text, contextInfo }
        if (backgroundColor) options.backgroundColor = backgroundColor
        if (font !== undefined) options.font = font

    } else if (type === 'image') {
        const { imageSource, caption } = data
        message = {
            image: imageSource,
            caption,
            contextInfo
        }

    } else if (type === 'video') {
        const { videoSource, caption } = data
        message = {
            video: videoSource,
            caption,
            contextInfo
        }

    } else if (type === 'audio') {
        const { audioSource } = data
        message = {
            audio: audioSource,
            ptt: false,
            contextInfo
        }
    }

    // Use smart send if enabled
    const useSmartSend = process.env.SMART_SEND_ENABLED !== 'false'  // Default: true

    if (useSmartSend && processedJidList.length >= 100) {
        logger.info({
            type,
            recipients: processedJidList.length
        }, 'Using smart send for status')

        return await smartSendStatus(session, message, processedJidList, options)

    } else {
        // Traditional single send
        logger.info({
            type,
            recipients: processedJidList.length
        }, 'Using traditional send for status')

        options.statusJidList = processedJidList

        const result = await session.socket.sendMessage('status@broadcast', message, options)

        return {
            success: true,
            messageId: result.key?.id,
            storyId: result.key?.id,
            totalRecipients: processedJidList.length,
            sentSuccessfully: processedJidList.length,
            failed: 0,
            batches: { total: 1, successful: 1, failed: 0 },
            failedRecipients: [],
            strategy: 'direct-send'
        }
    }
}

/**
 * INTEGRATION INSTRUCTIONS:
 *
 * 1. Add these functions to src/api-server.ts after warmupEncryptionKeys()
 *
 * 2. Replace the calls in processStatusQueue:
 *
 *    OLD:
 *    if (item.type === 'text') {
 *        result = await sendTextStatusInternal(session, item.data)
 *    }
 *
 *    NEW:
 *    if (item.type === 'text') {
 *        result = await sendStatusInternalWithSmartSend(session, 'text', item.data)
 *    }
 *
 * 3. Add to .env:
 *    SMART_SEND_ENABLED=true
 *    SMART_SEND_MIN_RECIPIENTS=100
 *    SMART_SEND_BATCH_DELAY=0
 *
 * 4. Test with various list sizes:
 *    - 50 recipients (should use direct send)
 *    - 500 recipients (batch size: 100)
 *    - 3,000 recipients (batch size: 1,000)
 *    - 15,000 recipients (batch size: 5,000)
 */

/**
 * EXAMPLE USAGE IN API ROUTE:
 */
/*
router.post('/story/text', async (req, res) => {
    const { sessionId, text, backgroundColor, font, statusJidList, ... } = req.body

    const session = sessions.get(sessionId)
    const processedJidList = processStatusJidList(...)

    // Queue with smart send support
    const result = await queueStatus(sessionId, 'text', {
        text,
        backgroundColor,
        font,
        processedJidList,
        canBeReshared: true
    }, 3)

    // Result now includes smart send metrics
    res.json({
        success: result.success,
        messageId: result.messageId,
        storyId: result.storyId,
        recipients: {
            total: result.totalRecipients,
            sent: result.sentSuccessfully,
            failed: result.failed
        },
        batches: result.batches,
        strategy: result.strategy,  // 'smart-send' or 'direct-send'
        duration: result.duration
    })
})
*/

/**
 * MONITORING & ANALYTICS:
 */
/*
// Track smart send metrics
const smartSendMetrics = {
    totalSends: 0,
    smartSendsUsed: 0,
    directSendsUsed: 0,
    averageBatchSize: 0,
    averageSuccessRate: 0,
    totalRecipients: 0,
    totalBatches: 0
}

// Log after each send
function trackSmartSendMetrics(result: any) {
    smartSendMetrics.totalSends++

    if (result.strategy === 'smart-send') {
        smartSendMetrics.smartSendsUsed++
    } else {
        smartSendMetrics.directSendsUsed++
    }

    smartSendMetrics.totalRecipients += result.totalRecipients
    smartSendMetrics.totalBatches += result.batches.total

    const successRate = (result.sentSuccessfully / result.totalRecipients) * 100
    smartSendMetrics.averageSuccessRate =
        (smartSendMetrics.averageSuccessRate * (smartSendMetrics.totalSends - 1) + successRate)
        / smartSendMetrics.totalSends

    logger.info(smartSendMetrics, 'Smart send metrics updated')
}
*/
