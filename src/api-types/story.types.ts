export type StoryData = {
    storyId: string,
    sessionId: string,
    type: 'text' | 'image' | 'video' | 'audio',
    content: string,
    caption?: string,
    backgroundColor?: string,
    font?: number,
    canBeReshared?: boolean,
    messageIds: string[],
    messageKey?: any,
    messageTimestamp?: number,
    sends: Array<{
        messageId: string,
        statusJidList: string[],
        timestamp: Date,
        reusedMessageId?: boolean
    }>,
    createdAt: Date,
    viewsFetchedFromHistory?: boolean,
    deletedFromWhatsapp?: boolean
}

export type StoryView = {
    viewer: string,
    viewerName?: string,
    deliveredAt?: Date,
    viewedAt?: Date,
    playedAt?: Date
}

export type StoryLike = {
    liker: string,
    likerName?: string,
    timestamp: Date
}

export type StoryReaction = {
    reactor: string,
    reactorName?: string,
    emoji: string,
    timestamp: Date
}

export type StoryReply = {
    replier: string,
    replierName?: string,
    message: string,
    timestamp: Date
}

export interface StatusQueueItem {
    type: 'text' | 'image' | 'video' | 'audio' | 'image-with-question'
    data: any
    resolve: (value: any) => void
    reject: (error: any) => void
    retries: number
    maxRetries: number
}
