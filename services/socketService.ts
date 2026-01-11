
import { io, Socket } from 'socket.io-client';
import { User, Message, PrivateRoom, ChatRequest } from '../types';

/**
 * SocketService using Socket.io to enable real-time communication
 * across different devices and browsers via the Node.js backend.
 */

interface SocketEventMap {
  HEARTBEAT: { user: User; communityTimerEnd?: number; siteTimerEnd?: number };
  MESSAGE: { message: Message };
  CHAT_REQUEST: { request: ChatRequest };
  CHAT_ACCEPT: { requestId: string; room: PrivateRoom };
  CHAT_REJOIN: { reconnectCode: string };
  CHAT_EXIT: { roomId: string };
  CHAT_EXTEND: { roomId: string };
  INIT_STATE: { communityMessages: Message[]; communityTimerEnd: number; siteTimerEnd: number };
  RESET_COMMUNITY: { nextReset: number };
  RESET_SITE: { nextReset: number };
  CHAT_CLOSED: { roomId: string; reason: string };
  CHAT_EXTENDED: { room: PrivateRoom };
  ERROR: { message: string };
}

class SocketService {
  private socket: Socket;

  constructor(user: User) {
    // Connect to the same host that served the page
    this.socket = io({
      transports: ['websocket', 'polling']
    });

    // Send initial heartbeat once connected to ensure peer list is updated instantly
    this.socket.on('connect', () => {
      console.log('Socket connected, sending initial heartbeat');
      this.sendHeartbeat(user);
    });
  }

  /**
   * Listen for events from the server.
   * Returns a cleanup function to remove the listener.
   */
  on<T>(event: string, callback: (data: T) => void) {
    this.socket.on(event, callback);
    return () => {
      this.socket.off(event, callback);
    };
  }

  /**
   * Emit events to the server.
   */
  emit(data: any) {
    const { type, ...payload } = data;
    if (type) {
      this.socket.emit(type, payload);
    } else {
      this.socket.emit('MESSAGE', data);
    }
  }

  sendHeartbeat(user: User) {
    this.socket.emit('HEARTBEAT', { user });
  }

  close() {
    this.socket.close();
  }
}

export default SocketService;
