import type { WASocket } from '../index.js'

export type SessionData = {
    socket: WASocket,
    qr?: string,
    status: 'connecting' | 'connected' | 'disconnected',
    lastUpdated: Date,
    authMethod?: 'qr' | 'pairing-code',
    phoneNumber?: string,
    pairingCode?: string,
    accountPhoneNumber?: string
}

export type SessionLog = {
    timestamp: Date,
    level: 'info' | 'warn' | 'error',
    message: string,
    data?: any
}
