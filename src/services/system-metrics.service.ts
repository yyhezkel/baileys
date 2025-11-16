/**
 * System Metrics Service
 * Tracks CPU, memory, and performance metrics
 */

import os from 'os'
import process from 'process'

interface SystemMetrics {
    timestamp: string
    cpu: {
        usage: number // Percentage (0-100)
        loadAverage: number[] // 1min, 5min, 15min
        cores: number
    }
    memory: {
        total: number // bytes
        used: number // bytes
        free: number // bytes
        usagePercent: number // 0-100
        heapTotal: number // bytes (Node.js heap)
        heapUsed: number // bytes (Node.js heap)
        heapUsagePercent: number // 0-100
    }
    process: {
        pid: number
        uptime: number // seconds
        cpuUsage: {
            user: number // microseconds
            system: number // microseconds
        }
    }
}

interface PerformanceMetric {
    operation: string
    duration: number // milliseconds
    timestamp: Date
    success: boolean
    metadata?: any
}

class SystemMetricsService {
    private performanceMetrics: PerformanceMetric[] = []
    private maxPerformanceMetrics = 1000 // Keep last 1000 operations
    private previousCpuUsage = process.cpuUsage()
    private previousTime = Date.now()

    /**
     * Get current system metrics
     */
    getSystemMetrics(): SystemMetrics {
        const now = Date.now()
        const currentCpuUsage = process.cpuUsage(this.previousCpuUsage)
        const timeDiff = (now - this.previousTime) / 1000 // Convert to seconds

        // Calculate CPU percentage
        const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / 1000000 / timeDiff / os.cpus().length) * 100

        // Update previous values
        this.previousCpuUsage = process.cpuUsage()
        this.previousTime = now

        // Memory metrics
        const totalMemory = os.totalmem()
        const freeMemory = os.freemem()
        const usedMemory = totalMemory - freeMemory
        const memUsagePercent = (usedMemory / totalMemory) * 100

        // Node.js heap
        const memUsage = process.memoryUsage()
        const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100

        return {
            timestamp: new Date().toISOString(),
            cpu: {
                usage: Math.min(100, Math.max(0, cpuPercent)),
                loadAverage: os.loadavg(),
                cores: os.cpus().length
            },
            memory: {
                total: totalMemory,
                used: usedMemory,
                free: freeMemory,
                usagePercent: memUsagePercent,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                heapUsagePercent
            },
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                cpuUsage: currentCpuUsage
            }
        }
    }

    /**
     * Track performance of an operation
     */
    trackPerformance(metric: PerformanceMetric): void {
        this.performanceMetrics.push(metric)

        // Keep only recent metrics
        if (this.performanceMetrics.length > this.maxPerformanceMetrics) {
            this.performanceMetrics.shift()
        }
    }

    /**
     * Start timing an operation
     */
    startTimer(operation: string): (success?: boolean, metadata?: any) => void {
        const startTime = Date.now()

        return (success: boolean = true, metadata?: any) => {
            const duration = Date.now() - startTime
            this.trackPerformance({
                operation,
                duration,
                timestamp: new Date(),
                success,
                metadata
            })
        }
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics(operation?: string, limit: number = 100): PerformanceMetric[] {
        let metrics = this.performanceMetrics

        if (operation) {
            metrics = metrics.filter(m => m.operation === operation)
        }

        return metrics.slice(-limit)
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats(operation?: string): {
        operation: string | 'all'
        count: number
        successCount: number
        failureCount: number
        successRate: number
        avgDuration: number
        minDuration: number
        maxDuration: number
        p50Duration: number
        p95Duration: number
        p99Duration: number
    } {
        let metrics = this.performanceMetrics

        if (operation) {
            metrics = metrics.filter(m => m.operation === operation)
        }

        if (metrics.length === 0) {
            return {
                operation: operation || 'all',
                count: 0,
                successCount: 0,
                failureCount: 0,
                successRate: 0,
                avgDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                p50Duration: 0,
                p95Duration: 0,
                p99Duration: 0
            }
        }

        const durations = metrics.map(m => m.duration).sort((a, b) => a - b)
        const successCount = metrics.filter(m => m.success).length
        const failureCount = metrics.length - successCount

        return {
            operation: operation || 'all',
            count: metrics.length,
            successCount,
            failureCount,
            successRate: (successCount / metrics.length) * 100,
            avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
            minDuration: durations[0] || 0,
            maxDuration: durations[durations.length - 1] || 0,
            p50Duration: durations[Math.floor(durations.length * 0.5)] || 0,
            p95Duration: durations[Math.floor(durations.length * 0.95)] || 0,
            p99Duration: durations[Math.floor(durations.length * 0.99)] || 0
        }
    }

    /**
     * Get all tracked operations
     */
    getTrackedOperations(): string[] {
        const operations = new Set(this.performanceMetrics.map(m => m.operation))
        return Array.from(operations)
    }

    /**
     * Clear performance metrics
     */
    clearPerformanceMetrics(): void {
        this.performanceMetrics = []
    }

    /**
     * Format bytes to human readable
     */
    formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }
}

// Export singleton
export const systemMetricsService = new SystemMetricsService()
