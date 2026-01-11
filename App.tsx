
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Message, PrivateRoom, ChatRequest, RoomType } from './types';
import { generateId, generateUsername, generateReconnectCode } from './utils/helpers';
import SocketService from './services/socketService';
import ChatBox from './components/ChatBox';

interface HeartbeatPayload {
  user: User;
  communityTimerEnd?: number;
  siteTimerEnd?: number;
}

interface MessagePayload {
  message: Message;
}

interface ChatRequestPayload {
  request: ChatRequest;
}

interface ChatAcceptPayload {
  room: PrivateRoom;
}

interface ChatClosedPayload {
  roomId: string;
  reason: string;
}

interface ErrorPayload {
  message: string;
}

const App: React.FC = () => {
  const BMC_LINK = "https://buymeacoffee.com/";
  
  // UI States
  const [isAgeVerified, setIsAgeVerified] = useState<boolean | null>(null);
  const [showPeers, setShowPeers] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [showExtendPopup, setShowExtendPopup] = useState<string | null>(null);
  
  const [currentUser] = useState<User>(() => ({
    id: generateId(),
    username: generateUsername(),
    lastActive: Date.now(),
    acceptingRequests: true,
    isDeciding: false
  }));

  const [isOpenToPrivate, setIsOpenToPrivate] = useState(true);
  const [hiddenUserIds] = useState<Set<string>>(new Set());
  const [sentRequestIds, setSentRequestIds] = useState<Set<string>>(new Set());
  const [userPopup, setUserPopup] = useState<{ userId: string, username: string } | null>(null);

  const isOpenToPrivateRef = useRef(isOpenToPrivate);
  const privateRoomsCountRef = useRef(0);
  const currentUserIdRef = useRef(currentUser.id);

  useEffect(() => {
    isOpenToPrivateRef.current = isOpenToPrivate;
  }, [isOpenToPrivate]);

  const [commTimerEnd, setCommTimerEnd] = useState<number>(Date.now() + 1800000); 
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('community');
  const [activeRoomType, setActiveRoomType] = useState<RoomType>(RoomType.COMMUNITY);
  const [privateRooms, setPrivateRooms] = useState<Map<string, PrivateRoom>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<Map<string, User>>(new Map());

  const [activeIncomingRequest, setActiveIncomingRequest] = useState<ChatRequest | null>(null);
  const requestExpiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const socket = useMemo(() => new SocketService(currentUser), []);

  useEffect(() => {
    privateRoomsCountRef.current = privateRooms.size;
  }, [privateRooms.size]);

  useEffect(() => {
    const hb = setInterval(() => {
      socket.sendHeartbeat({ ...currentUser, acceptingRequests: isOpenToPrivate });
    }, 4000);
    return () => clearInterval(hb);
  }, [socket, currentUser, isOpenToPrivate]);

  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setCurrentTime(now);

      setOnlineUsers(prev => {
        const next = new Map<string, User>(prev);
        let changed = false;
        next.forEach((user: User, id: string) => {
          if (now - user.lastActive > 15000) {
            next.delete(id);
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      privateRooms.forEach(room => {
        const remaining = room.expiresAt - now;
        if (remaining > 0 && remaining <= 300000 && !room.extended && showExtendPopup !== room.id) {
          setShowExtendPopup(room.id);
        } else if (remaining <= 0) {
          setPrivateRooms(prev => {
            const next = new Map(prev);
            next.delete(room.id);
            return next;
          });
          if (activeRoomId === room.id) {
            setActiveRoomId('community');
            setActiveRoomType(RoomType.COMMUNITY);
          }
        }
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [activeRoomId, privateRooms, showExtendPopup]);

  const timeLeftGlobal = useMemo(() => {
    const diff = Math.max(0, commTimerEnd - currentTime);
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [commTimerEnd, currentTime]);

  const handleSendMessage = (text: string) => {
    const msg: Message = {
      id: generateId(),
      senderId: currentUser.id,
      senderName: currentUser.username,
      text,
      timestamp: Date.now(),
      roomId: activeRoomId
    };
    socket.emit({ type: 'MESSAGE', message: msg });
  };

  const sendRequest = (targetUser: User) => {
    if (targetUser.id === currentUser.id) return;
    if (sentRequestIds.has(targetUser.id)) return;
    if (privateRooms.size > 0) {
      alert("Finish your current secret session first.");
      return;
    }
    socket.emit({
      type: 'CHAT_REQUEST',
      request: {
        id: generateId(),
        fromId: currentUser.id,
        fromName: currentUser.username,
        toId: targetUser.id,
        timestamp: Date.now()
      }
    });
    setSentRequestIds(prev => new Set(prev).add(targetUser.id));
    setUserPopup(null);
  };

  const acceptRequest = (req: ChatRequest) => {
    const room: PrivateRoom = {
      id: generateId(),
      participants: [req.fromId, req.toId],
      reconnectCode: generateReconnectCode(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 1800000,
      extended: false
    };
    socket.emit({ type: 'CHAT_ACCEPT', requestId: req.id, room });
    setActiveIncomingRequest(null);
    setShowNotificationMenu(false);
  };

  const exitPrivateRoom = (roomId: string) => {
    socket.emit({ type: 'CHAT_EXIT', roomId });
  };

  const extendPrivateRoom = (roomId: string) => {
    socket.emit({ type: 'CHAT_EXTEND', roomId });
    setShowExtendPopup(null);
  };

  useEffect(() => {
    const unsubHB = socket.on<HeartbeatPayload>('HEARTBEAT', (data) => {
      setOnlineUsers(prev => {
        const next = new Map(prev);
        next.set(data.user.id, { ...data.user, lastActive: Date.now() });
        return next;
      });
      if (data.communityTimerEnd) setCommTimerEnd(data.communityTimerEnd);
    });

    const unsubMsg = socket.on<MessagePayload>('MESSAGE', (data) => {
      setMessages(prev => {
        if (prev.find(m => m.id === data.message.id)) return prev;
        return [...prev, data.message].slice(-300);
      });
    });

    const unsubReq = socket.on<ChatRequestPayload>('CHAT_REQUEST', (data) => {
      if (
        data.request.toId === currentUserIdRef.current && 
        isOpenToPrivateRef.current && 
        privateRoomsCountRef.current === 0
      ) {
        setActiveIncomingRequest(data.request);
        if (requestExpiryTimer.current) clearTimeout(requestExpiryTimer.current);
        requestExpiryTimer.current = setTimeout(() => {
          setActiveIncomingRequest(null);
        }, 30000);
      }
    });

    const unsubAccept = socket.on<ChatAcceptPayload>('CHAT_ACCEPT', (data) => {
      if (data.room.participants.includes(currentUserIdRef.current)) {
        setPrivateRooms(prev => {
          const next = new Map(prev);
          next.set(data.room.id, data.room);
          return next;
        });
        setActiveRoomId(data.room.id);
        setActiveRoomType(RoomType.PRIVATE);
      }
    });

    const unsubExtended = socket.on<ChatAcceptPayload>('CHAT_EXTENDED', (data) => {
      if (data.room.participants.includes(currentUserIdRef.current)) {
        setPrivateRooms(prev => {
          const next = new Map(prev);
          next.set(data.room.id, data.room);
          return next;
        });
        setShowExtendPopup(null);
      }
    });

    const unsubClosed = socket.on<ChatClosedPayload>('CHAT_CLOSED', (data) => {
      setPrivateRooms(prev => {
        const next = new Map(prev);
        next.delete(data.roomId);
        return next;
      });
      if (activeRoomId === data.roomId) {
        setActiveRoomId('community');
        setActiveRoomType(RoomType.COMMUNITY);
      }
    });

    const unsubInit = socket.on<any>('INIT_STATE', (data) => {
      if (data.communityMessages) setMessages(data.communityMessages);
      if (data.communityTimerEnd) setCommTimerEnd(data.communityTimerEnd);
      if (data.onlineUsers) {
        setOnlineUsers(prev => {
          const next = new Map(prev);
          data.onlineUsers.forEach((u: User) => {
            if (u.id !== currentUserIdRef.current) {
               next.set(u.id, { ...u, lastActive: Date.now() });
            }
          });
          return next;
        });
      }
    });

    const unsubError = socket.on<ErrorPayload>('ERROR', (data) => {
      alert(data.message);
    });

    return () => {
      unsubHB(); unsubMsg(); unsubReq(); unsubAccept(); unsubExtended(); unsubClosed(); unsubInit(); unsubError();
    };
  }, [socket, activeRoomId]);

  const activeMessages = useMemo(() => 
    messages.filter(m => m.roomId === activeRoomId && !hiddenUserIds.has(m.senderId)), 
    [messages, activeRoomId, hiddenUserIds]
  );

  const activePrivateRoom = useMemo(() => {
    return activeRoomType === RoomType.PRIVATE ? privateRooms.get(activeRoomId) : null;
  }, [activeRoomType, activeRoomId, privateRooms]);

  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [reconnectInput, setReconnectInput] = useState('');

  if (isAgeVerified === null) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl">
          <div className="text-4xl mb-4">👻</div>
          <h2 className="text-2xl font-black mb-4 uppercase tracking-tighter text-white">Entry Protocols</h2>
          <p className="text-slate-400 mb-8 text-sm">GhostTalk is an anonymous space for adults. By entering, you confirm you are 18 or older.</p>
          <button onClick={() => setIsAgeVerified(true)} className="w-full py-4 bg-blue-600 text-white font-black rounded-2xl uppercase tracking-widest active:scale-95 shadow-xl">I am 18+</button>
          <button onClick={() => setIsAgeVerified(false)} className="w-full py-4 mt-3 bg-slate-800 text-slate-400 font-bold rounded-2xl">Leave</button>
        </div>
      </div>
    );
  }

  const activeRoomTimeLeft = activePrivateRoom ? Math.max(0, activePrivateRoom.expiresAt - currentTime) : 0;
  const isFinalFive = activePrivateRoom && activePrivateRoom.extended && activeRoomTimeLeft <= 300000;

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-screen overflow-hidden bg-slate-950 text-slate-100 selection:bg-blue-500/30">
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 border-r border-white/5 shrink-0 p-6">
        <div className="flex flex-col items-start mb-8">
          <div className="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center mb-3 border border-blue-600/20 shadow-xl group hover:scale-105 transition-transform">
            <span className="text-xl">👻</span>
          </div>
          <div>
            <p className="text-lg font-black tracking-tighter leading-none text-white">GhostTalk</p>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1 leading-tight">Ephemeral messaging.</p>
          </div>
        </div>
        
        <div className="space-y-6 mb-auto">
          <div>
            <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-3">Identity</h4>
            <div className="bg-slate-800/50 p-3 rounded-lg border border-white/5">
              <p className="text-[9px] text-slate-500 uppercase font-black mb-0.5">Ghost ID</p>
              <p className="text-xs font-mono font-bold text-blue-400">{currentUser.username}</p>
            </div>
          </div>

          <div>
            <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-2">Rules</h4>
            <ul className="text-[10px] text-slate-400 space-y-2 font-medium">
              <li className="flex items-start"><span className="text-blue-500 mr-1.5">✔</span> Total Anonymity</li>
              <li className="flex items-start"><span className="text-blue-500 mr-1.5">✔</span> No Logs</li>
              <li className="flex items-start"><span className="text-red-500 mr-1.5">✘</span> No Identity</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <button onClick={() => setShowReconnectModal(true)} className="w-full py-2.5 bg-slate-800 rounded-lg text-[9px] font-black uppercase border border-white/5 flex items-center justify-center space-x-1.5 hover:bg-slate-700 transition-colors">
            <span>🔑</span><span>Restore</span>
          </button>
          <a href={BMC_LINK} target="_blank" rel="noopener noreferrer" className="w-full py-2.5 bg-blue-600/10 text-blue-400 rounded-lg text-[9px] font-black uppercase text-center border border-blue-600/20 hover:bg-blue-600/20 transition-all">Support Dev</a>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="z-50 h-14 md:h-16 bg-slate-900/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-4 md:px-6 shrink-0">
          <div className="flex items-center space-x-2 md:hidden">
            <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-[10px] shadow-lg">👻</div>
          </div>
          
          <button 
            onClick={() => setIsOpenToPrivate(!isOpenToPrivate)}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full border transition-all ${isOpenToPrivate ? 'bg-blue-600 text-white border-blue-400' : 'bg-slate-800 border-white/10 text-slate-400'}`}
          >
            <span className="text-[9px] font-black uppercase tracking-widest leading-none">Secret Invites</span>
            <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-black/20">{isOpenToPrivate ? 'ON' : 'OFF'}</span>
          </button>

          <div className="flex items-center space-x-2">
            <div className="relative">
              <button onClick={() => setShowNotificationMenu(!showNotificationMenu)} className={`p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all border border-white/5 ${activeIncomingRequest ? 'animate-bell-shake text-blue-400' : 'text-slate-400'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {activeIncomingRequest && <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>}
              </button>
              {showNotificationMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-[100] p-3 animate-in fade-in zoom-in-95">
                  {activeIncomingRequest ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-white leading-snug"><span className="text-blue-400">{activeIncomingRequest.fromName}</span> sent an invite.</p>
                      <div className="flex space-x-1.5">
                        <button onClick={() => { setActiveIncomingRequest(null); setShowNotificationMenu(false); }} className="flex-1 py-1.5 bg-slate-800 rounded text-[8px] font-black uppercase text-slate-400">Decline</button>
                        <button onClick={() => acceptRequest(activeIncomingRequest)} className="flex-1 py-1.5 bg-blue-600 rounded text-[8px] font-black uppercase text-white shadow-lg shadow-blue-900/40">Accept</button>
                      </div>
                    </div>
                  ) : <div className="text-center text-[9px] text-slate-600 py-2 font-bold uppercase tracking-widest">No Alerts</div>}
                </div>
              )}
            </div>
            <button onClick={() => setShowPeers(!showPeers)} className="p-2 bg-slate-800 rounded-lg relative border border-white/5 transition-transform active:scale-90">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              {onlineUsers.size > 1 && <span className="absolute -top-1 -right-1 bg-blue-600 text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center border border-slate-900 text-white">{onlineUsers.size - 1}</span>}
            </button>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden">
            <div className="absolute top-2 left-0 right-0 z-30 flex justify-center pointer-events-none">
              <div className="flex bg-slate-900/80 backdrop-blur-xl p-1 rounded-xl border border-white/10 pointer-events-auto shadow-xl scale-90 md:scale-100">
                <button 
                  onClick={() => { setActiveRoomId('community'); setActiveRoomType(RoomType.COMMUNITY); }}
                  className={`px-4 py-1.5 rounded-lg flex items-center space-x-2 transition-all ${activeRoomType === RoomType.COMMUNITY ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                >
                  <span className="text-[9px] font-black uppercase tracking-widest">Global</span>
                  <span className="text-[8px] font-bold opacity-70">{timeLeftGlobal}</span>
                </button>
                {[...privateRooms.values()].map((room: PrivateRoom) => {
                  const rem = Math.max(0, room.expiresAt - currentTime);
                  const mins = Math.floor(rem / 60000);
                  const secs = Math.floor((rem % 60000) / 1000);
                  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
                  
                  return (
                    <div key={room.id} className="flex ml-1 items-stretch">
                      <button 
                        onClick={() => { setActiveRoomId(room.id); setActiveRoomType(RoomType.PRIVATE); }}
                        className={`px-4 py-1.5 rounded-l-lg flex items-center space-x-2 transition-all ${activeRoomId === room.id ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}
                      >
                        <span className="text-[9px] font-black uppercase tracking-widest">Secret</span>
                        <span className="text-[8px] font-bold opacity-70">{timeStr}</span>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); exitPrivateRoom(room.id); }}
                        className={`px-2 flex items-center justify-center rounded-r-lg transition-all border-l border-white/10 hover:bg-red-500/30 ${activeRoomId === room.id ? 'bg-indigo-700 text-white' : 'bg-slate-900 text-slate-600'}`}
                      >
                        <span className="text-[9px] font-black">✕</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {isFinalFive && (
                <div className="z-20 bg-indigo-500/20 text-indigo-300 px-3 py-1.5 text-[8px] font-black uppercase tracking-widest text-center animate-pulse border-b border-white/5">
                  The static is closing in... session fading soon.
                </div>
              )}
              <ChatBox 
                messages={activeMessages} 
                currentUser={currentUser} 
                onSendMessage={handleSendMessage} 
                title={activeRoomType === RoomType.COMMUNITY ? 'Global' : 'Secret'} 
                isCommunity={activeRoomType === RoomType.COMMUNITY} 
                onUserClick={(userId, username) => setUserPopup({ userId, username })} 
              />
            </div>

            {userPopup && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setUserPopup(null)}></div>
                <div className="relative bg-slate-900 border border-white/10 p-6 rounded-[2rem] w-60 shadow-2xl animate-in zoom-in-95">
                  <div className="w-12 h-12 bg-blue-600/10 rounded-xl flex items-center justify-center mx-auto mb-4 text-xl border border-blue-600/20">👻</div>
                  <h4 className="text-center font-black text-sm mb-5 truncate text-white">{userPopup.username}</h4>
                  <div className="space-y-2">
                    <button 
                      disabled={sentRequestIds.has(userPopup.userId) || privateRooms.size > 0}
                      onClick={() => { const target = onlineUsers.get(userPopup.userId); if (target) sendRequest(target); }}
                      className="w-full py-3 bg-blue-600 text-white font-black rounded-xl text-[9px] uppercase tracking-widest disabled:opacity-30"
                    >{sentRequestIds.has(userPopup.userId) ? 'Sent' : 'Private Request'}</button>
                    <button onClick={() => setUserPopup(null)} className="w-full py-2 text-slate-600 font-bold uppercase text-[8px] text-center">Close</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className={`fixed inset-y-0 right-0 z-[70] w-60 bg-slate-900 border-l border-white/5 transform transition-transform duration-300 ${showPeers ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}>
            <div className="h-full flex flex-col p-5">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-black text-white/40 uppercase text-[9px] tracking-widest">Peers</h3>
                <button onClick={() => setShowPeers(false)} className="text-slate-500 hover:text-white">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                {[...onlineUsers.values()].filter((u: User) => u.id !== currentUser.id).map((u: User) => (
                  <button key={u.id} onClick={() => setUserPopup({ userId: u.id, username: u.username })} className="w-full text-left p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl group transition-colors hover:bg-white/[0.05]">
                    <p className="text-[11px] font-bold truncate text-white group-hover:text-blue-400">{u.username}</p>
                    <span className={`text-[7px] font-bold uppercase mt-0.5 block ${u.acceptingRequests ? 'text-blue-500' : 'text-slate-700'}`}>{u.acceptingRequests ? 'Accepting' : 'Busy'}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </main>
      </div>

      {showExtendPopup && (
        <div className="fixed inset-0 z-[110] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-slate-900 p-6 rounded-[2rem] w-full max-w-[280px] border border-white/10 text-center">
            <h3 className="text-sm font-black text-white uppercase tracking-tighter mb-2">Channel Fading</h3>
            <p className="text-[10px] text-slate-400 mb-6 px-2">Extend the connection by 30 minutes?</p>
            <div className="space-y-2">
              <button onClick={() => extendPrivateRoom(showExtendPopup)} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl text-[9px] uppercase tracking-widest shadow-lg shadow-blue-900/40">Extend Link</button>
              <button onClick={() => setShowExtendPopup(null)} className="w-full py-2.5 bg-slate-800 text-slate-500 font-bold rounded-lg text-[9px] uppercase">Let it fade</button>
            </div>
          </div>
        </div>
      )}

      {showReconnectModal && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center z-[100] p-4">
          <div className="bg-slate-900 p-8 rounded-[2rem] w-full max-w-[320px] border border-white/5">
            <div className="text-center mb-6">
              <h3 className="text-lg font-black text-white uppercase tracking-tighter">Restore Key</h3>
              <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-widest">Enter the secret session code</p>
            </div>
            <input 
              type="text" 
              maxLength={6} 
              value={reconnectInput} 
              onChange={(e) => setReconnectInput(e.target.value.toUpperCase())} 
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-2xl text-center font-mono font-black tracking-[0.3em] text-blue-400 mb-6 outline-none focus:border-blue-500/50" 
              placeholder="••••••" 
            />
            <button onClick={() => { socket.emit({ type: 'CHAT_REJOIN', reconnectCode: reconnectInput }); setShowReconnectModal(false); }} className="w-full py-4 bg-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-blue-900/40">Link Channel</button>
            <button onClick={() => setShowReconnectModal(false)} className="w-full py-3 mt-1 text-slate-600 font-bold uppercase text-[9px]">Cancel</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bell-shake { 0% { transform: rotate(0); } 15% { transform: rotate(8deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(4deg); } 60% { transform: rotate(-4deg); } 100% { transform: rotate(0); } }
        .animate-bell-shake { animation: bell-shake 0.8s ease-in-out infinite; transform-origin: top; }
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
