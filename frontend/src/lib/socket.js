import { io } from 'socket.io-client'
import { useAuthStore } from '../store/authStore'

let socket = null
let _activeConvId = null  // track current conversation for reconnect

export function setActiveConversation(convId) {
    const prev = _activeConvId
    _activeConvId = convId

    if (socket?.connected) {
        // Leave previous conversation room
        if (prev && prev !== convId) {
            socket.emit('leave_conversation', prev)
        }
        // Join new conversation room
        if (convId) {
            socket.emit('join_conversation', convId)
        }
    }
}

export function getSocket() {
    if (socket?.connected) return socket

    const token = useAuthStore.getState().token
    if (!token) return null

    socket = io('/', {
        path: '/socket.io',
        auth: { token },
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
    })

    socket.on('connect_error', (err) => {
        console.warn('[socket] connect error:', err.message)
    })

    // Re-join conversation room after reconnect
    socket.on('connect', () => {
        if (_activeConvId) {
            socket.emit('join_conversation', _activeConvId)
            console.info('[socket] reconnected — rejoined conv', _activeConvId)
        }
    })

    return socket
}

export function disconnectSocket() {
    socket?.disconnect()
    socket = null
}
