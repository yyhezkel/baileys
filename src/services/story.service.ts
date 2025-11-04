import type { StoryData, StoryView, StoryLike, StoryReaction, StoryReply } from '../api-types/index.js'
import { logger } from '../api-utils/logger.js'
import { isIndividualJid } from '../api-utils/jid.utils.js'

// Store sent stories for resending
const stories = new Map<string, StoryData>()

// Store story views (messageId -> array of views)
const storyViews = new Map<string, StoryView[]>()

// Store story likes (messageId -> array of likes) - the 💚 status like button
const storyLikes = new Map<string, StoryLike[]>()

// Store story reactions (messageId -> array of reactions) - the 8 quick emoji reactions
const storyReactions = new Map<string, StoryReaction[]>()

// Store story text replies (messageId -> array of replies)
const storyReplies = new Map<string, StoryReply[]>()

// Store the most recent status message key per session (for fetchMessageHistory anchor)
const statusMessageAnchors = new Map<string, { key: any, timestamp: any, fromMe: boolean, updatedAt: Date }>()

// Store message anchors from all chats (for fetchMessageHistory)
// Key format: "sessionId:chatJid" -> { key, timestamp, fromMe }
const chatMessageAnchors = new Map<string, { key: any, timestamp: any, fromMe: boolean, updatedAt: Date }>()

/**
 * Get all stories
 */
export function getAllStories(): Map<string, StoryData> {
    return stories
}

/**
 * Get story by ID
 */
export function getStory(storyId: string): StoryData | undefined {
    return stories.get(storyId)
}

/**
 * Set story
 */
export function setStory(storyId: string, storyData: StoryData): void {
    stories.set(storyId, storyData)
}

/**
 * Delete story
 */
export function deleteStory(storyId: string): void {
    stories.delete(storyId)
}

/**
 * Get stories by session
 */
export function getStoriesBySession(sessionId: string): StoryData[] {
    const sessionStories: StoryData[] = []
    stories.forEach((story) => {
        if (story.sessionId === sessionId) {
            sessionStories.push(story)
        }
    })
    return sessionStories
}

/**
 * Get story views
 */
export function getStoryViews(messageId: string): StoryView[] {
    return storyViews.get(messageId) || []
}

/**
 * Add story view
 */
export function addStoryView(messageId: string, view: StoryView): void {
    if (!storyViews.has(messageId)) {
        storyViews.set(messageId, [])
    }
    storyViews.get(messageId)!.push(view)
}

/**
 * Set story views
 */
export function setStoryViews(messageId: string, views: StoryView[]): void {
    storyViews.set(messageId, views)
}

/**
 * Get story likes
 */
export function getStoryLikes(messageId: string): StoryLike[] {
    return storyLikes.get(messageId) || []
}

/**
 * Add story like
 */
export function addStoryLike(messageId: string, like: StoryLike): void {
    if (!storyLikes.has(messageId)) {
        storyLikes.set(messageId, [])
    }
    storyLikes.get(messageId)!.push(like)
}

/**
 * Get story reactions
 */
export function getStoryReactions(messageId: string): StoryReaction[] {
    return storyReactions.get(messageId) || []
}

/**
 * Add story reaction
 */
export function addStoryReaction(messageId: string, reaction: StoryReaction): void {
    if (!storyReactions.has(messageId)) {
        storyReactions.set(messageId, [])
    }
    storyReactions.get(messageId)!.push(reaction)
}

/**
 * Get story replies
 */
export function getStoryReplies(messageId: string): StoryReply[] {
    return storyReplies.get(messageId) || []
}

/**
 * Add story reply
 */
export function addStoryReply(messageId: string, reply: StoryReply): void {
    if (!storyReplies.has(messageId)) {
        storyReplies.set(messageId, [])
    }
    storyReplies.get(messageId)!.push(reply)
}

/**
 * Get status message anchor for session
 */
export function getStatusMessageAnchor(sessionId: string): { key: any, timestamp: any, fromMe: boolean, updatedAt: Date } | undefined {
    return statusMessageAnchors.get(sessionId)
}

/**
 * Set status message anchor
 */
export function setStatusMessageAnchor(sessionId: string, anchor: { key: any, timestamp: any, fromMe: boolean, updatedAt: Date }): void {
    statusMessageAnchors.set(sessionId, anchor)
}

/**
 * Get chat message anchor
 */
export function getChatMessageAnchor(sessionId: string, chatJid: string): { key: any, timestamp: any, fromMe: boolean, updatedAt: Date } | undefined {
    const key = `${sessionId}:${chatJid}`
    return chatMessageAnchors.get(key)
}

/**
 * Set chat message anchor
 */
export function setChatMessageAnchor(sessionId: string, chatJid: string, anchor: { key: any, timestamp: any, fromMe: boolean, updatedAt: Date }): void {
    const key = `${sessionId}:${chatJid}`
    chatMessageAnchors.set(key, anchor)
}

/**
 * Process status JID list - convert phone numbers to JIDs and handle special cases
 */
export function processStatusJidList(
    statusJidList: string[] | undefined | null,
    sendToOwnDevice: boolean | undefined,
    sendToAllContacts: boolean | undefined,
    accountPhoneNumber: string | undefined,
    contacts: Map<string, any>,
    contactLists: Map<string, Map<string, string[]>>,
    defaultStatusRecipients: Map<string, string[]>,
    includeDefaultRecipients: boolean = true,
    listName?: string
): string[] {
    let jidList: string[] = []

    // If listName is provided, use that list
    if (listName && accountPhoneNumber) {
        const lists = contactLists.get(accountPhoneNumber)
        if (lists && lists.has(listName)) {
            jidList = [...lists.get(listName)!]
            logger.info({ accountPhoneNumber, listName, contacts: jidList.length }, 'Sending status to contact list')
        } else {
            logger.warn({ accountPhoneNumber, listName }, 'Contact list not found')
        }
    }
    // If send_to_all_contacts is explicitly true OR statusJidList is null/undefined, get all contacts
    else if ((sendToAllContacts || statusJidList === null || statusJidList === undefined) && accountPhoneNumber) {
        const accountPrefix = `${accountPhoneNumber}:`
        contacts.forEach((contact, key) => {
            if (key.startsWith(accountPrefix)) {
                // Only include individual contacts with proper phone numbers
                if (isIndividualJid(contact.jid)) {
                    // Additional filter: only include if contact has a name or notify
                    if (contact.name || contact.notify) {
                        jidList.push(contact.jid)
                    }
                }
            }
        })

        logger.info({ accountPhoneNumber, totalContacts: jidList.length, totalInMemory: contacts.size }, 'Sending status to filtered contacts')
    }
    // If statusJidList is an empty array [], send to nobody (explicit empty list)
    else if (statusJidList && statusJidList.length === 0) {
        logger.info({ accountPhoneNumber }, 'Sending status to nobody (empty statusJidList)')
    }
    // Otherwise, process statusJidList - convert plain phone numbers to JIDs
    else if (statusJidList && statusJidList.length > 0) {
        jidList = statusJidList.map(item => {
            // If already a JID (contains @), use as-is
            if (item.includes('@')) {
                return item
            }
            // Otherwise, treat as phone number and add @s.whatsapp.net
            return `${item}@s.whatsapp.net`
        })
    }

    // Add default status recipients (if enabled and account has them)
    if (includeDefaultRecipients && accountPhoneNumber) {
        const defaultRecipients = defaultStatusRecipients.get(accountPhoneNumber) || []
        if (defaultRecipients.length > 0) {
            // Add default recipients, avoiding duplicates
            defaultRecipients.forEach(jid => {
                if (!jidList.includes(jid)) {
                    jidList.push(jid)
                }
            })
            logger.info({
                accountPhoneNumber,
                defaultRecipientsAdded: defaultRecipients.length,
                totalRecipients: jidList.length
            }, 'Added default status recipients')
        }
    }

    // Add own device if requested (insert at beginning)
    if (sendToOwnDevice && accountPhoneNumber) {
        const ownJid = `${accountPhoneNumber}@s.whatsapp.net`
        if (!jidList.includes(ownJid)) {
            jidList.unshift(ownJid)
        }
    }

    return jidList
}

/**
 * Clear all story data for a session
 */
export function clearStoryDataForSession(sessionId: string): void {
    // Clear stories
    const storiesToDelete: string[] = []
    stories.forEach((story, storyId) => {
        if (story.sessionId === sessionId) {
            storiesToDelete.push(storyId)
        }
    })
    storiesToDelete.forEach(storyId => stories.delete(storyId))

    // Clear anchors
    statusMessageAnchors.delete(sessionId)

    // Clear chat anchors for this session
    const chatAnchorsToDelete: string[] = []
    chatMessageAnchors.forEach((_, key) => {
        if (key.startsWith(`${sessionId}:`)) {
            chatAnchorsToDelete.push(key)
        }
    })
    chatAnchorsToDelete.forEach(key => chatMessageAnchors.delete(key))

    logger.info({ sessionId }, 'Cleared story data for session')
}
