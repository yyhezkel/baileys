import { Router, type Request, type Response } from 'express'

// Dependencies interface
export interface ListsRoutesDeps {
    sessions: Map<string, any>
    contactLists: Map<string, Map<string, string[]>>
    saveContactListsToFile: (accountPhoneNumber: string) => Promise<void>
}

/**
 * Create contact lists routes
 */
export function createListsRoutes(deps: ListsRoutesDeps): Router {
    const router = Router()
    const { sessions, contactLists, saveContactListsToFile } = deps

    // GET /lists - Get all lists
    router.get('/', async (req: Request, res: Response) => {
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

            const lists = contactLists.get(accountPhoneNumber) || new Map()
            const listsArray: any[] = []

            lists.forEach((contacts, listName) => {
                listsArray.push({
                    name: listName,
                    contacts: contacts.length
                })
            })

            res.json({
                sessionId,
                accountPhoneNumber,
                totalLists: listsArray.length,
                lists: listsArray
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /lists/create - Create a new list
    router.post('/create', async (req: Request, res: Response) => {
        try {
            const { sessionId, listName, contacts: initialContacts } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            if (!listName) {
                return res.status(400).json({ error: 'listName is required' })
            }

            const session = sessions.get(sessionId)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            // Get or create lists map for this account
            let lists = contactLists.get(accountPhoneNumber)
            if (!lists) {
                lists = new Map()
                contactLists.set(accountPhoneNumber, lists)
            }

            // Check if list already exists
            if (lists.has(listName)) {
                return res.status(400).json({ error: 'List already exists' })
            }

            // Process initial contacts if provided
            const jids: string[] = []
            if (initialContacts && Array.isArray(initialContacts)) {
                initialContacts.forEach((contact: any) => {
                    let jid: string
                    if (typeof contact === 'string') {
                        jid = contact
                    } else if (contact.jid) {
                        jid = contact.jid
                    } else if (contact.phone) {
                        const cleanPhone = contact.phone.replace(/\D/g, '')
                        jid = `${cleanPhone}@s.whatsapp.net`
                    } else {
                        return
                    }

                    if (!jid.includes('@')) {
                        jid = `${jid}@s.whatsapp.net`
                    }

                    if (!jids.includes(jid)) {
                        jids.push(jid)
                    }
                })
            }

            // Create the list
            lists.set(listName, jids)
            await saveContactListsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                listName,
                contacts: jids.length,
                message: `List '${listName}' created with ${jids.length} contacts`
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // DELETE /lists/:listName - Delete a list
    router.delete('/:listName', async (req: Request, res: Response) => {
        try {
            const { listName } = req.params
            if (!listName) {
                return res.status(400).json({ error: 'listName is required' })
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

            const lists = contactLists.get(accountPhoneNumber)

            if (!lists || !lists.has(listName)) {
                return res.status(404).json({ error: 'List not found' })
            }

            const contactCount = lists.get(listName)!.length
            lists.delete(listName)
            await saveContactListsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                listName,
                deletedContacts: contactCount,
                message: `List '${listName}' deleted with ${contactCount} contacts`
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // GET /lists/:listName/contacts - Get contacts in a list
    router.get('/:listName/contacts', async (req: Request, res: Response) => {
        try {
            const { listName } = req.params
            if (!listName) {
                return res.status(400).json({ error: 'listName is required' })
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

            const lists = contactLists.get(accountPhoneNumber)

            if (!lists || !lists.has(listName)) {
                return res.status(404).json({ error: 'List not found' })
            }

            const contactJids = lists.get(listName)!

            res.json({
                sessionId,
                accountPhoneNumber,
                listName,
                totalContacts: contactJids.length,
                contacts: contactJids
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /lists/:listName/contacts/add - Add contacts to a list
    router.post('/:listName/contacts/add', async (req: Request, res: Response) => {
        try {
            const { listName } = req.params
            if (!listName) {
                return res.status(400).json({ error: 'listName is required' })
            }
            const { sessionId, contacts: newContacts } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            if (!newContacts || !Array.isArray(newContacts) || newContacts.length === 0) {
                return res.status(400).json({ error: 'contacts array is required and must not be empty' })
            }

            const session = sessions.get(sessionId)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            const lists = contactLists.get(accountPhoneNumber)

            if (!lists || !lists.has(listName)) {
                return res.status(404).json({ error: 'List not found. Create it first using POST /lists/create' })
            }

            const existingContacts = lists.get(listName)!
            const added: string[] = []
            const skipped: string[] = []

            // Process new contacts
            newContacts.forEach((contact: any) => {
                let jid: string
                if (typeof contact === 'string') {
                    jid = contact
                } else if (contact.jid) {
                    jid = contact.jid
                } else if (contact.phone) {
                    const cleanPhone = contact.phone.replace(/\D/g, '')
                    jid = `${cleanPhone}@s.whatsapp.net`
                } else {
                    return
                }

                if (!jid.includes('@')) {
                    jid = `${jid}@s.whatsapp.net`
                }

                if (!existingContacts.includes(jid)) {
                    existingContacts.push(jid)
                    added.push(jid)
                } else {
                    skipped.push(jid)
                }
            })

            lists.set(listName, existingContacts)
            await saveContactListsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                listName,
                added: added.length,
                skipped: skipped.length,
                totalContacts: existingContacts.length,
                addedJids: added,
                skippedJids: skipped.length > 0 ? skipped : undefined
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /lists/:listName/contacts/remove - Remove contacts from a list
    router.post('/:listName/contacts/remove', async (req: Request, res: Response) => {
        try {
            const { listName } = req.params
            if (!listName) {
                return res.status(400).json({ error: 'listName is required' })
            }
            const { sessionId, contacts: contactsToRemove } = req.body

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' })
            }

            if (!contactsToRemove || !Array.isArray(contactsToRemove) || contactsToRemove.length === 0) {
                return res.status(400).json({ error: 'contacts array is required and must not be empty' })
            }

            const session = sessions.get(sessionId)

            if (!session) {
                return res.status(404).json({ error: 'Session not found' })
            }

            const accountPhoneNumber = session.accountPhoneNumber

            if (!accountPhoneNumber) {
                return res.status(400).json({ error: 'Account phone number not available' })
            }

            const lists = contactLists.get(accountPhoneNumber)

            if (!lists || !lists.has(listName)) {
                return res.status(404).json({ error: 'List not found' })
            }

            const existingContacts = lists.get(listName)!
            const removed: string[] = []
            const notFound: string[] = []

            // Process contacts to remove
            const jidsToRemove = contactsToRemove.map((contact: any) => {
                if (typeof contact === 'string') {
                    return contact.includes('@') ? contact : `${contact}@s.whatsapp.net`
                } else if (contact.jid) {
                    return contact.jid
                } else if (contact.phone) {
                    const cleanPhone = contact.phone.replace(/\D/g, '')
                    return `${cleanPhone}@s.whatsapp.net`
                }
                return null
            }).filter((jid: any) => jid !== null)

            // Remove JIDs
            const updatedContacts = existingContacts.filter(jid => {
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

            lists.set(listName, updatedContacts)
            await saveContactListsToFile(accountPhoneNumber)

            res.json({
                success: true,
                sessionId,
                accountPhoneNumber,
                listName,
                removed: removed.length,
                notFound: notFound.length,
                totalContacts: updatedContacts.length,
                removedJids: removed,
                notFoundJids: notFound.length > 0 ? notFound : undefined
            })

        } catch (error: any) {
            res.status(500).json({ error: error.message })
        }
    })

    return router
}
