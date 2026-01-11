
import { io, Socket } from 'socket.io-client';
import { User, Message, PrivateRoom, ChatRequest } from '../types';

/**
 * SocketService with Hybrid Fallback.
 * In environments without a backend (like AI Studio preview), 
 * it uses BroadcastChannel to ensure messages still work.
 */

class SocketService {
  private socket: Socket | null = null;
  private localBus: BroadcastChannel;

  constructor(user: User) {
    this.localBus = new BroadcastChannel('ghosttalk_local_bus');
    
    // Attempt real socket connection
    try {
      this.socket = io({
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        timeout: 5000
      });

      this.socket.on('connect', () => {
        console.log('GhostTalk: Connected to server');
        this.sendHeartbeat(user);
      });

      this.socket.on('connect_error', () => {
        console.warn('GhostTalk: Server unreachable, using local ghost-bus');
      });
    } catch (e) {
      console.warn('GhostTalk: Socket initialization failed, using local fallback');
    }
  }

  on<T>(event: string, callback: (data: T) => void) {
    // Listen to real socket
    if (this.socket) {
      this.socket.on(event, callback);
    }

    // Listen to local broadcast bus (for preview/local support)
    const handleLocal = (ev: MessageEvent) => {
      // The event structure must match what the server sends
      if (ev.data && ev.data.type === event) {
        // We pass the whole data object so listeners can access data.message, data.request, etc.
        callback(ev.data);
      }
    };
    this.localBus.addEventListener('message', handleLocal);

    return () => {
      if (this.socket) this.socket.off(event, callback);
      this.localBus.removeEventListener('message', handleLocal);
    };
  }

  emit(data: any) {
    // Ensure data has a type for our local bus
    const emitData = data.type ? data : { type: 'MESSAGE', message: data };

    // Send to server
    if (this.socket && this.socket.connected) {
      this.socket.emit(emitData.type, emitData);
    }

    // Local broadcast for Preview support
    this.localBus.postMessage(emitData);
    
    // Trigger locally for the sender's tab
    this.localBus.dispatchEvent(new MessageEvent('message', { data: emitData }));
  }

  sendHeartbeat(user: User) {
    const data = { type: 'HEARTBEAT', user };
    if (this.socket && this.socket.connected) {
      this.socket.emit('HEARTBEAT', data);
    }
    this.localBus.postMessage(data);
  }

  close() {
    if (this.socket) this.socket.close();
    this.localBus.close();
  }
}

export default SocketService;
