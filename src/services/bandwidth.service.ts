/**
 * Bandwidth Metrics Service
 * Tracks outgoing data in KB per minute
 */

import type { Pool } from 'pg'
import { saveBandwidthMinuteToDatabase } from '../database/bandwidth.db.js'

export interface BandwidthMetric {
    timestamp: Date
    bytes: number
    kb: number
    endpoints?: EndpointMinuteStats[]
}

export interface EndpointMinuteStats {
    endpoint: string
    bytes: number
    kb: number
    requestCount: number
}

export interface EndpointStats {
    endpoint: string
    bytes: number
    kb: number
    requestCount: number
    percentage: number
}

export interface BandwidthStats {
    currentMinute: {
        timestamp: Date
        totalKB: number
        totalBytes: number
        requestCount: number
    }
    lastMinute: {
        timestamp: Date
        totalKB: number
        totalBytes: number
        requestCount: number
    }
    last60Minutes: BandwidthMetric[]
    totalKB: number
    totalBytes: number
    totalRequests: number
    byEndpoint: EndpointStats[]
}

class BandwidthService {
    private currentMinuteData: {
        timestamp: Date
        bytes: number
        requestCount: number
    }

    private lastMinuteData: {
        timestamp: Date
        bytes: number
        requestCount: number
    }

    private history: BandwidthMetric[] = []
    private maxHistoryMinutes = 60

    private totalBytes = 0
    private totalRequests = 0

    // Track bandwidth by endpoint (lifetime)
    private endpointStats: Map<string, { bytes: number, requestCount: number }> = new Map()

    // Track bandwidth by endpoint for current minute
    private currentMinuteEndpoints: Map<string, { bytes: number, requestCount: number }> = new Map()

    // Database pool (optional - if not set, won't persist to DB)
    private dbPool: Pool | null = null

    constructor() {
        const now = new Date()
        now.setSeconds(0, 0)

        this.currentMinuteData = {
            timestamp: now,
            bytes: 0,
            requestCount: 0
        }

        this.lastMinuteData = {
            timestamp: new Date(now.getTime() - 60000),
            bytes: 0,
            requestCount: 0
        }

        // Start minute rotation timer
        this.startMinuteRotation()
    }

    /**
     * Set database pool for persistence
     */
    setDatabasePool(pool: Pool): void {
        this.dbPool = pool
    }

    /**
     * Track outgoing bytes
     */
    trackOutgoing(bytes: number, endpoint?: string): void {
        const now = new Date()
        now.setSeconds(0, 0)

        // Check if we need to rotate to a new minute
        if (now.getTime() !== this.currentMinuteData.timestamp.getTime()) {
            this.rotateMinute(now)
        }

        this.currentMinuteData.bytes += bytes
        this.currentMinuteData.requestCount++
        this.totalBytes += bytes
        this.totalRequests++

        // Track by endpoint (lifetime)
        if (endpoint) {
            const stats = this.endpointStats.get(endpoint) || { bytes: 0, requestCount: 0 }
            stats.bytes += bytes
            stats.requestCount++
            this.endpointStats.set(endpoint, stats)

            // Track by endpoint (current minute)
            const minuteStats = this.currentMinuteEndpoints.get(endpoint) || { bytes: 0, requestCount: 0 }
            minuteStats.bytes += bytes
            minuteStats.requestCount++
            this.currentMinuteEndpoints.set(endpoint, minuteStats)
        }
    }

    /**
     * Rotate to a new minute bucket
     */
    private rotateMinute(newMinuteTimestamp: Date): void {
        // Save current minute to history
        if (this.currentMinuteData.bytes > 0) {
            // Convert endpoint map to array
            const endpointArray: EndpointMinuteStats[] = []
            this.currentMinuteEndpoints.forEach((stats, endpoint) => {
                endpointArray.push({
                    endpoint,
                    bytes: stats.bytes,
                    kb: stats.bytes / 1024,
                    requestCount: stats.requestCount
                })
            })

            // Sort by bytes descending
            endpointArray.sort((a, b) => b.bytes - a.bytes)

            const metric: BandwidthMetric = {
                timestamp: this.currentMinuteData.timestamp,
                bytes: this.currentMinuteData.bytes,
                kb: this.currentMinuteData.bytes / 1024,
                endpoints: endpointArray
            }

            // Add to in-memory history
            this.history.push(metric)

            // Keep only last N minutes in memory
            if (this.history.length > this.maxHistoryMinutes) {
                this.history.shift()
            }

            // Save to database if available (fire and forget)
            if (this.dbPool) {
                saveBandwidthMinuteToDatabase(this.dbPool, metric).catch(err => {
                    // Errors are already logged in the database function
                })
            }
        }

        // Move current to last
        this.lastMinuteData = {
            timestamp: this.currentMinuteData.timestamp,
            bytes: this.currentMinuteData.bytes,
            requestCount: this.currentMinuteData.requestCount
        }

        // Reset current minute
        this.currentMinuteData = {
            timestamp: newMinuteTimestamp,
            bytes: 0,
            requestCount: 0
        }

        // Reset current minute endpoints
        this.currentMinuteEndpoints.clear()
    }

    /**
     * Start automatic minute rotation timer
     */
    private startMinuteRotation(): void {
        setInterval(() => {
            const now = new Date()
            now.setSeconds(0, 0)

            if (now.getTime() !== this.currentMinuteData.timestamp.getTime()) {
                this.rotateMinute(now)
            }
        }, 5000) // Check every 5 seconds
    }

    /**
     * Get current bandwidth statistics
     */
    getStats(): BandwidthStats {
        // Build endpoint stats array
        const endpointStatsArray: EndpointStats[] = []
        this.endpointStats.forEach((stats, endpoint) => {
            endpointStatsArray.push({
                endpoint,
                bytes: stats.bytes,
                kb: stats.bytes / 1024,
                requestCount: stats.requestCount,
                percentage: this.totalBytes > 0 ? (stats.bytes / this.totalBytes) * 100 : 0
            })
        })

        // Sort by bytes descending
        endpointStatsArray.sort((a, b) => b.bytes - a.bytes)

        return {
            currentMinute: {
                timestamp: this.currentMinuteData.timestamp,
                totalKB: this.currentMinuteData.bytes / 1024,
                totalBytes: this.currentMinuteData.bytes,
                requestCount: this.currentMinuteData.requestCount
            },
            lastMinute: {
                timestamp: this.lastMinuteData.timestamp,
                totalKB: this.lastMinuteData.bytes / 1024,
                totalBytes: this.lastMinuteData.bytes,
                requestCount: this.lastMinuteData.requestCount
            },
            last60Minutes: [...this.history],
            totalKB: this.totalBytes / 1024,
            totalBytes: this.totalBytes,
            totalRequests: this.totalRequests,
            byEndpoint: endpointStatsArray
        }
    }

    /**
     * Get stats for a specific time range
     */
    getStatsInRange(startTime: Date, endTime: Date): BandwidthMetric[] {
        return this.history.filter(metric =>
            metric.timestamp >= startTime && metric.timestamp <= endTime
        )
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.currentMinuteData.bytes = 0
        this.currentMinuteData.requestCount = 0
        this.lastMinuteData.bytes = 0
        this.lastMinuteData.requestCount = 0
        this.history = []
        this.totalBytes = 0
        this.totalRequests = 0
        this.endpointStats.clear()
        this.currentMinuteEndpoints.clear()
    }
}

// Export singleton instance
export const bandwidthService = new BandwidthService()
