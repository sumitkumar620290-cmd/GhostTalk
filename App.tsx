
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Message, PrivateRoom, ChatRequest, RoomType } from './types';
import { generateId, generateUsername, generateReconnectCode } from './utils/helpers';
import SocketService from './services/socketService';
import ChatBox from './components/ChatBox';

interface InitStatePayload {
  communityMessages: Message[];
  communityTimerEnd: number;
  siteTimerEnd: number;
}

interface HeartbeatPayload {
  user: User;
  communityTimerEnd?: number;
  siteTimerEnd?: number;
}

interface MessagePayload {
  message: Message;
}

interface ResetCommunityPayload {
  nextReset: number;
}

interface ChatRequestPayload {
  request: ChatRequest;
}

interface ChatAcceptPayload {
  requestId: string;
  room: PrivateRoom;
}

const App: React.FC = () => {
  // UI States
  const [isAgeVerified, setIsAgeVerified] = useState<boolean | null>(null);
  const [showMobileRules, setShowMobileRules] = useState(false);
  const [showPeers, setShowPeers] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [showKeyAlert, setShowKeyAlert] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  const [currentUser, setCurrentUser] = useState<User>(() => ({
    id: generateId(),
    username: generateUsername(),
    lastActive: Date.now(),
    acceptingRequests: false, 
    isDeciding: false
  }));

  const [isOpenToPrivate, setIsOpenToPrivate] = useState(false);
  const [reportedMessageIds] = useState<Set<string>>(new Set());
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());
  const [sentRequestIds, setSentRequestIds] = useState<Set<string>>(new Set());
  
  const [userPopup, setUserPopup] = useState<{ userId: string, username: string } | null>(null);

  const isOpenToPrivateRef = useRef(isOpenToPrivate);
  useEffect(() => {
    isOpenToPrivateRef.current = isOpenToPrivate;
    setCurrentUser(prev => ({ ...prev, acceptingRequests: isOpenToPrivate }));
  }, [isOpenToPrivate]);

  const [commTimerEnd, setCommTimerEnd] = useState<number>(Date.now() + 1800000);

  const [messages, setMessages] = useState<Message[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('community');
  const [activeRoomType, setActiveRoomType] = useState<RoomType>(RoomType.COMMUNITY);
  const [privateRooms, setPrivateRooms] = useState<Map<string, PrivateRoom>>(() => new Map());
  const [onlineUsers, setOnlineUsers] = useState<Map<string, User>>(() => new Map());

  const [activeIncomingRequest, setActiveIncomingRequest] = useState<ChatRequest | null>(null);
  const requestExpiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const socket = useMemo(() => new SocketService(currentUser), []);

  // Central ticker for all timers
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setCurrentTime(now);
      
      // Auto-switch away from community if it resets while active
      if (activeRoomType === RoomType.COMMUNITY && now >= commTimerEnd) {
          setMessages(prev => prev.filter(m => m.roomId !== 'community'));
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [commTimerEnd, activeRoomType]);

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
    
    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });

    socket.emit({ type: 'MESSAGE', message: msg });
  };

  const sendRequest = (targetUser: User) => {
    if (targetUser.id === currentUser.id) return;
    if (sentRequestIds.has(targetUser.id)) return;
    if (privateRooms.size > 0) {
      alert("You can only have one active private chat.");
      return;
    }
    if (!targetUser.acceptingRequests || targetUser.isDeciding) return;
    
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
    alert(`Private chat request sent to ${targetUser.username}!`);
    setUserPopup(null);
  };

  const acceptRequest = (req: ChatRequest) => {
    if (privateRooms.size > 0) {
      alert("You already have an active private chat.");
      setActiveIncomingRequest(null);
      setCurrentUser(prev => ({ ...prev, isDeciding: false }));
      setShowNotificationMenu(false);
      return;
    }
    if (requestExpiryTimer.current) clearTimeout(requestExpiryTimer.current);
    const room: PrivateRoom = {
      id: generateId(),
      participants: [req.fromId, req.toId],
      reconnectCode: generateReconnectCode(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 1800000 // 30 minutes
    };
    socket.emit({ type: 'CHAT_ACCEPT', requestId: req.id, room });
    setActiveIncomingRequest(null);
    setCurrentUser(prev => ({ ...prev, isDeciding: false }));
    setShowNotificationMenu(false);
    setShowKeyAlert(true);
  };

  useEffect(() => {
    socket.on<InitStatePayload>('INIT_STATE', (data) => {
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newMessages = (data.communityMessages || []).filter(m => !existingIds.has(m.id));
        return [...prev, ...newMessages];
      });
      setCommTimerEnd(data.communityTimerEnd);
    });

    socket.on<HeartbeatPayload>('HEARTBEAT', (data) => {
      setOnlineUsers(prev => {
        const next = new Map(prev);
        next.set(data.user.id, { ...data.user, lastActive: Date.now() });
        return next;
      });
      if (data.communityTimerEnd) setCommTimerEnd(data.communityTimerEnd);
    });

    socket.on<MessagePayload>('MESSAGE', (data) => {
      setMessages(prev => {
        if (prev.find(m => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
    });

    socket.on<ResetCommunityPayload>('RESET_COMMUNITY', (data) => {
      setMessages(prev => prev.filter(m => m.roomId !== 'community'));
      setCommTimerEnd(data.nextReset);
    });

    socket.on('RESET_SITE', () => {
      window.location.reload();
    });

    socket.on<ChatRequestPayload>('CHAT_REQUEST', (data) => {
      if (data.request.toId === currentUser.id && isOpenToPrivateRef.current && privateRooms.size === 0) {
        setCurrentUser(prev => {
          if (prev.isDeciding) return prev;
          setActiveIncomingRequest(data.request);
          if (requestExpiryTimer.current) clearTimeout(requestExpiryTimer.current);
          requestExpiryTimer.current = setTimeout(() => {
            setActiveIncomingRequest(null);
            setCurrentUser(p => ({ ...p, isDeciding: false }));
          }, 30000);
          return { ...prev, isDeciding: true };
        });
      }
    });

    socket.on<ChatAcceptPayload>('CHAT_ACCEPT', (data) => {
      setPrivateRooms(prev => {
        const next = new Map(prev);
        next.set(data.room.id, data.room);
        return next;
      });
      if (data.room.participants.includes(currentUser.id)) {
        setActiveRoomId(data.room.id);
        setActiveRoomType(RoomType.PRIVATE);
        setShowKeyAlert(true);
      }
    });

    return () => socket.close();
  }, [socket, currentUser.id, privateRooms.size]);

  const activeMessages = useMemo(() => 
    messages.filter(m => 
      m.roomId === activeRoomId && 
      !reportedMessageIds.has(m.id) &&
      !hiddenUserIds.has(m.senderId)
    ), 
    [messages, activeRoomId, reportedMessageIds, hiddenUserIds]
  );

  const activePrivateRoom = useMemo(() => {
    if (activeRoomType === RoomType.PRIVATE) {
      return privateRooms.get(activeRoomId);
    }
    return null;
  }, [activeRoomType, activeRoomId, privateRooms]);

  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [reconnectInput, setReconnectInput] = useState('');

  const BMC_LINK = "https://www.buymeacoffee.com";

  if (isAgeVerified === null) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl animate-in zoom-in-95">
          <div className="text-4xl mb-4">🔞</div>
          <h2 className="text-2xl font-black mb-4 uppercase tracking-tighter">Are you 18+?</h2>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            This space is for 18+ conversations only. By entering, you confirm you are of legal age.
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => setIsAgeVerified(true)}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all uppercase tracking-widest active:scale-95 shadow-xl shadow-blue-900/20"
            >
              Yes, I am 18+
            </button>
            <button 
              onClick={() => setIsAgeVerified(false)}
              className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-2xl transition-all"
            >
              No
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-screen overflow-hidden bg-slate-950 text-slate-100 selection:bg-blue-500/30">
      
      {/* SIDEBAR */}
      <aside className="hidden md:flex flex-col w-72 bg-slate-900 border-r border-white/5 shrink-0">
        <div className="p-8 flex flex-col h-full">
          <div className="mb-10">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center font-black text-white shadow-lg">
                {currentUser.username.charAt(5)}
              </div>
              <div>
                <p className="text-lg font-black tracking-tight leading-none">Ghost Talk</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Temporary Conversations</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] mb-2">Rules</h4>
              <ul className="text-xs text-slate-400 space-y-3 leading-relaxed">
                <li className="flex items-start space-x-2"><span className="text-blue-500 mt-0.5">•</span><span>No login. Anonymous.</span></li>
                <li className="flex items-start space-x-2"><span className="text-blue-500 mt-0.5">•</span><span>Respect other ghosts.</span></li>
                <li className="flex items-start space-x-2"><span className="text-blue-500 mt-0.5">•</span><span>Consent required for private chat.</span></li>
                <li className="flex items-start space-x-2"><span className="text-blue-500 mt-0.5">•</span><span>Messages vanish in 5m.</span></li>
              </ul>
            </div>
          </div>

          <div className="mt-auto space-y-3">
            <button 
              onClick={() => setShowReconnectModal(true)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all text-slate-300 flex items-center justify-center space-x-2 border border-white/5"
            >
              <span>🔑</span><span>Rejoin Session</span>
            </button>
            <a 
              href={BMC_LINK} target="_blank" rel="noopener noreferrer"
              className="w-full py-4 bg-amber-500/10 hover:bg-amber-500 text-amber-500 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center space-x-2 border border-amber-500/20"
            >
              <span>☕</span><span>Buy Me a Coffee</span>
            </a>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="z-50 h-16 md:h-20 bg-slate-900/95 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-3 md:px-8 shrink-0 relative">
          <div className="flex items-center min-w-0">
            <button onClick={() => setShowMobileRules(true)} className="flex items-center space-x-2 md:hidden">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-black shrink-0">{currentUser.username.charAt(5)}</div>
              <span className="text-[10px] font-black tracking-widest uppercase truncate max-w-[50px]">Ghost</span>
            </button>
            <div className="hidden md:flex items-center space-x-2 bg-slate-950/50 px-3 py-1.5 rounded-lg border border-white/5">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Live</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 md:space-x-3">
            <button 
              onClick={() => setIsOpenToPrivate(!isOpenToPrivate)}
              className={`flex items-center space-x-2 md:space-x-3 px-2.5 md:px-6 py-1.5 md:py-2.5 rounded-full border transition-all duration-300 ${
                isOpenToPrivate ? 'bg-blue-600 text-white shadow-lg border-blue-400' : 'bg-slate-800 border-white/10 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <span className="text-[9px] md:text-xs font-black uppercase tracking-widest leading-none">Private Chat</span>
              <span className="text-[8px] opacity-60 font-bold uppercase leading-none">{isOpenToPrivate ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div className="flex items-center space-x-1.5 md:space-x-4">
            <div className="relative">
              <button 
                onClick={() => setShowNotificationMenu(!showNotificationMenu)}
                className={`p-2 md:p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all border border-white/5 relative group ${activeIncomingRequest ? 'animate-bell-shake' : ''}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 md:h-5 md:w-5 ${activeIncomingRequest ? 'text-blue-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {activeIncomingRequest && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-900"></span>}
              </button>
              {showNotificationMenu && (
                <div className="absolute right-0 mt-3 w-64 md:w-72 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl z-[100] animate-in zoom-in-95">
                  <div className="p-4 border-b border-white/5 text-[10px] font-black uppercase tracking-widest text-slate-500">Alerts</div>
                  <div className="p-4">
                    {activeIncomingRequest ? (
                      <div className="space-y-4">
                        <div className="text-[11px] font-bold text-slate-300">Invite from {activeIncomingRequest.fromName}</div>
                        <div className="flex space-x-2">
                          <button onClick={() => { setActiveIncomingRequest(null); setShowNotificationMenu(false); }} className="flex-1 py-2 bg-slate-800 rounded-lg text-[9px] font-black uppercase">Ignore</button>
                          <button onClick={() => acceptRequest(activeIncomingRequest)} className="flex-1 py-2 bg-blue-600 rounded-lg text-[9px] font-black uppercase">Accept</button>
                        </div>
                      </div>
                    ) : <div className="text-center text-[10px] text-slate-600 py-4 uppercase">No Requests</div>}
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setShowPeers(!showPeers)} className="p-2 md:p-2.5 bg-slate-800 rounded-xl relative border border-white/5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              {onlineUsers.size > 1 && <span className="absolute -top-1 -right-1 bg-blue-600 text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center">{onlineUsers.size - 1}</span>}
            </button>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden">
            {/* Private Room Secret Key Overlay */}
            {activePrivateRoom && showKeyAlert && (
              <div className="absolute top-24 md:top-28 left-1/2 -translate-x-1/2 z-[45] w-[calc(100%-2rem)] max-w-sm">
                <div className="bg-indigo-600 text-white p-4 rounded-3xl shadow-2xl border border-white/20 animate-in slide-in-from-top-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Secret Room Access Key</span>
                    <button onClick={() => setShowKeyAlert(false)} className="text-white/50 hover:text-white">✕</button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-mono font-black tracking-[0.3em]">{activePrivateRoom.reconnectCode}</div>
                    <div className="text-[9px] font-bold text-white/70 max-w-[120px] text-right">Write this down to rejoin if disconnected</div>
                  </div>
                </div>
              </div>
            )}

            {/* Room Tabs Indicator with Timers */}
            <div className="absolute top-4 left-0 right-0 z-30 flex justify-center pointer-events-none">
              <div className="flex bg-slate-900/70 backdrop-blur-xl p-1.5 rounded-[1.25rem] border border-white/10 pointer-events-auto shadow-2xl">
                <button 
                  onClick={() => { setActiveRoomId('community'); setActiveRoomType(RoomType.COMMUNITY); }}
                  className={`px-6 py-2 rounded-xl flex flex-col items-center transition-all ${activeRoomType === RoomType.COMMUNITY ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <span className="text-[10px] font-black uppercase tracking-widest">Global</span>
                  <span className="text-[8px] font-bold opacity-80 uppercase tracking-tight mt-0.5">Reset in {timeLeftGlobal}</span>
                </button>
                {Array.from<PrivateRoom>(privateRooms.values()).map(room => {
                  const pDiff = Math.max(0, room.expiresAt - currentTime);
                  const pMins = Math.floor(pDiff / 60000);
                  const pSecs = Math.floor((pDiff % 60000) / 1000);
                  const pTimeStr = `${pMins.toString().padStart(2, '0')}:${pSecs.toString().padStart(2, '0')}`;
                  
                  return (
                    <button 
                      key={room.id}
                      onClick={() => { setActiveRoomId(room.id); setActiveRoomType(RoomType.PRIVATE); }}
                      className={`px-6 py-2 rounded-xl flex flex-col items-center transition-all ml-1.5 ${activeRoomId === room.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest">Secret</span>
                      <span className="text-[8px] font-bold opacity-80 uppercase tracking-tight mt-0.5">Ends in {pTimeStr}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Profile Action Popup */}
            {userPopup && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center p-6 md:absolute md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2">
                <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm md:hidden" onClick={() => setUserPopup(null)}></div>
                <div className="relative bg-slate-900 border border-white/10 p-6 rounded-[2rem] w-64 shadow-2xl animate-in zoom-in-95">
                  <h4 className="text-center font-black text-lg mb-6 truncate">{userPopup.username}</h4>
                  <div className="space-y-3">
                    <button 
                      disabled={sentRequestIds.has(userPopup.userId) || privateRooms.size > 0}
                      onClick={() => { const target = onlineUsers.get(userPopup.userId); if (target) sendRequest(target); }}
                      className="w-full py-4 bg-blue-600 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-30"
                    >{sentRequestIds.has(userPopup.userId) ? 'Pending...' : 'Invite to Private'}</button>
                    <button onClick={() => { setHiddenUserIds(prev => new Set(prev).add(userPopup.userId)); setUserPopup(null); }} className="w-full py-3 bg-slate-800 text-slate-500 font-bold rounded-xl text-[10px] uppercase">Hide/Report</button>
                    <button onClick={() => setUserPopup(null)} className="w-full py-2 text-slate-600 font-bold uppercase text-[9px]">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <ChatBox 
                messages={activeMessages} 
                currentUser={currentUser} 
                onSendMessage={handleSendMessage}
                title={activeRoomType === RoomType.COMMUNITY ? 'Global' : 'Secret'}
                isCommunity={activeRoomType === RoomType.COMMUNITY}
                onUserClick={(userId, username) => setUserPopup({ userId, username })}
              />
            </div>
          </div>

          {/* PEERS SIDEBAR */}
          <aside className={`fixed inset-y-0 right-0 z-[70] w-64 bg-slate-900 border-l border-white/5 transform transition-transform duration-500 ${showPeers ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}>
            <div className="h-full flex flex-col p-6">
              <div className="flex items-center justify-between mb-8"><h3 className="font-black text-white/50 uppercase text-[10px] tracking-widest">Peers</h3><button onClick={() => setShowPeers(false)} className="text-slate-500">✕</button></div>
              <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                {Array.from<User>(onlineUsers.values()).filter(u => u.id !== currentUser.id && !hiddenUserIds.has(u.id)).map(u => (
                  <button key={u.id} onClick={() => setUserPopup({ userId: u.id, username: u.username })} className="w-full text-left p-4 bg-white/[0.03] border border-white/[0.05] rounded-2xl transition-all hover:bg-white/[0.06]">
                    <p className="text-xs font-black truncate">{u.username}</p>
                    <span className="text-[9px] font-bold text-slate-500 uppercase">{u.acceptingRequests ? 'Unlocked' : 'Locked'}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </main>
      </div>

      {/* REJOIN MODAL */}
      {showReconnectModal && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center z-[100] p-4">
          <div className="bg-slate-900 p-8 rounded-[2.5rem] w-full max-w-sm border border-white/5 shadow-2xl">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-600/10 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 border border-blue-600/20">🔑</div>
              <h3 className="text-xl font-black text-white uppercase tracking-tighter">Enter Secret Key</h3>
              <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase">Restore access to a private chat</p>
            </div>
            <input 
              type="text" maxLength={6} value={reconnectInput} onChange={(e) => setReconnectInput(e.target.value.toUpperCase())}
              className="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl p-6 text-3xl text-center font-mono font-black tracking-[0.4em] text-blue-400 mb-8 outline-none" placeholder="••••••"
            />
            <button 
              onClick={() => {
                const room = Array.from<PrivateRoom>(privateRooms.values()).find(r => r.reconnectCode === reconnectInput);
                if (room) { setActiveRoomId(room.id); setActiveRoomType(RoomType.PRIVATE); setShowReconnectModal(false); setShowKeyAlert(true); } 
                else { alert("Invalid or Expired Code."); }
              }} 
              className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95"
            >Restore</button>
            <button onClick={() => setShowReconnectModal(false)} className="w-full py-4 mt-2 text-slate-500 font-bold uppercase text-[10px]">Close</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bell-shake { 0% { transform: rotate(0); } 15% { transform: rotate(10deg); } 30% { transform: rotate(-10deg); } 45% { transform: rotate(8deg); } 60% { transform: rotate(-8deg); } 75% { transform: rotate(4deg); } 85% { transform: rotate(-4deg); } 100% { transform: rotate(0); } }
        .animate-bell-shake { animation: bell-shake 0.8s cubic-bezier(.36,.07,.19,.97) both; transform-origin: top; }
      `}</style>
    </div>
  );
};

export default App;
