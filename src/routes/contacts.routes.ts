import { Router, type Request, type Response } from 'express'
import { logger } from '../api-utils/logger.js'

// Dependencies interface
export interface ContactsRoutesDeps {
    sessions: Map<string, any>
    contacts: Map<string, any>
    defaultStatusRecipients: Map<string, string[]>
    saveContactsToFile: (accountPhoneNumber: string) => void
    saveDefaultRecipientsToFile: (accountPhoneNumber: string) => Promise<void>
}

/**
 * Create contacts routes
 */
export function createContactsRoutes(deps: ContactsRoutesDeps): Router {
    const router = Router()
    const { sessions, contacts, defaultStatusRecipients, saveContactsToFile, saveDefaultRecipientsToFile } = deps

    // GET /contacts - Get all contacts for a session
    router.get('/', async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.query

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            const session = sessions.get(sessionId as string)

            if (!session || session.status !== 'connected') {
                return res.status(400).json({ error: 'Session not connected' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            // Get all contacts for this account
            const accountContacts: any[] = []
            const accountPrefix = `${accountPhoneNumber}:`

            contacts.forEach((contact, key) => {
                if (key.startsWith(accountPrefix)) {
                    accountContacts.push(contact)
                }
            })

            res.json({
                sessionId,
                accountPhoneNumber,
                totalContacts: accountContacts.length,
                contacts: accountContacts
            })
        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /contacts/add - Add contacts manually for a session
    router.post('/add', async (req: Request, res: Response) => {
        try {
            const { sessionId, contacts: newContacts } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            if (!newContacts || !Array.isArray(newContacts) || newContacts.length === 0) {
                return res.status(400).json({ error: 'contacts array is required and must not be empty' })
            }

            const session = sessions.get(sessionId)

            if (!session || session.status !== 'connected') {
                return res.status(400).json({ error: 'Session not connected' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            const added: any[] = []
            const updated: any[] = []
            const errors: any[] = []

            // Process each contact
            newContacts.forEach((contact: any, index: number) => {
                try {
                    // Validate contact data
                    if (!contact.jid && !contact.phone) {
                        errors.push({
                            index,
                            contact,
                            error: 'Either jid or phone is required'
                        })
                        return
                    }

                    // Convert phone to JID if needed
                    let jid = contact.jid
                    if (!jid && contact.phone) {
                        // Remove any non-digit characters from phone
                        const cleanPhone = contact.phone.replace(/\D/g, '')
                        jid = `${cleanPhone}@s.whatsapp.net`
                    }

                    // Ensure JID has proper format
                    if (!jid.includes('@')) {
                        jid = `${jid}@s.whatsapp.net`
                    }

                    const key = `${accountPhoneNumber}:${jid}`
                    const existing = contacts.get(key)

                    const contactData = {
                        jid,
                        name: contact.name || contact.notify || '',
                        notify: contact.notify || contact.name || '',
                        verifiedName: contact.verifiedName || '',
                        imgUrl: contact.imgUrl || '',
                        status: contact.status || ''
                    }

                    contacts.set(key, contactData)

                    if (existing) {
                        updated.push(contactData)
                    } else {
                        added.push(contactData)
                    }

                    logger.info({
                        accountPhoneNumber,
                        jid,
                        name: contactData.name,
                        action: existing ? 'updated' : 'added'
                    }, 'Contact manually added/updated')

                } catch (error: any) {
                    errors.push({
                        index,
                        contact,
                        error: error.message
                    })
                }
            })

            // Save contacts to persistent storage
            saveContactsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                added: added.length,
                updated: updated.length,
                failed: errors.length,
                addedContacts: added,
                updatedContacts: updated,
                errors: errors.length > 0 ? errors : undefined
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // GET /contacts/status-recipients - Get default status recipients for a session
    router.get('/status-recipients', async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.query

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            const session = sessions.get(sessionId as string)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            const recipients = defaultStatusRecipients.get(accountPhoneNumber) || []

            res.json({
                sessionId,
                accountPhoneNumber,
                totalRecipients: recipients.length,
                recipients,
                note: 'These contacts will automatically receive every status you send'
            })
        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /contacts/status-recipients/add - Add default status recipients
    router.post('/status-recipients/add', async (req: Request, res: Response) => {
        try {
            const { sessionId, recipients: newRecipients } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            if (!newRecipients || !Array.isArray(newRecipients) || newRecipients.length === 0) {
                return res.status(400).json({ error: 'recipients array is required and must not be empty' })
            }

            const session = sessions.get(sessionId)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            // Get existing recipients or initialize empty array
            const existingRecipients = defaultStatusRecipients.get(accountPhoneNumber) || []
            const added: string[] = []
            const skipped: string[] = []

            // Process each recipient
            newRecipients.forEach((recipient: any) => {
                let jid: string

                // Handle different input formats
                if (typeof recipient === 'string') {
                    jid = recipient
                } else if (recipient.jid) {
                    jid = recipient.jid
                } else if (recipient.phone) {
                    const cleanPhone = recipient.phone.replace(/\D/g, '')
                    jid = `${cleanPhone}@s.whatsapp.net`
                } else {
                    return // Skip invalid recipients
                }

                // Ensure JID has proper format
                if (!jid.includes('@')) {
                    jid = `${jid}@s.whatsapp.net`
                }

                // Add if not already in the list
                if (!existingRecipients.includes(jid)) {
                    existingRecipients.push(jid)
                    added.push(jid)
                } else {
                    skipped.push(jid)
                }
            })

            // Update the map and save to file
            defaultStatusRecipients.set(accountPhoneNumber, existingRecipients)
            await saveDefaultRecipientsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                added: added.length,
                skipped: skipped.length,
                totalRecipients: existingRecipients.length,
                addedJids: added,
                skippedJids: skipped.length > 0 ? skipped : undefined,
                note: 'These contacts will now automatically receive every status you send'
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /contacts/status-recipients/remove - Remove default status recipients
    router.post('/status-recipients/remove', async (req: Request, res: Response) => {
        try {
            const { sessionId, recipients: recipientsToRemove } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            if (!recipientsToRemove || !Array.isArray(recipientsToRemove) || recipientsToRemove.length === 0) {
                return res.status(400).json({ error: 'recipients array is required and must not be empty' })
            }

            const session = sessions.get(sessionId)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            const existingRecipients = defaultStatusRecipients.get(accountPhoneNumber) || []
            const removed: string[] = []
            const notFound: string[] = []

            // Process recipients to remove
            const jidsToRemove = recipientsToRemove.map((recipient: any) => {
                if (typeof recipient === 'string') {
                    return recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`
                } else if (recipient.jid) {
                    return recipient.jid
                } else if (recipient.phone) {
                    const cleanPhone = recipient.phone.replace(/\D/g, '')
                    return `${cleanPhone}@s.whatsapp.net`
                }
                return null
            }).filter((jid: any) => jid !== null)

            // Remove JIDs
            const updatedRecipients = existingRecipients.filter(jid => {
                if (jidsToRemove.includes(jid)) {
                    removed.push(jid)
                    return false
                }
                return true
            })

            // Check which ones were not found
            jidsToRemove.forEach((jid: string) => {
                if (!removed.includes(jid)) {
                    notFound.push(jid)
                }
            })

            // Update the map and save to file
            defaultStatusRecipients.set(accountPhoneNumber, updatedRecipients)
            await saveDefaultRecipientsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                removed: removed.length,
                notFound: notFound.length,
                totalRecipients: updatedRecipients.length,
                removedJids: removed,
                notFoundJids: notFound.length > 0 ? notFound : undefined
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // DELETE /contacts/status-recipients - Clear all default status recipients
    router.delete('/status-recipients', async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.query

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            const session = sessions.get(sessionId as string)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            const previousCount = (defaultStatusRecipients.get(accountPhoneNumber) || []).length

            // Clear the list
            defaultStatusRecipients.set(accountPhoneNumber, [])
            await saveDefaultRecipientsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                cleared: previousCount,
                message: `Cleared ${previousCount} default status recipients`
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // DELETE /contacts/:contactId - Delete/remove a contact
    router.delete('/:contactId', async (req: Request, res: Response) => {
        try {
            const { contactId } = req.params
            if (!contactId) {
                return res.status(400).json({ error: 'contactId is required' })
            }
            const { sessionId } = req.query

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            const session = sessions.get(sessionId as string)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            // Convert contactId to JID if needed
            let jid = contactId
            if (!jid.includes('@')) {
                jid = `${jid}@s.whatsapp.net`
            }

            const key = `${accountPhoneNumber}:${jid}`
            const existed = contacts.has(key)

            if (existed) {
                contacts.delete(key)
                saveContactsToFile(accountPhoneNumber)
            }

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                deleted: existed,
                jid,
                message: existed ? 'Contact deleted' : 'Contact not found (already deleted)'
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    return router
}
