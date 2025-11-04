import type { Pool } from 'pg'
import type { StoryData } from '../api-types/index.js'
import { logger } from '../api-utils/logger.js'

/**
 * Save story to database
 */
export async function saveStoryToDatabase(
    dbPool: Pool,
    storyData: StoryData,
    accountPhoneNumber?: string
): Promise<void> {
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

/**
 * Get stories from database by session ID
 */
export async function getStoriesBySessionId(
    dbPool: Pool,
    sessionId: string,
    limit: number = 50
): Promise<any[]> {
    try {
        const result = await dbPool.query(
            'SELECT * FROM stories WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
            [sessionId, limit]
        )
        return result.rows
    } catch (error: any) {
        logger.error({ error: error.message, sessionId }, 'Error fetching stories from database')
        return []
    }
}

/**
 * Convert database row to StoryData
 */
export function dbRowToStoryData(row: any): StoryData {
    return {
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
        createdAt: new Date(row.created_at),
        viewsFetchedFromHistory: row.views_fetched_from_history
    }
}
