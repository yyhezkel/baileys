import fs from 'fs'
import path from 'path'
import type { Contact } from '../api-types/index.js'
import { logger } from '../api-utils/logger.js'
import { isIndividualJid } from '../api-utils/jid.utils.js'

// Store contacts per session
// Key format: "accountPhoneNumber:jid" -> contact data
const contacts = new Map<string, Contact>()

// Contact lists (groups) per account
// Key: accountPhoneNumber, Value: Map of listName -> array of JIDs
const contactLists = new Map<string, Map<string, string[]>>()

// Default status recipients per account
const defaultStatusRecipients = new Map<string, string[]>()

// Contacts directory for persistent storage
const CONTACTS_DIR = './contacts-storage'

// Initialize contacts storage directory
if (!fs.existsSync(CONTACTS_DIR)) {
    fs.mkdirSync(CONTACTS_DIR, { recursive: true })
}

/**
 * Get all contacts
 */
export function getAllContacts(): Map<string, Contact> {
    return contacts
}

/**
 * Get contacts for specific account
 */
export function getContactsByAccount(accountPhoneNumber: string): Contact[] {
    const accountPrefix = `${accountPhoneNumber}:`
    const accountContacts: Contact[] = []

    contacts.forEach((contact, key) => {
        if (key.startsWith(accountPrefix)) {
            accountContacts.push(contact)
        }
    })

    return accountContacts
}

/**
 * Get individual contacts for specific account (exclude groups, broadcasts, etc.)
 */
export function getIndividualContactsByAccount(accountPhoneNumber: string): Contact[] {
    return getContactsByAccount(accountPhoneNumber).filter(contact =>
        isIndividualJid(contact.jid) && (contact.name || contact.notify)
    )
}

/**
 * Set contact
 */
export function setContact(accountPhoneNumber: string, contact: Contact): void {
    const key = `${accountPhoneNumber}:${contact.jid}`
    contacts.set(key, contact)
}

/**
 * Save contacts to file
 */
export function saveContactsToFile(accountPhoneNumber: string): void {
    const accountContacts = getContactsByAccount(accountPhoneNumber)
    const filePath = path.join(CONTACTS_DIR, `${accountPhoneNumber}_contacts.json`)

    fs.writeFileSync(filePath, JSON.stringify(accountContacts, null, 2))
    logger.info({ accountPhoneNumber, count: accountContacts.length }, 'Saved contacts to file')
}

/**
 * Load contacts from file
 */
export function loadContactsFromFile(accountPhoneNumber: string): void {
    const filePath = path.join(CONTACTS_DIR, `${accountPhoneNumber}_contacts.json`)

    if (!fs.existsSync(filePath)) {
        logger.info({ accountPhoneNumber }, 'No contacts file found for this account')
        return
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8')
        const accountContacts = JSON.parse(data)

        accountContacts.forEach((contact: Contact) => {
            setContact(accountPhoneNumber, contact)
        })

        logger.info({ accountPhoneNumber, count: accountContacts.length }, 'Loaded contacts from file')
    } catch (error: any) {
        logger.error({ accountPhoneNumber, error: error.message }, 'Failed to load contacts')
    }
}

/**
 * Get contact lists for account
 */
export function getContactLists(accountPhoneNumber: string): Map<string, string[]> | undefined {
    return contactLists.get(accountPhoneNumber)
}

/**
 * Set contact list
 */
export function setContactList(accountPhoneNumber: string, listName: string, jids: string[]): void {
    if (!contactLists.has(accountPhoneNumber)) {
        contactLists.set(accountPhoneNumber, new Map())
    }
    contactLists.get(accountPhoneNumber)!.set(listName, jids)
}

/**
 * Get default status recipients for account
 */
export function getDefaultStatusRecipients(accountPhoneNumber: string): string[] {
    return defaultStatusRecipients.get(accountPhoneNumber) || []
}

/**
 * Set default status recipients for account
 */
export function setDefaultStatusRecipients(accountPhoneNumber: string, jids: string[]): void {
    defaultStatusRecipients.set(accountPhoneNumber, jids)
}

/**
 * Clear all contacts for account
 */
export function clearContactsForAccount(accountPhoneNumber: string): void {
    const accountPrefix = `${accountPhoneNumber}:`
    const keysToDelete: string[] = []

    contacts.forEach((_, key) => {
        if (key.startsWith(accountPrefix)) {
            keysToDelete.push(key)
        }
    })

    keysToDelete.forEach(key => contacts.delete(key))
    logger.info({ accountPhoneNumber, count: keysToDelete.length }, 'Cleared contacts for account')
}
