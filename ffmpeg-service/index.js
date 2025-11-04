import express from 'express'
import multer from 'multer'
import ffmpeg from 'fluent-ffmpeg'
import P from 'pino'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const app = express()
const logger = P({ level: 'info' })

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = '/temp/uploads'
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true })
        }
        cb(null, uploadDir)
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`
        cb(null, `${uniqueSuffix}-${file.originalname}`)
    }
})

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
})

// Middleware
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'ffmpeg-service',
        timestamp: new Date().toISOString()
    })
})

// Get media info
app.post('/info', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' })
        }

        const inputPath = req.file.path

        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            // Cleanup
            fs.unlinkSync(inputPath)

            if (err) {
                logger.error({ error: err }, 'Error getting media info')
                return res.status(500).json({ error: err.message })
            }

            res.json({
                success: true,
                metadata
            })
        })
    } catch (error) {
        logger.error({ error }, 'Error in /info endpoint')
        res.status(500).json({ error: error.message })
    }
})

// Convert video to WhatsApp-compatible format
app.post('/convert/video', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' })
        }

        const inputPath = req.file.path
        const outputDir = '/media/converted'
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        const outputFilename = `${Date.now()}-${path.parse(req.file.originalname).name}.mp4`
        const outputPath = path.join(outputDir, outputFilename)

        // WhatsApp video specs:
        // - Format: MP4 (H.264 video + AAC audio)
        // - Max size: 16MB for direct send
        // - Max duration: 90 seconds for status
        // - Resolution: max 1280x720 recommended

        ffmpeg(inputPath)
            .outputOptions([
                '-c:v libx264',         // H.264 video codec
                '-preset fast',         // Encoding speed
                '-crf 28',              // Quality (23 = high, 28 = medium)
                '-c:a aac',             // AAC audio codec
                '-b:a 128k',            // Audio bitrate
                '-ar 44100',            // Audio sample rate
                '-ac 2',                // Stereo audio
                '-movflags +faststart', // Enable streaming
                '-vf scale=min(1280\\,iw):min(720\\,ih):force_original_aspect_ratio=decrease' // Max 1280x720
            ])
            .output(outputPath)
            .on('end', () => {
                // Cleanup input file
                fs.unlinkSync(inputPath)

                const stats = fs.statSync(outputPath)

                logger.info({
                    input: req.file.originalname,
                    output: outputFilename,
                    size: stats.size
                }, 'Video converted successfully')

                res.json({
                    success: true,
                    filename: outputFilename,
                    path: `/media/converted/${outputFilename}`,
                    size: stats.size,
                    message: 'Video converted to WhatsApp-compatible format'
                })
            })
            .on('error', (err) => {
                // Cleanup
                fs.unlinkSync(inputPath)
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath)
                }

                logger.error({ error: err }, 'Video conversion failed')
                res.status(500).json({ error: err.message })
            })
            .run()
    } catch (error) {
        logger.error({ error }, 'Error in /convert/video endpoint')
        res.status(500).json({ error: error.message })
    }
})

// Convert audio to WhatsApp-compatible format
app.post('/convert/audio', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' })
        }

        const inputPath = req.file.path
        const outputDir = '/media/converted'
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        const format = req.body.format || 'opus' // opus or mp3
        const outputFilename = `${Date.now()}-${path.parse(req.file.originalname).name}.${format}`
        const outputPath = path.join(outputDir, outputFilename)

        // WhatsApp audio specs:
        // - Format: Opus (in OGG container) or MP3
        // - Bitrate: 128kbps recommended

        const codecOptions = format === 'opus'
            ? ['-c:a libopus', '-b:a 128k', '-f ogg']
            : ['-c:a libmp3lame', '-b:a 128k']

        ffmpeg(inputPath)
            .outputOptions(codecOptions)
            .output(outputPath)
            .on('end', () => {
                // Cleanup input file
                fs.unlinkSync(inputPath)

                const stats = fs.statSync(outputPath)

                logger.info({
                    input: req.file.originalname,
                    output: outputFilename,
                    size: stats.size
                }, 'Audio converted successfully')

                res.json({
                    success: true,
                    filename: outputFilename,
                    path: `/media/converted/${outputFilename}`,
                    size: stats.size,
                    message: 'Audio converted to WhatsApp-compatible format'
                })
            })
            .on('error', (err) => {
                // Cleanup
                fs.unlinkSync(inputPath)
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath)
                }

                logger.error({ error: err }, 'Audio conversion failed')
                res.status(500).json({ error: err.message })
            })
            .run()
    } catch (error) {
        logger.error({ error }, 'Error in /convert/audio endpoint')
        res.status(500).json({ error: error.message })
    }
})

// Convert image to WhatsApp-compatible format
app.post('/convert/image', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' })
        }

        const inputPath = req.file.path
        const outputDir = '/media/converted'
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        const outputFormat = req.body.format || 'jpeg' // jpeg or png
        const outputFilename = `${Date.now()}-${path.parse(req.file.originalname).name}.${outputFormat}`
        const outputPath = path.join(outputDir, outputFilename)

        // WhatsApp image specs:
        // - Format: JPEG or PNG
        // - Max size: 5MB recommended
        // - Max resolution: 4096x4096

        ffmpeg(inputPath)
            .outputOptions([
                '-vf scale=min(4096\\,iw):min(4096\\,ih):force_original_aspect_ratio=decrease',
                outputFormat === 'jpeg' ? '-q:v 2' : '' // JPEG quality (2 = high)
            ])
            .output(outputPath)
            .on('end', () => {
                // Cleanup input file
                fs.unlinkSync(inputPath)

                const stats = fs.statSync(outputPath)

                logger.info({
                    input: req.file.originalname,
                    output: outputFilename,
                    size: stats.size
                }, 'Image converted successfully')

                res.json({
                    success: true,
                    filename: outputFilename,
                    path: `/media/converted/${outputFilename}`,
                    size: stats.size,
                    message: 'Image converted to WhatsApp-compatible format'
                })
            })
            .on('error', (err) => {
                // Cleanup
                fs.unlinkSync(inputPath)
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath)
                }

                logger.error({ error: err }, 'Image conversion failed')
                res.status(500).json({ error: err.message })
            })
            .run()
    } catch (error) {
        logger.error({ error }, 'Error in /convert/image endpoint')
        res.status(500).json({ error: error.message })
    }
})

// Split video into segments (for long videos)
app.post('/split/video', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' })
        }

        const inputPath = req.file.path
        const segmentDuration = parseInt(req.body.segmentDuration) || 30 // Default 30 seconds
        const outputDir = '/media/segments'
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        // First, get video duration
        ffmpeg.ffprobe(inputPath, async (err, metadata) => {
            if (err) {
                fs.unlinkSync(inputPath)
                logger.error({ error: err }, 'Error probing video')
                return res.status(500).json({ error: err.message })
            }

            const duration = metadata.format.duration
            const numSegments = Math.ceil(duration / segmentDuration)

            logger.info({
                duration,
                segmentDuration,
                numSegments,
                filename: req.file.originalname
            }, 'Splitting video into segments')

            const segments = []
            const baseFilename = `${Date.now()}-${path.parse(req.file.originalname).name}`

            // Create all segments
            const segmentPromises = []

            for (let i = 0; i < numSegments; i++) {
                const startTime = i * segmentDuration
                const outputFilename = `${baseFilename}-part${i + 1}.mp4`
                const outputPath = path.join(outputDir, outputFilename)

                const segmentPromise = new Promise((resolve, reject) => {
                    // WhatsApp-optimized parameters (H.264 High@L3.1, no B-frames)
                    ffmpeg(inputPath)
                        .setStartTime(startTime)
                        .setDuration(segmentDuration)
                        .outputOptions([
                            // Video codec settings
                            '-c:v libx264',
                            '-pix_fmt yuv420p',
                            '-profile:v high',
                            '-level 3.1',
                            '-bf 0',              // No B-frames
                            '-refs 1',            // Reference frames
                            '-g 60',              // GOP size
                            '-sc_threshold 0',    // Scene change threshold

                            // Bitrate control (VBV)
                            '-b:v 1.52M',
                            '-maxrate 1.6M',
                            '-bufsize 3.2M',

                            // Frame rate
                            '-vsync cfr',

                            // Audio codec settings
                            '-c:a aac',
                            '-profile:a aac_low',
                            '-b:a 256k',
                            '-ac 2',              // Stereo
                            '-ar 48000',          // 48kHz sample rate

                            // Stream mapping
                            '-map 0',
                            '-map -0:d',          // Remove data streams
                            '-map -0:s',          // Remove subtitle streams
                            '-map -0:t',          // Remove attachment streams

                            // Fast start for streaming
                            '-movflags +faststart'
                        ])
                        .output(outputPath)
                        .on('end', () => {
                            const stats = fs.statSync(outputPath)
                            segments.push({
                                filename: outputFilename,
                                path: `/media/segments/${outputFilename}`,
                                size: stats.size,
                                segmentNumber: i + 1,
                                startTime,
                                duration: Math.min(segmentDuration, duration - startTime)
                            })
                            resolve()
                        })
                        .on('error', (err) => {
                            if (fs.existsSync(outputPath)) {
                                fs.unlinkSync(outputPath)
                            }
                            reject(err)
                        })
                        .run()
                })

                segmentPromises.push(segmentPromise)
            }

            try {
                // Wait for all segments to be created
                await Promise.all(segmentPromises)

                // Cleanup input file
                fs.unlinkSync(inputPath)

                // Sort segments by segment number
                segments.sort((a, b) => a.segmentNumber - b.segmentNumber)

                logger.info({
                    input: req.file.originalname,
                    totalSegments: segments.length,
                    totalSize: segments.reduce((sum, s) => sum + s.size, 0)
                }, 'Video split successfully')

                res.json({
                    success: true,
                    totalSegments: segments.length,
                    totalDuration: duration,
                    segmentDuration,
                    segments,
                    message: `Video split into ${segments.length} segments`
                })
            } catch (error) {
                // Cleanup on error
                fs.unlinkSync(inputPath)
                segments.forEach(segment => {
                    const segmentPath = path.join(outputDir, segment.filename)
                    if (fs.existsSync(segmentPath)) {
                        fs.unlinkSync(segmentPath)
                    }
                })

                logger.error({ error }, 'Error splitting video')
                res.status(500).json({ error: error.message })
            }
        })
    } catch (error) {
        logger.error({ error }, 'Error in /split/video endpoint')
        res.status(500).json({ error: error.message })
    }
})

// Generate thumbnail from video
app.post('/thumbnail', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' })
        }

        const inputPath = req.file.path
        const outputDir = '/media/thumbnails'
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        const outputFilename = `${Date.now()}-${path.parse(req.file.originalname).name}.jpg`
        const outputPath = path.join(outputDir, outputFilename)

        const timePosition = req.body.time || '00:00:01' // Default to 1 second

        ffmpeg(inputPath)
            .screenshots({
                timestamps: [timePosition],
                filename: outputFilename,
                folder: outputDir,
                size: '320x240'
            })
            .on('end', () => {
                // Cleanup input file
                fs.unlinkSync(inputPath)

                const stats = fs.statSync(outputPath)

                logger.info({
                    input: req.file.originalname,
                    output: outputFilename,
                    size: stats.size
                }, 'Thumbnail generated successfully')

                res.json({
                    success: true,
                    filename: outputFilename,
                    path: `/media/thumbnails/${outputFilename}`,
                    size: stats.size,
                    message: 'Thumbnail generated successfully'
                })
            })
            .on('error', (err) => {
                // Cleanup
                fs.unlinkSync(inputPath)
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath)
                }

                logger.error({ error: err }, 'Thumbnail generation failed')
                res.status(500).json({ error: err.message })
            })
    } catch (error) {
        logger.error({ error }, 'Error in /thumbnail endpoint')
        res.status(500).json({ error: error.message })
    }
})

// Start server
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    logger.info(`🎬 FFmpeg Service running on port ${PORT}`)
    logger.info(`📁 Upload directory: /temp/uploads`)
    logger.info(`📁 Output directory: /media`)
})
