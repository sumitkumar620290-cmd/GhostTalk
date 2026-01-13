
export interface User {
  id: string;
  username: string;
  lastActive: number;
  acceptingRequests: boolean; // Consent flag
  isDeciding?: boolean;       // Anti-spam busy flag
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  roomId: string;
  replyTo?: {
    text: string;
    senderName: string;
  };
}

export interface PrivateRoom {
  id: string;
  participants: string[];
  reconnectCode: string;
  createdAt: number;
  expiresAt: number;
  extended?: boolean; // Track if the 30min extension has been used
  rejoinStartedAt?: number | null; // Track when the 15-min rejoin window begins
}

export interface ChatRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  timestamp: number;
}

export enum RoomType {
  COMMUNITY = 'community',
  PRIVATE = 'private'
}
