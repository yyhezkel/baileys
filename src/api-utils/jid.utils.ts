/**
 * Normalize a phone number or existing JID to proper JID format
 * @param input - Phone number or JID
 * @returns Normalized JID (e.g., "1234567890@s.whatsapp.net")
 */
export function normalizeJid(input: string): string {
    // If already a JID (contains @), return as-is
    if (input.includes('@')) {
        return input
    }
    // Otherwise, treat as phone number and add @s.whatsapp.net
    return `${input}@s.whatsapp.net`
}

/**
 * Clean phone number by removing non-digits
 * @param phone - Raw phone number
 * @returns Cleaned phone number with only digits
 */
export function cleanPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, '')
}

/**
 * Convert phone number to JID
 * @param phone - Phone number (can contain non-digit characters)
 * @returns JID format (e.g., "1234567890@s.whatsapp.net")
 */
export function phoneToJid(phone: string): string {
    const cleanPhone = cleanPhoneNumber(phone)
    return `${cleanPhone}@s.whatsapp.net`
}

/**
 * Check if a JID is an individual contact (not group, broadcast, etc.)
 * @param jid - JID to check
 * @returns True if individual contact
 */
export function isIndividualJid(jid: string): boolean {
    return jid.endsWith('@s.whatsapp.net')
}

/**
 * Check if a JID is a group
 * @param jid - JID to check
 * @returns True if group
 */
export function isGroupJid(jid: string): boolean {
    return jid.endsWith('@g.us')
}

/**
 * Extract phone number from JID
 * @param jid - JID (e.g., "1234567890@s.whatsapp.net")
 * @returns Phone number
 */
export function jidToPhone(jid: string): string {
    return jid.split('@')[0]?.split(':')[0] || jid
}
