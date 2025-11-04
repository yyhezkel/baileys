import { Router, type Request, type Response } from 'express'
import QRCode from 'qrcode'
import fs from 'fs'
import { logger } from '../api-utils/logger.js'

// These will be passed as dependencies when creating the router
export interface SessionRoutesDeps {
    sessions: Map<string, any>
    sessionLogs: Map<string, any[]>
    createSession: (sessionId: string, force?: boolean) => Promise<any>
    warmupEncryptionKeys: (sessionId: string, batchSize?: number, maxContacts?: number) => Promise<void>
    addSessionLog: (sessionId: string, level: string, message: string, data?: any) => void
    contacts: Map<string, any>
}

/**
 * Create session routes
 */
export function createSessionRoutes(deps: SessionRoutesDeps): Router {
    const router = Router()
    const { sessions, sessionLogs, createSession, warmupEncryptionKeys, addSessionLog, contacts } = deps

    // POST /session/create - Create a new session
    router.post('/create', async (req: Request, res: Response) => {
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

    // POST /session/:sessionId/request-code - Request pairing code for session (alternative to QR code)
    router.post('/:sessionId/request-code', async (req: Request, res: Response) => {
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

    // GET /session/:sessionId/status - Get session status
    router.get('/:sessionId/status', (req: Request, res: Response) => {
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

    // GET /session/:sessionId/qr - Get QR code for session
    router.get('/:sessionId/qr', (req: Request, res: Response) => {
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

    // GET /session/:sessionId/qr-image - Get QR code as image for session
    router.get('/:sessionId/qr-image', async (req: Request, res: Response) => {
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

    // POST /session/:sessionId/warmup - Warm up encryption keys for a session
    router.post('/:sessionId/warmup', async (req: Request, res: Response) => {
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

    // GET /sessions - List all sessions
    router.get('s', (req: Request, res: Response) => {
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

    // GET /session/:sessionId/logs - Get logs for a session
    router.get('/:sessionId/logs', (req: Request, res: Response) => {
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

    // DELETE /session/:sessionId - Delete a session
    router.delete('/:sessionId', async (req: Request, res: Response) => {
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

    return router
}
