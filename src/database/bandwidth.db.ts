import type { Pool } from 'pg'
import { logger } from '../api-utils/logger.js'
import type { BandwidthMetric, EndpointMinuteStats } from '../services/bandwidth.service.js'

/**
 * Save bandwidth minute data to database
 */
export async function saveBandwidthMinuteToDatabase(
    dbPool: Pool,
    metric: BandwidthMetric
): Promise<void> {
    const client = await dbPool.connect()
    try {
        await client.query('BEGIN')

        // Insert or update the minute record
        await client.query(
            `INSERT INTO bandwidth_minutes (minute_timestamp, total_bytes, total_kb, request_count)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (minute_timestamp)
             DO UPDATE SET
                total_bytes = EXCLUDED.total_bytes,
                total_kb = EXCLUDED.total_kb,
                request_count = EXCLUDED.request_count`,
            [metric.timestamp, metric.bytes, metric.kb, metric.endpoints?.length || 0]
        )

        // Insert endpoint breakdown if available
        if (metric.endpoints && metric.endpoints.length > 0) {
            for (const endpoint of metric.endpoints) {
                await client.query(
                    `INSERT INTO bandwidth_endpoints (minute_timestamp, endpoint, bytes, kb, request_count)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (minute_timestamp, endpoint)
                     DO UPDATE SET
                        bytes = EXCLUDED.bytes,
                        kb = EXCLUDED.kb,
                        request_count = EXCLUDED.request_count`,
                    [metric.timestamp, endpoint.endpoint, endpoint.bytes, endpoint.kb, endpoint.requestCount]
                )
            }
        }

        await client.query('COMMIT')
        logger.info({ timestamp: metric.timestamp, bytes: metric.bytes }, 'Bandwidth minute saved to database')
    } catch (error: any) {
        await client.query('ROLLBACK')
        logger.error({ error: error.message, timestamp: metric.timestamp }, 'Error saving bandwidth minute to database')
    } finally {
        client.release()
    }
}

/**
 * Get bandwidth history from database
 */
export async function getBandwidthHistory(
    dbPool: Pool,
    options: {
        startTime?: Date
        endTime?: Date
        limit?: number
        includeEndpoints?: boolean
    } = {}
): Promise<BandwidthMetric[]> {
    try {
        const { startTime, endTime, limit = 1440, includeEndpoints = true } = options // Default 1440 = 24 hours of minutes

        let query = 'SELECT * FROM bandwidth_minutes WHERE 1=1'
        const params: any[] = []
        let paramCount = 1

        if (startTime) {
            query += ` AND minute_timestamp >= $${paramCount}`
            params.push(startTime)
            paramCount++
        }

        if (endTime) {
            query += ` AND minute_timestamp <= $${paramCount}`
            params.push(endTime)
            paramCount++
        }

        query += ' ORDER BY minute_timestamp DESC'

        if (limit) {
            query += ` LIMIT $${paramCount}`
            params.push(limit)
        }

        const result = await dbPool.query(query, params)

        const metrics: BandwidthMetric[] = []

        for (const row of result.rows) {
            const metric: BandwidthMetric = {
                timestamp: row.minute_timestamp,
                bytes: parseInt(row.total_bytes),
                kb: parseFloat(row.total_kb)
            }

            // Load endpoints if requested
            if (includeEndpoints) {
                const endpointsResult = await dbPool.query(
                    'SELECT endpoint, bytes, kb, request_count FROM bandwidth_endpoints WHERE minute_timestamp = $1 ORDER BY bytes DESC',
                    [row.minute_timestamp]
                )

                if (endpointsResult.rows.length > 0) {
                    metric.endpoints = endpointsResult.rows.map(ep => ({
                        endpoint: ep.endpoint,
                        bytes: parseInt(ep.bytes),
                        kb: parseFloat(ep.kb),
                        requestCount: ep.request_count
                    }))
                }
            }

            metrics.push(metric)
        }

        return metrics
    } catch (error: any) {
        logger.error({ error: error.message }, 'Error fetching bandwidth history from database')
        return []
    }
}

/**
 * Get bandwidth statistics for a specific time range
 */
export async function getBandwidthStats(
    dbPool: Pool,
    startTime: Date,
    endTime: Date
): Promise<{
    totalKB: number
    totalBytes: number
    totalMinutes: number
    avgKBPerMinute: number
}> {
    try {
        const result = await dbPool.query(
            `SELECT
                SUM(total_bytes) as total_bytes,
                SUM(total_kb) as total_kb,
                COUNT(*) as total_minutes,
                AVG(total_kb) as avg_kb
             FROM bandwidth_minutes
             WHERE minute_timestamp >= $1 AND minute_timestamp <= $2`,
            [startTime, endTime]
        )

        const row = result.rows[0]

        return {
            totalKB: parseFloat(row.total_kb) || 0,
            totalBytes: parseInt(row.total_bytes) || 0,
            totalMinutes: parseInt(row.total_minutes) || 0,
            avgKBPerMinute: parseFloat(row.avg_kb) || 0
        }
    } catch (error: any) {
        logger.error({ error: error.message }, 'Error fetching bandwidth stats from database')
        return {
            totalKB: 0,
            totalBytes: 0,
            totalMinutes: 0,
            avgKBPerMinute: 0
        }
    }
}

/**
 * Get top endpoints by bandwidth usage
 */
export async function getTopEndpoints(
    dbPool: Pool,
    options: {
        startTime?: Date
        endTime?: Date
        limit?: number
    } = {}
): Promise<Array<{
    endpoint: string
    totalKB: number
    totalBytes: number
    requestCount: number
    percentage: number
}>> {
    try {
        const { startTime, endTime, limit = 20 } = options

        let query = `
            SELECT
                endpoint,
                SUM(bytes) as total_bytes,
                SUM(kb) as total_kb,
                SUM(request_count) as total_requests
            FROM bandwidth_endpoints
            WHERE 1=1
        `
        const params: any[] = []
        let paramCount = 1

        if (startTime) {
            query += ` AND minute_timestamp >= $${paramCount}`
            params.push(startTime)
            paramCount++
        }

        if (endTime) {
            query += ` AND minute_timestamp <= $${paramCount}`
            params.push(endTime)
            paramCount++
        }

        query += ` GROUP BY endpoint ORDER BY total_bytes DESC LIMIT $${paramCount}`
        params.push(limit)

        const result = await dbPool.query(query, params)

        // Calculate total for percentage
        const totalBytes = result.rows.reduce((sum, row) => sum + parseInt(row.total_bytes), 0)

        return result.rows.map(row => ({
            endpoint: row.endpoint,
            totalKB: parseFloat(row.total_kb),
            totalBytes: parseInt(row.total_bytes),
            requestCount: parseInt(row.total_requests),
            percentage: totalBytes > 0 ? (parseInt(row.total_bytes) / totalBytes) * 100 : 0
        }))
    } catch (error: any) {
        logger.error({ error: error.message }, 'Error fetching top endpoints from database')
        return []
    }
}

/**
 * Delete old bandwidth data (retention policy)
 */
export async function cleanupOldBandwidthData(
    dbPool: Pool,
    retentionDays: number = 30
): Promise<number> {
    try {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

        const result = await dbPool.query(
            'DELETE FROM bandwidth_minutes WHERE minute_timestamp < $1',
            [cutoffDate]
        )

        logger.info({ deletedRows: result.rowCount, retentionDays }, 'Cleaned up old bandwidth data')
        return result.rowCount || 0
    } catch (error: any) {
        logger.error({ error: error.message }, 'Error cleaning up old bandwidth data')
        return 0
    }
}
