/**
 * Story JIDs File Storage Service
 * Stores JID lists in JSON files with automatic 24-hour cleanup
 */

import fs from 'fs'
import path from 'path'
import { logger } from '../api-utils/logger.js'

const JIDS_DIR = './story-jids'
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // Run cleanup every hour
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface StoryJidsData {
    storyId: string
    sessionId: string
    messageKey: any
    sends: Array<{
        messageId: string
        statusJidList: string[]
        timestamp: Date
    }>
    createdAt: Date
}

class StoryJidsService {
    private cleanupInterval: NodeJS.Timeout | null = null

    constructor() {
        this.initializeDirectory()
        this.startCleanupTimer()
    }

    /**
     * Initialize storage directory
     */
    private initializeDirectory(): void {
        if (!fs.existsSync(JIDS_DIR)) {
            fs.mkdirSync(JIDS_DIR, { recursive: true })
            logger.info({ directory: JIDS_DIR }, 'Story JIDs directory created')
        }
    }

    /**
     * Save story JIDs to file
     */
    saveStoryJids(data: StoryJidsData): void {
        try {
            const filePath = this.getFilePath(data.storyId)
            const fileData = {
                ...data,
                createdAt: data.createdAt.toISOString(),
                sends: data.sends.map(send => ({
                    ...send,
                    timestamp: send.timestamp.toISOString()
                }))
            }

            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8')
            logger.info({ storyId: data.storyId, filePath }, 'Story JIDs saved to file')
        } catch (error: any) {
            logger.error({ error: error.message, storyId: data.storyId }, 'Error saving story JIDs to file')
        }
    }

    /**
     * Load story JIDs from file
     */
    loadStoryJids(storyId: string): StoryJidsData | null {
        try {
            const filePath = this.getFilePath(storyId)

            if (!fs.existsSync(filePath)) {
                logger.warn({ storyId, filePath }, 'Story JIDs file not found')
                return null
            }

            const fileContent = fs.readFileSync(filePath, 'utf-8')
            const data = JSON.parse(fileContent)

            // Convert ISO strings back to Date objects
            return {
                ...data,
                createdAt: new Date(data.createdAt),
                sends: data.sends.map((send: any) => ({
                    ...send,
                    timestamp: new Date(send.timestamp)
                }))
            }
        } catch (error: any) {
            logger.error({ error: error.message, storyId }, 'Error loading story JIDs from file')
            return null
        }
    }

    /**
     * Delete story JIDs file
     */
    deleteStoryJids(storyId: string): boolean {
        try {
            const filePath = this.getFilePath(storyId)

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)
                logger.info({ storyId, filePath }, 'Story JIDs file deleted')
                return true
            }

            return false
        } catch (error: any) {
            logger.error({ error: error.message, storyId }, 'Error deleting story JIDs file')
            return false
        }
    }

    /**
     * Get file path for a story ID
     */
    private getFilePath(storyId: string): string {
        return path.join(JIDS_DIR, `${storyId}.json`)
    }

    /**
     * Start automatic cleanup timer
     */
    private startCleanupTimer(): void {
        // Run cleanup immediately
        this.cleanupOldFiles()

        // Then run every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldFiles()
        }, CLEANUP_INTERVAL_MS)

        logger.info({ intervalMs: CLEANUP_INTERVAL_MS, maxAgeMs: MAX_AGE_MS }, 'Story JIDs cleanup timer started')
    }

    /**
     * Cleanup files older than 24 hours
     */
    private cleanupOldFiles(): void {
        try {
            if (!fs.existsSync(JIDS_DIR)) {
                return
            }

            const files = fs.readdirSync(JIDS_DIR)
            const now = Date.now()
            let deletedCount = 0

            for (const file of files) {
                if (!file.endsWith('.json')) {
                    continue
                }

                const filePath = path.join(JIDS_DIR, file)
                const stats = fs.statSync(filePath)
                const fileAge = now - stats.mtimeMs

                if (fileAge > MAX_AGE_MS) {
                    try {
                        fs.unlinkSync(filePath)
                        deletedCount++
                        logger.info({ file, ageHours: Math.round(fileAge / 1000 / 60 / 60) }, 'Deleted old story JIDs file')
                    } catch (error: any) {
                        logger.error({ error: error.message, file }, 'Error deleting old story JIDs file')
                    }
                }
            }

            if (deletedCount > 0) {
                logger.info({ deletedCount, totalFiles: files.length }, 'Story JIDs cleanup completed')
            }
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error during story JIDs cleanup')
        }
    }

    /**
     * Stop cleanup timer (for graceful shutdown)
     */
    stopCleanupTimer(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
            this.cleanupInterval = null
            logger.info('Story JIDs cleanup timer stopped')
        }
    }

    /**
     * Get all story IDs with stored JIDs
     */
    getAllStoryIds(): string[] {
        try {
            if (!fs.existsSync(JIDS_DIR)) {
                return []
            }

            const files = fs.readdirSync(JIDS_DIR)
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''))
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error getting all story IDs')
            return []
        }
    }

    /**
     * Get file stats (for monitoring)
     */
    getStats(): { totalFiles: number, oldestFileAge: number | null } {
        try {
            if (!fs.existsSync(JIDS_DIR)) {
                return { totalFiles: 0, oldestFileAge: null }
            }

            const files = fs.readdirSync(JIDS_DIR).filter(f => f.endsWith('.json'))
            const now = Date.now()
            let oldestAge: number | null = null

            for (const file of files) {
                const filePath = path.join(JIDS_DIR, file)
                const stats = fs.statSync(filePath)
                const age = now - stats.mtimeMs

                if (oldestAge === null || age > oldestAge) {
                    oldestAge = age
                }
            }

            return {
                totalFiles: files.length,
                oldestFileAge: oldestAge ? Math.round(oldestAge / 1000 / 60 / 60) : null // in hours
            }
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error getting story JIDs stats')
            return { totalFiles: 0, oldestFileAge: null }
        }
    }
}

// Export singleton instance
export const storyJidsService = new StoryJidsService()
