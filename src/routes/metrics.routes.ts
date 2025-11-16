import type { Express, Request, Response } from 'express'
import type { Pool } from 'pg'
import { bandwidthService } from '../services/bandwidth.service.js'
import { systemMetricsService } from '../services/system-metrics.service.js'
import { getBandwidthHistory, getBandwidthStats, getTopEndpoints, cleanupOldBandwidthData } from '../database/bandwidth.db.js'

/**
 * Create metrics routes
 */
export function createMetricsRoutes(app: Express, dbPool?: Pool) {
    /**
     * @swagger
     * /metrics/system:
     *   get:
     *     summary: Get system metrics (CPU, memory, process)
     *     description: Returns current CPU usage, memory usage, and process information
     *     tags: [Metrics]
     *     responses:
     *       200:
     *         description: System metrics
     */
    app.get('/metrics/system', (req: Request, res: Response) => {
        try {
            const metrics = systemMetricsService.getSystemMetrics()
            res.json(metrics)
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve system metrics' })
        }
    })

    /**
     * @swagger
     * /metrics/performance:
     *   get:
     *     summary: Get performance metrics for operations
     *     description: Returns performance statistics for tracked operations
     *     tags: [Metrics]
     *     parameters:
     *       - in: query
     *         name: operation
     *         schema:
     *           type: string
     *         description: Filter by specific operation (e.g., 'send-status')
     *     responses:
     *       200:
     *         description: Performance statistics
     */
    app.get('/metrics/performance', (req: Request, res: Response) => {
        try {
            const { operation } = req.query

            if (operation) {
                const stats = systemMetricsService.getPerformanceStats(operation as string)
                const recent = systemMetricsService.getPerformanceMetrics(operation as string, 10)
                res.json({ stats, recentOperations: recent })
            } else {
                const operations = systemMetricsService.getTrackedOperations()
                const allStats = operations.map(op => systemMetricsService.getPerformanceStats(op))
                res.json({ operations: allStats })
            }
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve performance metrics' })
        }
    })

    /**
     * @swagger
     * /metrics/performance/clear:
     *   post:
     *     summary: Clear performance metrics
     *     description: Clears all tracked performance metrics
     *     tags: [Metrics]
     *     responses:
     *       200:
     *         description: Metrics cleared
     */
    app.post('/metrics/performance/clear', (req: Request, res: Response) => {
        try {
            systemMetricsService.clearPerformanceMetrics()
            res.json({ success: true, message: 'Performance metrics cleared' })
        } catch (error) {
            res.status(500).json({ error: 'Failed to clear performance metrics' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth:
     *   get:
     *     summary: Get bandwidth metrics
     *     description: Returns outgoing bandwidth statistics in KB per minute
     *     tags: [Metrics]
     *     responses:
     *       200:
     *         description: Bandwidth statistics
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 currentMinute:
     *                   type: object
     *                   properties:
     *                     timestamp:
     *                       type: string
     *                       format: date-time
     *                     totalKB:
     *                       type: number
     *                     totalBytes:
     *                       type: number
     *                     requestCount:
     *                       type: integer
     *                 lastMinute:
     *                   type: object
     *                   properties:
     *                     timestamp:
     *                       type: string
     *                       format: date-time
     *                     totalKB:
     *                       type: number
     *                     totalBytes:
     *                       type: number
     *                     requestCount:
     *                       type: integer
     *                 last60Minutes:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       timestamp:
     *                         type: string
     *                         format: date-time
     *                       bytes:
     *                         type: number
     *                       kb:
     *                         type: number
     *                 totalKB:
     *                   type: number
     *                 totalBytes:
     *                   type: number
     *                 totalRequests:
     *                   type: integer
     */
    app.get('/metrics/bandwidth', (req: Request, res: Response) => {
        try {
            const stats = bandwidthService.getStats()
            res.json(stats)
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve bandwidth metrics' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth/range:
     *   get:
     *     summary: Get bandwidth metrics for a time range
     *     description: Returns bandwidth statistics for a specific time range
     *     tags: [Metrics]
     *     parameters:
     *       - in: query
     *         name: start
     *         schema:
     *           type: string
     *           format: date-time
     *         required: true
     *         description: Start time (ISO 8601 format)
     *       - in: query
     *         name: end
     *         schema:
     *           type: string
     *           format: date-time
     *         required: true
     *         description: End time (ISO 8601 format)
     *     responses:
     *       200:
     *         description: Bandwidth statistics for the specified range
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   timestamp:
     *                     type: string
     *                     format: date-time
     *                   bytes:
     *                     type: number
     *                   kb:
     *                     type: number
     *       400:
     *         description: Invalid parameters
     */
    app.get('/metrics/bandwidth/range', (req: Request, res: Response) => {
        try {
            const { start, end } = req.query

            if (!start || !end) {
                return res.status(400).json({ error: 'Both start and end parameters are required' })
            }

            const startTime = new Date(start as string)
            const endTime = new Date(end as string)

            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                return res.status(400).json({ error: 'Invalid date format' })
            }

            const stats = bandwidthService.getStatsInRange(startTime, endTime)
            res.json(stats)
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve bandwidth metrics' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth/reset:
     *   post:
     *     summary: Reset bandwidth metrics
     *     description: Resets all bandwidth tracking metrics to zero
     *     tags: [Metrics]
     *     responses:
     *       200:
     *         description: Metrics reset successfully
     */
    app.post('/metrics/bandwidth/reset', (req: Request, res: Response) => {
        try {
            bandwidthService.reset()
            res.json({ success: true, message: 'Bandwidth metrics reset successfully' })
        } catch (error) {
            res.status(500).json({ error: 'Failed to reset bandwidth metrics' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth/history:
     *   get:
     *     summary: Get bandwidth history from database
     *     description: Returns historical bandwidth data from database
     *     tags: [Metrics]
     *     parameters:
     *       - in: query
     *         name: days
     *         schema:
     *           type: integer
     *         description: Number of days of history to retrieve (default 1, max 30)
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *         description: Maximum number of minutes to return (default 1440)
     *     responses:
     *       200:
     *         description: Historical bandwidth data
     */
    app.get('/metrics/bandwidth/history', async (req: Request, res: Response) => {
        if (!dbPool) {
            return res.status(503).json({ error: 'Database not configured' })
        }

        try {
            const days = Math.min(parseInt(req.query.days as string) || 1, 30)
            const limit = parseInt(req.query.limit as string) || 1440

            const endTime = new Date()
            const startTime = new Date()
            startTime.setDate(startTime.getDate() - days)

            const history = await getBandwidthHistory(dbPool, {
                startTime,
                endTime,
                limit,
                includeEndpoints: true
            })

            res.json({
                startTime,
                endTime,
                days,
                dataPoints: history.length,
                data: history
            })
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve bandwidth history' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth/stats:
     *   get:
     *     summary: Get bandwidth statistics for a time range
     *     description: Returns aggregated bandwidth stats
     *     tags: [Metrics]
     *     parameters:
     *       - in: query
     *         name: days
     *         schema:
     *           type: integer
     *         description: Number of days to analyze (default 7)
     *     responses:
     *       200:
     *         description: Aggregated bandwidth statistics
     */
    app.get('/metrics/bandwidth/stats', async (req: Request, res: Response) => {
        if (!dbPool) {
            return res.status(503).json({ error: 'Database not configured' })
        }

        try {
            const days = Math.min(parseInt(req.query.days as string) || 7, 90)

            const endTime = new Date()
            const startTime = new Date()
            startTime.setDate(startTime.getDate() - days)

            const stats = await getBandwidthStats(dbPool, startTime, endTime)

            res.json({
                startTime,
                endTime,
                days,
                ...stats
            })
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve bandwidth stats' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth/top-endpoints:
     *   get:
     *     summary: Get top endpoints by bandwidth usage
     *     description: Returns endpoints sorted by bandwidth consumption
     *     tags: [Metrics]
     *     parameters:
     *       - in: query
     *         name: days
     *         schema:
     *           type: integer
     *         description: Number of days to analyze (default 7)
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *         description: Number of top endpoints to return (default 20)
     *     responses:
     *       200:
     *         description: Top endpoints by bandwidth
     */
    app.get('/metrics/bandwidth/top-endpoints', async (req: Request, res: Response) => {
        if (!dbPool) {
            return res.status(503).json({ error: 'Database not configured' })
        }

        try {
            const days = Math.min(parseInt(req.query.days as string) || 7, 90)
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)

            const endTime = new Date()
            const startTime = new Date()
            startTime.setDate(startTime.getDate() - days)

            const topEndpoints = await getTopEndpoints(dbPool, {
                startTime,
                endTime,
                limit
            })

            res.json({
                startTime,
                endTime,
                days,
                endpoints: topEndpoints
            })
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve top endpoints' })
        }
    })

    /**
     * @swagger
     * /metrics/bandwidth/cleanup:
     *   post:
     *     summary: Cleanup old bandwidth data
     *     description: Deletes bandwidth data older than specified retention period
     *     tags: [Metrics]
     *     parameters:
     *       - in: query
     *         name: days
     *         schema:
     *           type: integer
     *         description: Retention period in days (default 30)
     *     responses:
     *       200:
     *         description: Cleanup completed
     */
    app.post('/metrics/bandwidth/cleanup', async (req: Request, res: Response) => {
        if (!dbPool) {
            return res.status(503).json({ error: 'Database not configured' })
        }

        try {
            const days = Math.max(parseInt(req.query.days as string) || 30, 7)
            const deletedRows = await cleanupOldBandwidthData(dbPool, days)

            res.json({
                success: true,
                message: `Cleaned up bandwidth data older than ${days} days`,
                deletedRows
            })
        } catch (error) {
            res.status(500).json({ error: 'Failed to cleanup bandwidth data' })
        }
    })
}
