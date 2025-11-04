import type { Pool } from 'pg'
import { logger } from '../api-utils/logger.js'

/**
 * Save story event to database
 */
export async function saveStoryEventToDatabase(
    dbPool: Pool,
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

/**
 * Get story events from database by story ID
 */
export async function getStoryEvents(
    dbPool: Pool,
    storyId: string
): Promise<any[]> {
    try {
        const result = await dbPool.query(
            'SELECT * FROM story_events WHERE story_id = $1 ORDER BY created_at ASC',
            [storyId]
        )
        return result.rows
    } catch (error: any) {
        logger.error({ error: error.message, storyId }, 'Error fetching story events from database')
        return []
    }
}
