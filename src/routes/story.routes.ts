import { Router, type Request, type Response } from 'express'
import { logger } from '../api-utils/logger.js'
import type { StoryData, StoryView, StoryLike, StoryReaction, StoryReply, SessionData, AnyMessageContent } from '../api-types/index.js'

// Dependencies interface
export interface StoryRoutesDeps {
    sessions: Map<string, SessionData>
    stories: Map<string, StoryData>
    storyViews: Map<string, StoryView[]>
    storyLikes: Map<string, StoryLike[]>
    storyReactions: Map<string, StoryReaction[]>
    storyReplies: Map<string, StoryReply[]>
    statusMessageAnchors: Map<string, any>
    dbPool: any
    processStatusJidList: (statusJidList: any, send_to_own_device: any, send_to_all_contacts: any, accountPhoneNumber: any, includeOwnDevice: boolean, list?: any) => string[]
    queueStatus: (sessionId: string, type: any, data: any, maxRetries: number) => Promise<any>
    saveStoryToDatabase: (storyData: StoryData, accountPhoneNumber?: string) => Promise<void>
    broadcastEvent: (sessionId: string, event: string, data: any) => void
    loadStoryEventsFromDatabase: (storyId?: string) => Promise<void>
    addSessionLog: (sessionId: string, level: string, message: string, data?: any) => void
}

/**
 * Create story routes
 */
export function createStoryRoutes(deps: StoryRoutesDeps): Router {
    const router = Router()
    const {
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
    } = deps

    // Helper function to send a single video story
    async function sendSingleVideoStory(session: SessionData, sessionId: string, videoSource: any, caption: string, statusJidList: string[], canBeReshared: boolean) {
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

    // POST /story/create - Create and send a story/status
    router.post('/create', async (req: Request, res: Response) => {
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
                messageKey: result?.key,
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

    // POST /story/text - Send text status
    router.post('/text', async (req: Request, res: Response) => {
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

    // POST /story/image - Send image status
    router.post('/image', async (req: Request, res: Response) => {
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

    // POST /story/video - Send video status
    router.post('/video', async (req: Request, res: Response) => {
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

    // POST /story/audio - Send audio status
    router.post('/audio', async (req: Request, res: Response) => {
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

    // POST /story/:storyId/resend - Resend an existing story to different JIDs
    router.post('/:storyId/resend', async (req: Request, res: Response) => {
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

    // GET /story/:storyId - Get story information
    router.get('/:storyId', (req: Request, res: Response) => {
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

    // GET /stories - List all stories
    router.get('s', async (req: Request, res: Response) => {
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

    // POST /stories/sync - Sync stories from WhatsApp history
    router.post('s/sync', async (req: Request, res: Response) => {
        try {
            const { sessionId, count } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            const session = sessions.get(sessionId)

            if (!session || session.status !== 'connected') {
                return res.status(400).json({ error: 'Session not connected' })
            }

            const fetchCount = count || 50

            // Get the most recent status message anchor for this session
            const storageKey = `last_status_${sessionId}`
            const anchor = statusMessageAnchors.get(storageKey)

            if (!anchor) {
                return res.status(400).json({
                    error: 'No status anchor found. Wait for history sync to complete after connection.',
                    note: 'Status anchors are automatically saved during the initial history sync. If you just connected, wait a few seconds.'
                })
            }

            logger.info({ sessionId, fetchCount, anchor }, 'Fetching status history')

            // Fetch status history
            const history = await session.socket.fetchMessageHistory(
                fetchCount,
                anchor.key,
                anchor.messageTimestamp
            )

            res.json({
                success: true,
                message: 'Status history sync initiated. Listen to WebSocket for results.',
                count: fetchCount
            })
        } catch (error: any) {
            logger.error({ error }, 'Error syncing stories')
            res.status(500).json({ error: error.message })
        }
    })

    // GET /story/:storyId/views - Get story views
    router.get('/:storyId/views', (req: Request, res: Response) => {
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

        // Deduplicate viewers
        const uniqueViewers = new Map<string, StoryView>()
        allViews.forEach(view => {
            const existing = uniqueViewers.get(view.viewer)
            if (!existing || (view.viewedAt && (!existing.viewedAt || view.viewedAt > existing.viewedAt))) {
                uniqueViewers.set(view.viewer, view)
            }
        })

        const views = Array.from(uniqueViewers.values())

        // Get likes for all message IDs
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

        // Get reactions for all message IDs
        const allReactions: StoryReaction[] = []
        story.messageIds.forEach(messageId => {
            const reactions = storyReactions.get(messageId) || []
            allReactions.push(...reactions)
        })

        // Deduplicate reactions
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

            // Likes
            totalLikes: likes.length,
            likes: likes,
            likersList: likes.map(l => l.liker),

            // Reactions
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

    // POST /story/:storyId/fetch-views - Fetch story views from WhatsApp history
    router.post('/:storyId/fetch-views', async (req: Request, res: Response) => {
        try {
            const { storyId } = req.params
            const { force } = req.body
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
                }, 30000)

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
                1,
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

    // DELETE /story/:storyId - Delete a story
    router.delete('/:storyId', async (req: Request, res: Response) => {
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
                } catch (error: any) {
                    logger.error({ error }, 'Error deleting story from WhatsApp')
                }
            }

            // Remove from local storage
            stories.delete(storyId)

            // Remove views/likes/reactions/replies
            story.messageIds.forEach(messageId => {
                storyViews.delete(messageId)
                storyLikes.delete(messageId)
                storyReactions.delete(messageId)
                storyReplies.delete(messageId)
            })

            res.json({
                success: true,
                message: deleted
                    ? 'Story deleted from WhatsApp and local storage'
                    : 'Story removed from local storage (WhatsApp deletion may have failed)',
                deletedFromWhatsApp: deleted
            })
        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    return router
}
