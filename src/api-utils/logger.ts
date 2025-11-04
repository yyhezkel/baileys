import P from 'pino'
import type { SessionLog } from '../api-types/index.js'

// Main logger instance
export const logger = P({ level: 'info' })

// Store session logs in memory
const sessionLogs = new Map<string, SessionLog[]>()

/**
 * Add log entry for a specific session
 */
export function addSessionLog(sessionId: string, level: 'info' | 'warn' | 'error', message: string, data?: any): void {
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

    // Also log to main logger
    logger[level]({ sessionId, ...data }, message)
}

/**
 * Get logs for a specific session
 */
export function getSessionLogs(sessionId: string): SessionLog[] {
    return sessionLogs.get(sessionId) || []
}

/**
 * Clear logs for a specific session
 */
export function clearSessionLogs(sessionId: string): void {
    sessionLogs.delete(sessionId)
}

/**
 * Get all session logs
 */
export function getAllSessionLogs(): Map<string, SessionLog[]> {
    return sessionLogs
}
