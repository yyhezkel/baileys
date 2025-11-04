export const PORT = process.env.PORT || 3000

export const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'baileys',
    user: process.env.DB_USER || 'baileys',
    password: process.env.DB_PASSWORD || 'baileys_password',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
}

export const AUTO_WARMUP_ENABLED = process.env.AUTO_WARMUP_ENABLED !== 'false'
export const AUTO_WARMUP_BATCH_SIZE = parseInt(process.env.AUTO_WARMUP_BATCH_SIZE || '1000')

export const FFMPEG_SERVICE_URL = process.env.FFMPEG_SERVICE_URL || 'http://ffmpeg:3001'

export const SESSIONS_DIR = './sessions'
