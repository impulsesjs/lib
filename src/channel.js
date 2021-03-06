'use strict'

import { Queue } from './queue'
import { Md5 as MD5 } from './md5'

const channelStatusCodes = {
    CLOSED_STATUS: 0,
    OPEN_STATUS: 1,
    ON_HOLD_STATUS: 2,
}

// TODO: need this to be WebWorker Working
const Channel = class ChannelClass {
    /**
     * @constructor ChannelClass
     * 
     * @param {string} entityName 
     * @param {string} channelName 
     * @param {boolean} initOnHold 
     */
    constructor (entityName, channelName, initOnHold = false) {

        /**** Private Attributes *************************************************************************************/
        const md5 = new MD5()

        let processingQueue = false
        const entity = entityName
        const name = channelName
        let statusOpen = true
        let statusHold = initOnHold || false
        let hookList = []
        const listenerQ = new Queue()
        const messageQ = new Queue()

        /**** Private Methods ****************************************************************************************/

        /**
         * Get the channel name
         *
         * @returns {string}
         */
        function getName () {
            return name
        }

        /**
         * Check if the queue is being proccessed
         *
         * @return {Boolean}
         */
        function isProcessingQueue() {
            return processingQueue
        }

        /**
         * Check if the channel is open
         *
         * @returns {boolean}
         */
        function isOpen () {
            return statusOpen
        }

        /**
         * Check if the channel is on hold
         *
         * @returns {boolean}
         */
        function isOnHold () {
            return statusOpen && statusHold
        }

        /**
         * Check if the channel is active
         *
         * @returns {boolean}
         */
        function isActive () {
            return statusOpen && !statusHold
        }

        /**
         * Starts or restart the queue process
         */
        function startQueueProcessing() {
            while (isProcessingQueue()) {} // stays here until stops processing
            processingQueue = true
        }

        /**
         * End the queue processing
         */
        function endQueueProcessing() {
            processingQueue = false
        }

        /**
         * Change the channel status and start processing if it is not on hold
         */
        function start() {
            if (!isOnHold()) {
                startQueueProcess()
            }
        }

        /**
         * Open the channel activity (if not active)
         *
         * @returns {boolean}
         */
        function open () {
            if (!isActive()) {
                statusOpen = true
                statusHold = false
                startQueueProcess()
                return true
            }
            return false
        }

        /**
         * Closes the channel activity (if open)
         *
         * @returns {boolean}
         */
        function close () {
            if (isOpen()) {
                statusOpen = false
                return true
            }
            return false
        }

        /**
         * Freezes the channel activity (if active)
         *
         * @returns {boolean}
         */
        function hold () {
            if (isActive()) {
                statusHold = true
                return true
            }
            return false
        }

        /**
         * Resume the channel activity (if on hold)
         *
         * @returns {boolean}
         */
        function resume () {
            if (isOnHold()) {
                statusHold = false
                startQueueProcess()
                return true
            }
            return false
        }

        /**
         * Get the channel status
         *
         * @returns {number}
         */
        function getStatus () {
            if (!isOpen()) {
                return channelStatusCodes.CLOSED_STATUS
            }

            if (isOnHold()) {
                return channelStatusCodes.ON_HOLD_STATUS
            }

            return channelStatusCodes.OPEN_STATUS
        }

        /**
         * Add a listener to the channel
         *
         * @param {Object} listenerInfo
         * @return {string|false} Listener ID
         */
        function addListener (listenerInfo) {
            if (isValidListener(listenerInfo)) {
                return listenerQ.add(listenerInfo)
            }
            return false
        }

        function isValidListener (listenerInfo) {
            // { id: 1, listener: () => {} }
            // Checking required attributes and respective types
            if (!listenerInfo) {
                return false
            }

            if (typeof listenerInfo.id === 'undefined') {
                return false                
            } 

            if (typeof listenerInfo.listener === 'undefined' || typeof listenerInfo.listener !== 'function') {
                return false
            }

            return true
        }

        /**
         * Remove a listener from the channel
         *
         * @param {string} id listener ID
         */
        function removeListener (id) {
            listenerQ.cancel(id)
            cancelHook(id)
        }

        /**
         * Cancel a hook from the active hook list
         *
         * @param {string} id listener ID
         */
        function cancelHook (id) {
            try {
                const idx = hookList.findIndex((item) => {
                    return item.qid === id
                })
                if (idx >= 0) {
                    hookList.splice(idx, 1)
                }
            }
            catch (e) {
                // something went wrong probably list length change due to concurrent cancellation / activity
            }
        }

        /**
         * Gets a listener information for the provided ID
         *
         * @param {string} id listener ID
         * @returns {Object|null}
         */
        function getListenerInfo (id) {
            return findListenerInQueue(id, () => {
                const listenerFound = hookList.find((item) => {
                    return item.qid === id
                })
                return listenerFound ? listenerFound.data : null
            })
        }

        /**
         * Finds a listener in the listener queue
         * @param {string} id 
         * @param {function} callback 
         * @returns {Object|null}
         */
        function findListenerInQueue (id, callback) {
            if (!id) return null
            startQueueProcessing()
            const listener = listenerQ.get(id)
            endQueueProcessing()
            if (listener === null) {
                return callback()
            } else {
                return listener.data
            }
        }

        /**
         * Add a reply Information to the message
         *
         * @param {Object} message Message object
         */
        function addReplyInfo(message) {
            const reply_stack = {entity: entity, name: name}
            if (typeof message.reply_stack === 'undefined') {
                message.reply_stack = []
            }
            message.reply_stack.push(reply_stack)
        }

        /**
         * Processes a message and send it to all registered hook
         *
         * @param {Object} message
         */
        function processMessage (message) {
            try {
                addReplyInfo(message)
                hookList.forEach((item) => {
                    item.data.listener(message) // No need to check here since we are ensuring its existence when coming from the queue
                    if (item.data.times > 0) {
                        item.data.times--
                    }
                })
                hookList = hookList.filter((item) => {
                    return typeof item.data === 'undefined' || typeof item.data.times === 'undefined' || item.data.times !== 0
                })
            }
            catch (e) {
                // something went wrong probably list length change due to cancellation / activity
            }
        }

        /**
         * Send a messagr to the channel
         *
         * @param {Object} message
         * 
         * @return {string}
         */
        function send (message) {
            return messageQ.add(Object.assign({}, message))
        }

        /**
         * Sends a message to the channel and makes the listener hear
         *
         * @param {Object} message
         * @param {Object} listenerInfo
         *
         * @return {String|false} listenerId
         */
        function sendAndListen (message, listenerInfo) {
            const id = addListener(listenerInfo)
            send(message)
            return id
        }

        /**
         * Get a message information for the provided id
         *
         * @param {string} id Message ID
         * @returns {*|null}
         */
        function getMessageInfo (id) {
            return messageQ.get(id).data
        }

        /**
         * Starts the queue process so we can deal with the pending in the queues
         */
        function startQueueProcess() {
            if (isActive()) {
                processListenersQueue()
                processMessagesQueue()
                setTimeout(startQueueProcess, 0)
            }
        }

        /**
         * Processes the listener queue
         */
        function processListenersQueue() {
            if (!isProcessingQueue()) {
                startQueueProcessing()
                let hash = null
                let listenerInfo = listenerQ.next()
                while (listenerInfo !== null) {
                    if (typeof listenerInfo.data.listener === 'function') {
                        hash = md5.calculate(listenerInfo.toString())
                        const item = {id: hash, qid: listenerInfo.id, data: listenerInfo.data}
                        hookList.push(item)
                    }
                    listenerInfo = listenerQ.next()
                }
                endQueueProcessing()
            }
        }

        /**
         * Proceoo the message queue
         */
        function processMessagesQueue() {
            let message = messageQ.next()
            while (message !== null) {
                processMessage(message.data)
                message = messageQ.next()
            }
        }

        // initializes the state
        start()

        /**** Privileged Methods *************************************************************************************/

        /**
         * Get the channel name
         *
         * @returns {string}
         */
        this.getName = () => getName()

        /**
         * Get the channel status
         *
         * @returns {number}
         */
        this.getStatus = () => getStatus()

        /**
         * Open the channel activity (if not active)
         *
         * @returns {boolean}
         */
        this.open = () => open()

        /**
         * Closes the channel activity (if open)
         *
         * @returns {boolean}
         */
        this.close = () => close()

        /**
         * Freezes the channel activity (if active)
         *
         * @returns {boolean}
         */
        this.hold = () => hold()

        /**
         * Resume the channel activity (if on hold)
         *
         * @returns {boolean}
         */
        this.resume = () => resume()

        /**
         * Add a listener to the channel
         *
         * @param {Object} listenerInfo
         * @return {string} Listener ID
         */
        this.addListener = (listenerInfo) => addListener(listenerInfo)

        /**
         * Remove a listener from the channel
         *
         * @param {string} id listener ID
         */
        this.removeListener = (id) => removeListener(id)

        /**
         * Gets a listener information for the provided ID
         *
         * @param {string} id listener ID
         * @returns {*}
         */
        this.listenerInfo = (id) => getListenerInfo(id)

        /**
         * Send a messagr to the channel
         *
         * @param {Object} message
         * 
         * @returns {string}
         */
        this.send = (message) => send(message)

        /**
         * Sends a message to the channel and makes the listener hear
         *
         * @param {Object} message
         * @param {Object} listenerInfo
         *
         * @return {Object} listenerInfo
         */
        this.sendAndListen = (message, listenerInfo) => sendAndListen(message, listenerInfo)

        /**
         * Get a message information for the provided id
         *
         * @param {string} id Message ID
         * @returns {*}
         */
        this.messageInfo = (id) => getMessageInfo(id)

        /**** Test Area **********************************************************************************************/

        if (process.env.NODE_ENV === 'test') {
            // Allow unit test mocking
            this.__test__ = {
                md5: md5,
                listenerQ: listenerQ,
                messageQ: messageQ,
            }
        }

    }

    /**** Prototype Methods ******************************************************************************************/
}

export { Channel, channelStatusCodes }
