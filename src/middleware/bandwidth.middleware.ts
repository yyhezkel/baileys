import type { Request, Response, NextFunction } from 'express'
import { bandwidthService } from '../services/bandwidth.service.js'

/**
 * Middleware to track outgoing bandwidth
 * Captures the size of all HTTP responses
 */
export function bandwidthTrackerMiddleware(req: Request, res: Response, next: NextFunction) {
    const originalSend = res.send
    const originalJson = res.json
    const originalEnd = res.end

    let responseSize = 0

    // Get endpoint path - use route path if available, otherwise use req.path
    const getEndpoint = (): string => {
        // Try to get the route path (e.g., /session/:sessionId)
        if (req.route && req.route.path) {
            return `${req.method} ${req.route.path}`
        }
        // Fallback to actual path
        return `${req.method} ${req.path}`
    }

    // Override res.send
    res.send = function (data: any): Response {
        if (data) {
            responseSize = Buffer.byteLength(
                typeof data === 'string' ? data : JSON.stringify(data),
                'utf8'
            )
            bandwidthService.trackOutgoing(responseSize, getEndpoint())
        }
        return originalSend.call(this, data)
    }

    // Override res.json
    res.json = function (data: any): Response {
        if (data) {
            responseSize = Buffer.byteLength(JSON.stringify(data), 'utf8')
            bandwidthService.trackOutgoing(responseSize, getEndpoint())
        }
        return originalJson.call(this, data)
    }

    // Override res.end
    res.end = function (chunk?: any, encoding?: any, callback?: any): Response {
        if (chunk && responseSize === 0) {
            // Only track if we haven't tracked yet (from send/json)
            const size = Buffer.byteLength(
                typeof chunk === 'string' ? chunk : (chunk?.toString() || ''),
                'utf8'
            )
            bandwidthService.trackOutgoing(size, getEndpoint())
        }

        // Handle different call signatures of res.end
        if (typeof encoding === 'function') {
            callback = encoding
            encoding = undefined
        }

        return originalEnd.call(this, chunk, encoding, callback)
    }

    next()
}
