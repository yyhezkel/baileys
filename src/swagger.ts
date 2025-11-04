export const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: 'Baileys WhatsApp API',
        version: '1.0.0',
        description: 'REST API for WhatsApp automation using Baileys library. Supports multiple sessions, story posting, and real-time WebSocket events.',
        contact: {
            name: 'API Support'
        }
    },
    servers: [
        {
            url: 'https://eee.bot4wa.com',
            description: 'Production server'
        },
        {
            url: 'http://localhost:3000',
            description: 'Local server'
        }
    ],
    tags: [
        {
            name: 'Health',
            description: 'Health check endpoints'
        },
        {
            name: 'Sessions',
            description: 'WhatsApp session management'
        },
        {
            name: 'Stories',
            description: 'WhatsApp status/story endpoints'
        },
        {
            name: 'Messages',
            description: 'Send regular messages'
        },
        {
            name: 'Contacts',
            description: 'Contact and list management'
        },
        {
            name: 'Default Recipients',
            description: 'Manage default status recipients (permanent broadcast list)'
        },
        {
            name: 'Lists',
            description: 'Contact lists/groups for targeted status sending'
        }
    ],
    paths: {
        '/health': {
            get: {
                tags: ['Health'],
                summary: 'Health check',
                description: 'Check if the API server is running and get active session count',
                responses: {
                    '200': {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: {
                                            type: 'string',
                                            example: 'ok'
                                        },
                                        sessions: {
                                            type: 'number',
                                            example: 2
                                        },
                                        timestamp: {
                                            type: 'string',
                                            format: 'date-time'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/session/create': {
            post: {
                tags: ['Sessions'],
                summary: 'Create or resume a session',
                description: 'Creates a new WhatsApp session or resumes an existing one. Returns QR code if not authenticated.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId'],
                                properties: {
                                    sessionId: {
                                        type: 'string',
                                        description: 'Unique identifier for the session',
                                        example: 'my-whatsapp'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Session created successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean'
                                        },
                                        sessionId: {
                                            type: 'string'
                                        },
                                        status: {
                                            type: 'string',
                                            enum: ['connecting', 'connected', 'disconnected']
                                        },
                                        qr: {
                                            type: 'string',
                                            description: 'QR code string (if not authenticated)'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Bad request - sessionId missing',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        error: {
                                            type: 'string'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/session/{sessionId}/request-code': {
            post: {
                tags: ['Sessions'],
                summary: 'Request pairing code (alternative to QR)',
                description: 'Request an 8-digit pairing code to link WhatsApp without scanning QR code. Enter the code in WhatsApp mobile app: Linked Devices > Link a Device > Link with phone number instead',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'Session identifier',
                        example: 'my-whatsapp'
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['phoneNumber'],
                                properties: {
                                    phoneNumber: {
                                        type: 'string',
                                        description: 'Phone number in international format without + sign',
                                        example: '1234567890'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Pairing code generated successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean'
                                        },
                                        code: {
                                            type: 'string',
                                            description: 'Pairing code in XXXX-XXXX format',
                                            example: 'ABCD-1234'
                                        },
                                        phoneNumber: {
                                            type: 'string',
                                            description: 'Cleaned phone number'
                                        },
                                        message: {
                                            type: 'string',
                                            description: 'Instructions for using the code'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Bad request - invalid phone number or session already connected'
                    },
                    '404': {
                        description: 'Session not found'
                    }
                }
            }
        },
        '/session/{sessionId}/status': {
            get: {
                tags: ['Sessions'],
                summary: 'Get session status',
                description: 'Retrieve the current status of a WhatsApp session',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'Session identifier'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Session status retrieved',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        sessionId: {
                                            type: 'string'
                                        },
                                        status: {
                                            type: 'string',
                                            enum: ['connecting', 'connected', 'disconnected']
                                        },
                                        qr: {
                                            type: 'string',
                                            description: 'QR code if available'
                                        },
                                        user: {
                                            type: 'object',
                                            properties: {
                                                id: {
                                                    type: 'string'
                                                },
                                                name: {
                                                    type: 'string'
                                                }
                                            }
                                        },
                                        lastUpdated: {
                                            type: 'string',
                                            format: 'date-time'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Session not found'
                    }
                }
            }
        },
        '/session/{sessionId}/qr': {
            get: {
                tags: ['Sessions'],
                summary: 'Get QR code',
                description: 'Get the QR code for an unauthenticated session',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        }
                    }
                ],
                responses: {
                    '200': {
                        description: 'QR code retrieved',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        sessionId: {
                                            type: 'string'
                                        },
                                        qr: {
                                            type: 'string',
                                            description: 'QR code string - convert to image at qr-code-generator.com'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Session not found or no QR code available'
                    }
                }
            }
        },
        '/session/{sessionId}/qr-image': {
            get: {
                tags: ['Sessions'],
                summary: 'Get QR code as image',
                description: 'Get the QR code for an unauthenticated session as a PNG image. This is ready to scan with WhatsApp mobile app.',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'The session ID to get QR code for',
                        example: 'my-whatsapp'
                    }
                ],
                responses: {
                    '200': {
                        description: 'QR code image generated successfully',
                        content: {
                            'image/png': {
                                schema: {
                                    type: 'string',
                                    format: 'binary',
                                    description: 'PNG image of the QR code (300x300px)'
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Session not found or no QR code available',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        error: {
                                            type: 'string',
                                            example: 'Session not found'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '500': {
                        description: 'Error generating QR code image',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        error: {
                                            type: 'string'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/sessions': {
            get: {
                tags: ['Sessions'],
                summary: 'List all sessions',
                description: 'Get a list of all active WhatsApp sessions',
                responses: {
                    '200': {
                        description: 'List of sessions',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        sessions: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    sessionId: {
                                                        type: 'string'
                                                    },
                                                    status: {
                                                        type: 'string'
                                                    },
                                                    hasQr: {
                                                        type: 'boolean'
                                                    },
                                                    user: {
                                                        type: 'object'
                                                    },
                                                    lastUpdated: {
                                                        type: 'string',
                                                        format: 'date-time'
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/session/{sessionId}': {
            delete: {
                tags: ['Sessions'],
                summary: 'Delete a session',
                description: 'Close or logout a WhatsApp session. Use logout=true to delete credentials, or logout=false to just close the socket (keeps credentials for reconnection).',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        }
                    },
                    {
                        name: 'logout',
                        in: 'query',
                        required: false,
                        schema: {
                            type: 'string',
                            enum: ['true', 'false'],
                            default: 'false'
                        },
                        description: 'If true, logout from WhatsApp and delete credentials. If false or not provided, just close the socket but preserve credentials for reconnection.'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Session closed or logged out',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean'
                                        },
                                        message: {
                                            type: 'string'
                                        },
                                        loggedOut: {
                                            type: 'boolean',
                                            description: 'True if credentials were deleted, false if session was just closed'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Session not found'
                    }
                }
            }
        },
        '/story/create': {
            post: {
                tags: ['Stories'],
                summary: 'Create and send a WhatsApp story/status',
                description: `Post a text, image, or video story to WhatsApp status. Stories disappear after 24 hours.

**Story Types:**
- **Text**: Plain text with customizable background color and font
- **Image**: Photo/image with optional caption
- **Video**: Video clip with optional caption

**Privacy Control:**
- Empty statusJidList (or []) = visible to ALL contacts
- Specific JIDs in statusJidList = visible ONLY to those contacts

**Text Story Styling:**
- backgroundColor: Hex code (#FF5733) or color name (red, blue, etc.)
- font: 0-10 (different font styles for text stories)

**Media Sources:**
- URL: https://example.com/image.jpg
- Local path: /app/Media/myfile.jpg
- Base64: data:image/jpeg;base64,...`,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'type', 'content'],
                                properties: {
                                    sessionId: {
                                        type: 'string',
                                        description: 'Session identifier',
                                        example: 'my-whatsapp'
                                    },
                                    type: {
                                        type: 'string',
                                        enum: ['text', 'image', 'video'],
                                        description: 'Type of story',
                                        example: 'text'
                                    },
                                    content: {
                                        type: 'string',
                                        description: 'Text content or URL/path to media file',
                                        example: 'Hello World! 🌟'
                                    },
                                    caption: {
                                        type: 'string',
                                        description: 'Caption text for image/video stories (optional). Supports emojis.',
                                        example: 'Check this out! 🎉'
                                    },
                                    backgroundColor: {
                                        type: 'string',
                                        description: `Background color for TEXT stories only (ignored for image/video).

Accepts hex codes or color names:
- Hex: #FF5733, #C70039, #1F618D
- Names: red, blue, green, black, white

Popular colors:
- #FF5733 (Orange Red)
- #C70039 (Deep Pink)
- #900C3F (Wine Red)
- #1F618D (Ocean Blue)
- #D4AC0D (Gold)
- #145A32 (Forest Green)
- #000000 (Black - default)`,
                                        example: '#FF5733'
                                    },
                                    font: {
                                        type: 'number',
                                        description: `Font style for TEXT stories only (ignored for image/video). Choose from:

0 - SYSTEM (default sans-serif)
1 - SYSTEM_TEXT (system text)
2 - FB_SCRIPT (fancy script/handwriting)
6 - SYSTEM_BOLD (bold sans-serif)
7 - MORNINGBREEZE_REGULAR (rounded, friendly)
8 - CALISTOGA_REGULAR (chunky, bold)
9 - EXO2_EXTRABOLD (modern, extra bold)
10 - COURIERPRIME_BOLD (typewriter style)

Recommended: 7 (MORNINGBREEZE) for casual posts, 9 (EXO2) for announcements`,
                                        example: 7,
                                        minimum: 0,
                                        maximum: 10,
                                        enum: [0, 1, 2, 6, 7, 8, 9, 10]
                                    },
                                    statusJidList: {
                                        type: 'array',
                                        items: {
                                            type: 'string',
                                            example: '1234567890'
                                        },
                                        description: `Privacy control - who can see this story:

[] or empty array = ALL CONTACTS (public story)
['1234567890', '9876543210'] = ONLY specific contacts (private story)

**Phone Number Format (Recommended):**
- Just the phone number: '1234567890', '9876543210'
- System automatically adds @s.whatsapp.net

**Full JID Format (Also Accepted):**
- Individual: '1234567890@s.whatsapp.net'
- Group: '123456789-1234567890@g.us'

Examples:
- ['1234567890', '9876543210'] - Private story for 2 contacts
- [] - Public story visible to all contacts`,
                                        example: [],
                                        default: []
                                    },
                                    send_to_own_device: {
                                        type: 'boolean',
                                        description: `Send status to your own device so it appears in your status list.

true = Status will appear on your own device
false (default) = Status won't appear on your own device

Useful for testing or keeping a copy on your device.`,
                                        example: false,
                                        default: false
                                    },
                                    canBeReshared: {
                                        type: 'boolean',
                                        description: `Control whether viewers can reshare/forward your status.

true (default) = Viewers can reshare your status to others
false = Viewers cannot reshare your status

This adds contextInfo.featureEligibilities.canBeReshared to the message.`,
                                        example: true,
                                        default: true
                                    }
                                }
                            },
                            examples: {
                                textStoryBasic: {
                                    summary: '1. Text Story - Basic (Public)',
                                    description: 'Simple text story visible to all contacts',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'text',
                                        content: 'Hello from Baileys API! 🎉'
                                    }
                                },
                                textStoryStyled: {
                                    summary: '2. Text Story - Styled (Public)',
                                    description: 'Text story with custom background color and font',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'text',
                                        content: 'Happy Friday Everyone! 🎊',
                                        backgroundColor: '#FF5733',
                                        font: 7,
                                        statusJidList: []
                                    }
                                },
                                textStoryAnnouncement: {
                                    summary: '3. Text Story - Announcement Style',
                                    description: 'Bold announcement with gold background',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'text',
                                        content: '🚨 IMPORTANT ANNOUNCEMENT 🚨\nNew product launching tomorrow!',
                                        backgroundColor: '#D4AC0D',
                                        font: 9
                                    }
                                },
                                textStoryPrivate: {
                                    summary: '4. Text Story - Private (Specific Contacts)',
                                    description: 'Text story visible only to selected contacts using phone numbers',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'text',
                                        content: 'Secret message for VIPs only! 🤫',
                                        backgroundColor: '#900C3F',
                                        font: 7,
                                        statusJidList: [
                                            '1234567890',
                                            '9876543210'
                                        ]
                                    }
                                },
                                textStoryOwnDevice: {
                                    summary: '5. Text Story - Send to Own Device',
                                    description: 'Text story that appears on your own device for testing',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'text',
                                        content: 'Testing my status! 🧪',
                                        backgroundColor: '#1F618D',
                                        font: 7,
                                        send_to_own_device: true
                                    }
                                },
                                imageStoryPublic: {
                                    summary: '6. Image Story - Public (All Contacts)',
                                    description: 'Image story from URL visible to everyone',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'image',
                                        content: 'https://example.com/image.jpg',
                                        caption: 'Beautiful sunset at the beach! 🌅',
                                        statusJidList: []
                                    }
                                },
                                imageStoryPrivate: {
                                    summary: '7. Image Story - Private (Selected Contacts)',
                                    description: 'Private image story for close friends using simple phone numbers',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'image',
                                        content: 'https://example.com/private.jpg',
                                        caption: 'Exclusive content for you! 💎',
                                        statusJidList: [
                                            '1234567890',
                                            '9876543210',
                                            '5555555555'
                                        ],
                                        send_to_own_device: true
                                    }
                                },
                                imageStoryLocal: {
                                    summary: '7. Image Story - Local File',
                                    description: 'Image from Docker volume /app/Media',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'image',
                                        content: '/app/Media/myimage.jpg',
                                        caption: 'Product showcase 🛍️'
                                    }
                                },
                                videoStoryPublic: {
                                    summary: '8. Video Story - Public',
                                    description: 'Video story visible to all contacts',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'video',
                                        content: 'https://example.com/video.mp4',
                                        caption: 'Check out my latest vlog! 🎬'
                                    }
                                },
                                videoStoryLocal: {
                                    summary: '9. Video Story - Local File',
                                    description: 'Video from Docker volume mounted at /app/Media',
                                    value: {
                                        sessionId: 'my-whatsapp',
                                        type: 'video',
                                        content: '/app/Media/myvideo.mp4',
                                        caption: 'Behind the scenes footage 🎥'
                                    }
                                },
                                videoStoryPrivate: {
                                    summary: '10. Video Story - Private (VIP Only)',
                                    description: 'Exclusive video for premium customers',
                                    value: {
                                        sessionId: 'business-account',
                                        type: 'video',
                                        content: '/app/Media/exclusive-preview.mp4',
                                        caption: '🎁 VIP EXCLUSIVE: New product preview!',
                                        statusJidList: [
                                            '1111111111@s.whatsapp.net',
                                            '2222222222@s.whatsapp.net',
                                            '3333333333@s.whatsapp.net'
                                        ]
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Story sent successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean'
                                        },
                                        messageId: {
                                            type: 'string'
                                        },
                                        message: {
                                            type: 'string'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Bad request or session not connected'
                    },
                    '500': {
                        description: 'Server error'
                    }
                }
            }
        },
        '/story/text': {
            post: {
                tags: ['Stories'],
                summary: 'Send a text status',
                description: 'Send a text-only WhatsApp status with optional styling',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'text'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    text: { type: 'string', example: 'Hello World! 🌟' },
                                    backgroundColor: { type: 'string', example: '#FF5733' },
                                    font: { type: 'number', example: 7, minimum: 0, maximum: 10 },
                                    statusJidList: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Empty = all contacts, phone numbers = private (e.g., ["1234567890", "9876543210"])'
                                    },
                                    send_to_own_device: {
                                        type: 'boolean',
                                        default: false,
                                        example: true,
                                        description: 'Send status to your own device'
                                    },
                                    send_to_all_contacts: {
                                        type: 'boolean',
                                        default: false,
                                        example: false,
                                        description: 'Force send to all contacts (ignores statusJidList)'
                                    },
                                    list: {
                                        type: 'string',
                                        example: 'VIP_Customers',
                                        description: 'Send to a specific contact list/group. Use GET /lists to see available lists.'
                                    },
                                    canBeReshared: { type: 'boolean', default: true, example: true, description: 'Allow recipients to reshare/forward this status. Set to false for exclusive/private content.' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Text status sent successfully' },
                    '400': { description: 'Bad request or session not connected' },
                    '500': { description: 'Server error' }
                }
            }
        },
        '/story/image': {
            post: {
                tags: ['Stories'],
                summary: 'Send an image status',
                description: 'Send an image WhatsApp status. Provide image via URL, base64 data, or file path.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    url: {
                                        type: 'string',
                                        example: 'https://example.com/image.jpg',
                                        description: 'Image URL (use url OR data OR file)'
                                    },
                                    data: {
                                        type: 'string',
                                        description: 'Base64-encoded image data (use url OR data OR file)'
                                    },
                                    file: {
                                        type: 'string',
                                        example: '/app/Media/image.jpg',
                                        description: 'Local file path (use url OR data OR file)'
                                    },
                                    caption: { type: 'string', example: 'Check this out! 📸' },
                                    statusJidList: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Empty = all contacts, phone numbers = private (e.g., ["1234567890", "9876543210"])'
                                    },
                                    send_to_own_device: {
                                        type: 'boolean',
                                        default: false,
                                        example: true,
                                        description: 'Send status to your own device'
                                    },
                                    send_to_all_contacts: {
                                        type: 'boolean',
                                        default: false,
                                        example: false,
                                        description: 'Force send to all contacts (ignores statusJidList)'
                                    },
                                    list: {
                                        type: 'string',
                                        example: 'VIP_Customers',
                                        description: 'Send to a specific contact list/group. Use GET /lists to see available lists.'
                                    },
                                    canBeReshared: { type: 'boolean', default: true, example: true, description: 'Allow recipients to reshare/forward this status. Set to false for exclusive/private content.' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Image status sent successfully' },
                    '400': { description: 'Bad request or session not connected' },
                    '500': { description: 'Server error' }
                }
            }
        },
        '/story/video': {
            post: {
                tags: ['Stories'],
                summary: 'Send a video status',
                description: 'Send a video WhatsApp status. Provide video via URL, base64 data, or file path.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    url: {
                                        type: 'string',
                                        example: 'https://example.com/video.mp4',
                                        description: 'Video URL (use url OR data OR file)'
                                    },
                                    data: {
                                        type: 'string',
                                        description: 'Base64-encoded video data (use url OR data OR file)'
                                    },
                                    file: {
                                        type: 'string',
                                        example: '/app/Media/video.mp4',
                                        description: 'Local file path (use url OR data OR file)'
                                    },
                                    caption: { type: 'string', example: 'Amazing video! 🎥' },
                                    statusJidList: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Empty = all contacts, phone numbers = private (e.g., ["1234567890", "9876543210"])'
                                    },
                                    send_to_own_device: {
                                        type: 'boolean',
                                        default: false,
                                        example: true,
                                        description: 'Send status to your own device'
                                    },
                                    send_to_all_contacts: {
                                        type: 'boolean',
                                        default: false,
                                        example: false,
                                        description: 'Force send to all contacts (ignores statusJidList)'
                                    },
                                    list: {
                                        type: 'string',
                                        example: 'VIP_Customers',
                                        description: 'Send to a specific contact list/group. Use GET /lists to see available lists.'
                                    },
                                    canBeReshared: { type: 'boolean', default: true, example: true, description: 'Allow recipients to reshare/forward this status. Set to false for exclusive/private content.' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Video status sent successfully' },
                    '400': { description: 'Bad request or session not connected' },
                    '500': { description: 'Server error' }
                }
            }
        },
        '/story/audio': {
            post: {
                tags: ['Stories'],
                summary: 'Send an audio status',
                description: 'Send an audio WhatsApp status. Provide audio via URL, base64 data, or file path.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    url: {
                                        type: 'string',
                                        example: 'https://example.com/audio.mp3',
                                        description: 'Audio URL (use url OR data OR file)'
                                    },
                                    data: {
                                        type: 'string',
                                        description: 'Base64-encoded audio data (use url OR data OR file)'
                                    },
                                    file: {
                                        type: 'string',
                                        example: '/app/Media/audio.mp3',
                                        description: 'Local file path (use url OR data OR file)'
                                    },
                                    statusJidList: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Empty = all contacts, phone numbers = private (e.g., ["1234567890", "9876543210"])'
                                    },
                                    send_to_own_device: {
                                        type: 'boolean',
                                        default: false,
                                        example: true,
                                        description: 'Send status to your own device'
                                    },
                                    send_to_all_contacts: {
                                        type: 'boolean',
                                        default: false,
                                        example: false,
                                        description: 'Force send to all contacts (ignores statusJidList)'
                                    },
                                    list: {
                                        type: 'string',
                                        example: 'VIP_Customers',
                                        description: 'Send to a specific contact list/group. Use GET /lists to see available lists.'
                                    },
                                    canBeReshared: { type: 'boolean', default: true, example: true, description: 'Allow recipients to reshare/forward this status. Set to false for exclusive/private content.' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Audio status sent successfully' },
                    '400': { description: 'Bad request or session not connected' },
                    '500': { description: 'Server error' }
                }
            }
        },
        '/story/{storyId}/resend': {
            post: {
                tags: ['Stories'],
                summary: 'Resend an existing story to different contacts',
                description: `Resend a previously sent story to a new set of contacts (or all contacts).

**🧪 EXPERIMENTAL: Message ID Reuse**
This endpoint attempts to reuse the original message ID when resending. If successful, all views should accumulate on the same story (like WAHA). Check the \`reusedMessageId\` field in the response to see if it worked.

**Use Cases:**
- Send same story to everyone first, then resend privately to VIPs
- Post to close friends first, then make public later
- A/B testing with different audience groups
- Gradual rollout to different contact segments
- Accumulate views on a single story across multiple sends

**How it works:**
1. Create a story using /story/create and get the storyId
2. Use this endpoint with the storyId in URL and new statusJidList in body
3. The API attempts to send with the same message ID
4. If successful (reusedMessageId=true), views accumulate on the same story
5. If failed (reusedMessageId=false), a new story post is created

**Note:** Message ID reuse is experimental and depends on WhatsApp's protocol accepting it.`,
                parameters: [
                    {
                        name: 'storyId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'The storyId returned from /story/create',
                        example: 'story_1234567890_abc123def'
                    }
                ],
                requestBody: {
                    required: false,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    statusJidList: {
                                        type: 'array',
                                        items: {
                                            type: 'string'
                                        },
                                        description: 'New privacy list for this resend ([] = all contacts, or phone numbers like ["1234567890", "9876543210"]). If not provided, defaults to empty array (all contacts).',
                                        example: []
                                    },
                                    send_to_own_device: {
                                        type: 'boolean',
                                        default: false,
                                        example: true,
                                        description: 'Send resent status to your own device'
                                    }
                                }
                            },
                            examples: {
                                resendToAll: {
                                    summary: '1. Resend to Everyone',
                                    description: 'Make a private story public',
                                    value: {
                                        statusJidList: []
                                    }
                                },
                                resendToVIPs: {
                                    summary: '2. Resend to VIP Customers',
                                    description: 'Send public story again to premium contacts',
                                    value: {
                                        statusJidList: [
                                            '1111111111',
                                            '2222222222'
                                        ]
                                    }
                                },
                                resendDifferentGroup: {
                                    summary: '3. Send to Different Friend Group',
                                    description: 'Resend to a completely different set of contacts',
                                    value: {
                                        statusJidList: [
                                            '5555555555',
                                            '6666666666',
                                            '7777777777'
                                        ]
                                    }
                                },
                                resendToOwnDevice: {
                                    summary: '4. Resend to Own Device Only',
                                    description: 'Send story copy to your own device for testing',
                                    value: {
                                        send_to_own_device: true,
                                        statusJidList: []
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Story resent successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean',
                                            example: true
                                        },
                                        storyId: {
                                            type: 'string',
                                            example: 'story_1234567890_abc123def'
                                        },
                                        messageId: {
                                            type: 'string',
                                            description: 'WhatsApp message ID for this resend',
                                            example: '3EB0123456789ABCDEF'
                                        },
                                        originalMessageId: {
                                            type: 'string',
                                            description: 'Original message ID from first send',
                                            example: '3EB0123456789ABCDEF'
                                        },
                                        reusedMessageId: {
                                            type: 'boolean',
                                            description: 'Whether the original message ID was successfully reused (true = views accumulate, false = separate story)',
                                            example: true
                                        },
                                        totalSends: {
                                            type: 'number',
                                            description: 'Total number of times this story has been sent (including original)',
                                            example: 2
                                        },
                                        message: {
                                            type: 'string',
                                            description: 'Status message indicating if message ID was reused',
                                            example: 'Story resent with same message ID - views should accumulate'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Story not found'
                    },
                    '400': {
                        description: 'Session not connected or invalid request'
                    }
                }
            }
        },
        '/story/{storyId}': {
            get: {
                tags: ['Stories'],
                summary: 'Get story details',
                description: 'Retrieve detailed information about a story including all sends and their privacy settings',
                parameters: [
                    {
                        name: 'storyId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'Story identifier'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Story details',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        storyId: {
                                            type: 'string'
                                        },
                                        sessionId: {
                                            type: 'string'
                                        },
                                        type: {
                                            type: 'string',
                                            enum: ['text', 'image', 'video']
                                        },
                                        content: {
                                            type: 'string'
                                        },
                                        caption: {
                                            type: 'string'
                                        },
                                        backgroundColor: {
                                            type: 'string'
                                        },
                                        font: {
                                            type: 'number'
                                        },
                                        totalSends: {
                                            type: 'number',
                                            description: 'Number of times sent'
                                        },
                                        sends: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    messageId: {
                                                        type: 'string'
                                                    },
                                                    statusJidList: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'string'
                                                        }
                                                    },
                                                    timestamp: {
                                                        type: 'string',
                                                        format: 'date-time'
                                                    }
                                                }
                                            }
                                        },
                                        createdAt: {
                                            type: 'string',
                                            format: 'date-time'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Story not found'
                    }
                }
            },
            delete: {
                tags: ['Stories'],
                summary: 'Delete a story from history',
                description: `Delete a story from the API's tracking history.

**Important Notes:**
- This only removes the story from the API's internal database
- It does NOT delete the story from WhatsApp
- WhatsApp status posts remain visible for their full 24-hour duration
- This is useful for cleaning up your story history and preventing future resends
- Once deleted, the storyId can no longer be used with /story/{storyId}/resend

**Use Cases:**
- Clean up old story records
- Prevent accidental resends of outdated content
- Manage storage/memory in the API
- Remove sensitive story data from API history`,
                parameters: [
                    {
                        name: 'storyId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'Story identifier to delete'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Story deleted successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean',
                                            example: true
                                        },
                                        message: {
                                            type: 'string',
                                            example: 'Story deleted from history'
                                        },
                                        storyId: {
                                            type: 'string',
                                            example: 'story_1234567890_abc123def'
                                        },
                                        note: {
                                            type: 'string',
                                            example: 'Story removed from API history. WhatsApp status posts remain visible for 24 hours.'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Story not found'
                    }
                }
            }
        },
        '/story/{storyId}/fetch-views': {
            post: {
                tags: ['Stories'],
                summary: 'Fetch story views from WhatsApp history',
                description: 'Retrieves story view data directly from WhatsApp servers and stores it locally. Works even after reconnection. Future calls return cached data unless force=true. Live views are automatically merged with historical data.',
                parameters: [
                    {
                        name: 'storyId',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        },
                        description: 'The story ID to fetch views for',
                        example: 'story_1234567890_abc123def'
                    }
                ],
                requestBody: {
                    description: 'Optional parameters',
                    required: false,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    force: {
                                        type: 'boolean',
                                        description: 'Force re-fetch from WhatsApp even if already cached',
                                        default: false,
                                        example: false
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Story views fetched successfully from WhatsApp',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean',
                                            example: true
                                        },
                                        storyId: {
                                            type: 'string',
                                            example: 'story_1234567890_abc123def'
                                        },
                                        source: {
                                            type: 'string',
                                            example: 'whatsapp-history'
                                        },
                                        totalViews: {
                                            type: 'number',
                                            example: 15
                                        },
                                        views: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    viewer: {
                                                        type: 'string',
                                                        example: '1234567890@s.whatsapp.net'
                                                    },
                                                    deliveredAt: {
                                                        type: 'string',
                                                        format: 'date-time',
                                                        example: '2025-10-23T10:30:00.000Z'
                                                    },
                                                    viewedAt: {
                                                        type: 'string',
                                                        format: 'date-time',
                                                        example: '2025-10-23T10:35:00.000Z'
                                                    },
                                                    playedAt: {
                                                        type: 'string',
                                                        format: 'date-time',
                                                        example: '2025-10-23T10:35:05.000Z'
                                                    }
                                                }
                                            }
                                        },
                                        viewersList: {
                                            type: 'array',
                                            items: {
                                                type: 'string'
                                            },
                                            example: ['1234567890@s.whatsapp.net', '9876543210@s.whatsapp.net']
                                        },
                                        viewsBreakdown: {
                                            type: 'object',
                                            properties: {
                                                delivered: {
                                                    type: 'number',
                                                    example: 15
                                                },
                                                viewed: {
                                                    type: 'number',
                                                    example: 12
                                                },
                                                played: {
                                                    type: 'number',
                                                    example: 8
                                                }
                                            }
                                        },
                                        note: {
                                            type: 'string',
                                            example: 'Views fetched from WhatsApp and stored locally. Future live views will be automatically merged with this data.'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Session not connected or story missing required data'
                    },
                    '404': {
                        description: 'Story not found'
                    },
                    '500': {
                        description: 'Error fetching views from WhatsApp'
                    }
                }
            }
        },
        '/stories/sync': {
            post: {
                tags: ['Stories'],
                summary: 'Sync stories from WhatsApp history',
                description: 'Fetches your stories from WhatsApp status@broadcast history and populates them with view data. Use this after a restart to recover your stories from WhatsApp servers.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId'],
                                properties: {
                                    sessionId: {
                                        type: 'string',
                                        description: 'WhatsApp session ID',
                                        example: 'test1'
                                    },
                                    count: {
                                        type: 'number',
                                        description: 'Number of stories to fetch (default: 50)',
                                        example: 50,
                                        default: 50
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Stories synced successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean',
                                            example: true
                                        },
                                        sessionId: {
                                            type: 'string',
                                            example: 'test1'
                                        },
                                        syncedCount: {
                                            type: 'number',
                                            description: 'Number of stories synced',
                                            example: 15
                                        },
                                        totalFetched: {
                                            type: 'number',
                                            description: 'Total messages fetched from status@broadcast',
                                            example: 15
                                        },
                                        stories: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    storyId: {
                                                        type: 'string',
                                                        example: 'story_synced_3EB0123ABC'
                                                    },
                                                    type: {
                                                        type: 'string',
                                                        example: 'text'
                                                    },
                                                    content: {
                                                        type: 'string',
                                                        example: 'Hello World!'
                                                    },
                                                    views: {
                                                        type: 'number',
                                                        example: 12
                                                    },
                                                    timestamp: {
                                                        type: 'string',
                                                        format: 'date-time',
                                                        example: '2025-10-23T10:00:00.000Z'
                                                    }
                                                }
                                            }
                                        },
                                        message: {
                                            type: 'string',
                                            example: 'Synced 15 stories from WhatsApp'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Session not connected or invalid request'
                    },
                    '500': {
                        description: 'Error syncing stories'
                    }
                }
            }
        },
        '/stories': {
            get: {
                tags: ['Stories'],
                summary: 'List all stories with view statistics',
                description: 'Get a list of all sent stories with view counts and data source information. Shows whether views are from live events only or merged with historical data from WhatsApp.',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: false,
                        schema: {
                            type: 'string'
                        },
                        description: 'Filter stories by session ID'
                    }
                ],
                responses: {
                    '200': {
                        description: 'List of stories with view statistics',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        stories: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    storyId: {
                                                        type: 'string',
                                                        example: 'story_1234567890_abc123def'
                                                    },
                                                    sessionId: {
                                                        type: 'string',
                                                        example: 'my-whatsapp'
                                                    },
                                                    type: {
                                                        type: 'string',
                                                        enum: ['text', 'image', 'video'],
                                                        example: 'text'
                                                    },
                                                    content: {
                                                        type: 'string',
                                                        description: 'First 100 characters of content',
                                                        example: 'Hello World! This is my story...'
                                                    },
                                                    totalSends: {
                                                        type: 'number',
                                                        example: 1
                                                    },
                                                    createdAt: {
                                                        type: 'string',
                                                        format: 'date-time',
                                                        example: '2025-10-23T10:00:00.000Z'
                                                    },
                                                    views: {
                                                        type: 'object',
                                                        properties: {
                                                            total: {
                                                                type: 'number',
                                                                description: 'Total number of unique viewers',
                                                                example: 18
                                                            },
                                                            delivered: {
                                                                type: 'number',
                                                                description: 'Number of viewers who received the story',
                                                                example: 18
                                                            },
                                                            viewed: {
                                                                type: 'number',
                                                                description: 'Number of viewers who opened/read the story',
                                                                example: 15
                                                            },
                                                            played: {
                                                                type: 'number',
                                                                description: 'Number of viewers who played video (for video stories)',
                                                                example: 10
                                                            },
                                                            dataSource: {
                                                                type: 'string',
                                                                enum: ['live-only', 'historical+live'],
                                                                description: 'Indicates if views are from live events only or merged with WhatsApp history',
                                                                example: 'historical+live'
                                                            },
                                                            viewsFetchedFromHistory: {
                                                                type: 'boolean',
                                                                description: 'True if views were fetched from WhatsApp history using /fetch-views',
                                                                example: true
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/message/send': {
            post: {
                tags: ['Messages'],
                summary: 'Send a regular message',
                description: 'Send a text, image, or video message to a contact or group',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'to', 'type', 'content'],
                                properties: {
                                    sessionId: {
                                        type: 'string',
                                        example: 'my-whatsapp'
                                    },
                                    to: {
                                        type: 'string',
                                        description: 'WhatsApp JID (1234567890@s.whatsapp.net for individual, 123-456@g.us for group)',
                                        example: '1234567890@s.whatsapp.net'
                                    },
                                    type: {
                                        type: 'string',
                                        enum: ['text', 'image', 'video'],
                                        example: 'text'
                                    },
                                    content: {
                                        type: 'string',
                                        description: 'Message text or URL/path to media',
                                        example: 'Hello!'
                                    },
                                    caption: {
                                        type: 'string',
                                        description: 'Caption for media messages'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Message sent',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: {
                                            type: 'boolean'
                                        },
                                        messageId: {
                                            type: 'string'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Bad request'
                    }
                }
            }
        },
        '/contacts/{contactId}': {
            delete: {
                tags: ['Contacts'],
                summary: 'Delete a contact',
                description: 'Remove a contact from your contact list',
                parameters: [
                    {
                        name: 'contactId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Contact phone number or JID (e.g., "1234567890" or "1234567890@s.whatsapp.net")'
                    },
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        example: 'test1'
                    }
                ],
                responses: {
                    '200': { description: 'Contact deleted successfully' },
                    '400': { description: 'Bad request' },
                    '404': { description: 'Session not found' }
                }
            }
        },
        '/contacts/status-recipients': {
            get: {
                tags: ['Default Recipients'],
                summary: 'Get default status recipients',
                description: 'Get the list of contacts who automatically receive every status you send',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        example: 'test1'
                    }
                ],
                responses: {
                    '200': { description: 'Default recipients retrieved' },
                    '400': { description: 'Bad request' }
                }
            },
            delete: {
                tags: ['Default Recipients'],
                summary: 'Clear all default status recipients',
                description: 'Remove all contacts from the default recipients list',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        example: 'test1'
                    }
                ],
                responses: {
                    '200': { description: 'Default recipients cleared' },
                    '400': { description: 'Bad request' }
                }
            }
        },
        '/contacts/status-recipients/add': {
            post: {
                tags: ['Default Recipients'],
                summary: 'Add default status recipients',
                description: 'Add contacts who will automatically receive every status you send (permanent broadcast list)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'recipients'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    recipients: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Phone numbers or JIDs to add as default recipients'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Recipients added successfully' },
                    '400': { description: 'Bad request' }
                }
            }
        },
        '/contacts/status-recipients/remove': {
            post: {
                tags: ['Default Recipients'],
                summary: 'Remove default status recipients',
                description: 'Remove contacts from the default recipients list',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'recipients'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    recipients: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Phone numbers or JIDs to remove'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Recipients removed successfully' },
                    '400': { description: 'Bad request' }
                }
            }
        },
        '/lists': {
            get: {
                tags: ['Lists'],
                summary: 'Get all contact lists',
                description: 'Get all contact lists/groups for targeted status sending',
                parameters: [
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        example: 'test1'
                    }
                ],
                responses: {
                    '200': { description: 'Lists retrieved successfully' },
                    '400': { description: 'Bad request' }
                }
            }
        },
        '/lists/create': {
            post: {
                tags: ['Lists'],
                summary: 'Create a new contact list',
                description: 'Create a new contact list/group for targeted status sending (e.g., VIP customers, regular customers)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'listName'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    listName: { type: 'string', example: 'VIP_Customers', description: 'Name of the list (no spaces recommended)' },
                                    contacts: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1234567890', '9876543210'],
                                        description: 'Initial contacts for the list (optional)'
                                    }
                                }
                            },
                            examples: {
                                createEmpty: {
                                    summary: 'Create empty list',
                                    value: {
                                        sessionId: 'test1',
                                        listName: 'VIP_Customers'
                                    }
                                },
                                createWithContacts: {
                                    summary: 'Create list with contacts',
                                    value: {
                                        sessionId: 'test1',
                                        listName: 'VIP_Customers',
                                        contacts: ['1234567890', '9876543210', '5555555555']
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'List created successfully' },
                    '400': { description: 'Bad request or list already exists' }
                }
            }
        },
        '/lists/{listName}': {
            delete: {
                tags: ['Lists'],
                summary: 'Delete a contact list',
                description: 'Delete a contact list and all its contacts',
                parameters: [
                    {
                        name: 'listName',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        example: 'VIP_Customers'
                    },
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        example: 'test1'
                    }
                ],
                responses: {
                    '200': { description: 'List deleted successfully' },
                    '404': { description: 'List not found' }
                }
            }
        },
        '/lists/{listName}/contacts': {
            get: {
                tags: ['Lists'],
                summary: 'Get contacts in a list',
                description: 'Get all contacts in a specific list',
                parameters: [
                    {
                        name: 'listName',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        example: 'VIP_Customers'
                    },
                    {
                        name: 'sessionId',
                        in: 'query',
                        required: true,
                        schema: { type: 'string' },
                        example: 'test1'
                    }
                ],
                responses: {
                    '200': { description: 'Contacts retrieved successfully' },
                    '404': { description: 'List not found' }
                }
            }
        },
        '/lists/{listName}/contacts/add': {
            post: {
                tags: ['Lists'],
                summary: 'Add contacts to a list',
                description: 'Add contacts to an existing list',
                parameters: [
                    {
                        name: 'listName',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        example: 'VIP_Customers'
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'contacts'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    contacts: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1111111111', '2222222222'],
                                        description: 'Phone numbers or JIDs to add'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Contacts added successfully' },
                    '404': { description: 'List not found' }
                }
            }
        },
        '/lists/{listName}/contacts/remove': {
            post: {
                tags: ['Lists'],
                summary: 'Remove contacts from a list',
                description: 'Remove contacts from an existing list',
                parameters: [
                    {
                        name: 'listName',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        example: 'VIP_Customers'
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['sessionId', 'contacts'],
                                properties: {
                                    sessionId: { type: 'string', example: 'test1' },
                                    contacts: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['1111111111', '2222222222'],
                                        description: 'Phone numbers or JIDs to remove'
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Contacts removed successfully' },
                    '404': { description: 'List not found' }
                }
            }
        }
    },
    components: {
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    error: {
                        type: 'string'
                    }
                }
            }
        }
    }
}
