import fs from 'fs'
import path from 'path'
import type { SessionData } from '../api-types/index.js'
import P from 'pino'

const logger = P({ level: 'info' })

// Store active sessions
export const sessions = new Map<string, SessionData>()

/**
 * Get session by ID
 */
export function getSession(sessionId: string): SessionData | undefined {
    return sessions.get(sessionId)
}

/**
 * Get all sessions
 */
export function getAllSessions(): Map<string, SessionData> {
    return sessions
}

/**
 * Delete session from memory
 */
export function deleteSessionFromMemory(sessionId: string): void {
    sessions.delete(sessionId)
}

/**
 * Delete session credentials from filesystem
 */
export async function deleteSessionCredentials(sessionId: string): Promise<void> {
    const sessionDir = `./sessions/${sessionId}`

    if (fs.existsSync(sessionDir)) {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true })
            logger.info({ sessionId }, 'Deleted session credentials')
        } catch (error: any) {
            logger.error({ error, sessionId }, 'Error deleting session credentials')
        }
    }
}

/**
 * Check if session has credentials
 */
export function hasSessionCredentials(sessionId: string): boolean {
    const credsPath = path.join('./sessions', sessionId, 'creds.json')
    return fs.existsSync(credsPath)
}

/**
 * Get list of session folders with credentials
 */
export function getSessionFoldersWithCredentials(): string[] {
    const sessionsDir = './sessions'

    if (!fs.existsSync(sessionsDir)) {
        return []
    }

    const folders = fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)

    // Filter folders that have creds.json
    return folders.filter(folder => {
        const credsPath = path.join(sessionsDir, folder, 'creds.json')
        return fs.existsSync(credsPath)
    })
}

/**
 * Set session
 */
export function setSession(sessionId: string, sessionData: SessionData): void {
    sessions.set(sessionId, sessionData)
}

/**
 * Update session status
 */
export function updateSessionStatus(sessionId: string, status: 'connecting' | 'connected' | 'disconnected'): void {
    const session = sessions.get(sessionId)
    if (session) {
        session.status = status
        session.lastUpdated = new Date()
    }
}

/**
 * Set session QR code
 */
export function setSessionQR(sessionId: string, qr: string): void {
    const session = sessions.get(sessionId)
    if (session) {
        session.qr = qr
    }
}

/**
 * Set session pairing code
 */
export function setSessionPairingCode(sessionId: string, pairingCode: string): void {
    const session = sessions.get(sessionId)
    if (session) {
        session.pairingCode = pairingCode
    }
}

/**
 * Set session account phone number
 */
export function setSessionAccountPhoneNumber(sessionId: string, phoneNumber: string): void {
    const session = sessions.get(sessionId)
    if (session) {
        session.accountPhoneNumber = phoneNumber
    }
}

/**
 * Get session count
 */
export function getSessionCount(): number {
    return sessions.size
}

/**
 * Get connected sessions count
 */
export function getConnectedSessionsCount(): number {
    let count = 0
    sessions.forEach(session => {
        if (session.status === 'connected') {
            count++
        }
    })
    return count
}
