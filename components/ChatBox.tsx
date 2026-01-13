import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, User, RoomType } from '../types';
import { formatTime } from '../utils/helpers';

interface ChatBoxProps {
  messages: Message[];
  currentUser: User;
  onSendMessage: (text: string, replyTo?: Message['replyTo']) => void;
  title: string;
  roomType: RoomType;
  onUserClick?: (userId: string, username: string) => void;
  onReport?: (msgId: string) => void;
}

const ChatBox: React.FC<ChatBoxProps> = ({ messages, currentUser, onSendMessage, onUserClick, roomType }) => {
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  
  // Swipe State
  const [activeSwipeId, setActiveSwipeId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStartRef = useRef<{ x: number; id: string } | null>(null);
  const SWIPE_THRESHOLD = 60;
  const MAX_SWIPE = 80;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottom = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const lastSeenMessageId = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  const visibleMessages = messages.filter(m => roomType === RoomType.PRIVATE ? true : now - m.timestamp < 300000);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior
      });
      setShowScrollButton(false);
      isAtBottom.current = true;
    }
  }, []);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
      isAtBottom.current = nearBottom;
      
      if (nearBottom) {
        setShowScrollButton(false);
        if (visibleMessages.length > 0) {
          lastSeenMessageId.current = visibleMessages[visibleMessages.length - 1].id;
        }
      }
    }
  };

  const currentLastMessageId = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].id : null;
  
  useEffect(() => {
    if (currentLastMessageId) {
      if (isAtBottom.current) {
        scrollToBottom('smooth');
        lastSeenMessageId.current = currentLastMessageId;
      } else {
        if (currentLastMessageId !== lastSeenMessageId.current) {
          setShowScrollButton(true);
        }
      }
    }
  }, [currentLastMessageId, scrollToBottom]);

  useEffect(() => {
    const handleResize = () => {
      if (isAtBottom.current) scrollToBottom('auto');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [scrollToBottom]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (text) {
      onSendMessage(text, replyingTo ? { text: replyingTo.text, senderName: replyingTo.senderName } : undefined);
      setInputText('');
      setReplyingTo(null);
      isAtBottom.current = true;
      setTimeout(() => {
        scrollToBottom('smooth');
        inputRef.current?.focus();
      }, 50);
    }
  };

  const startSwipe = (e: React.TouchEvent, id: string, senderId: string) => {
    if (senderId === 'system') return;
    swipeStartRef.current = { x: e.touches[0].clientX, id };
    setActiveSwipeId(id);
  };

  const moveSwipe = (e: React.TouchEvent) => {
    if (!swipeStartRef.current) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - swipeStartRef.current.x;
    
    // Support right swipe to reply
    if (deltaX > 0) {
      setSwipeOffset(Math.min(deltaX, MAX_SWIPE));
    } else {
      setSwipeOffset(0);
    }
  };

  const endSwipe = () => {
    if (activeSwipeId && swipeOffset >= SWIPE_THRESHOLD) {
      const msg = visibleMessages.find(m => m.id === activeSwipeId);
      if (msg) {
        handleReplyClick(msg);
      }
    }
    
    // Smooth reset
    swipeStartRef.current = null;
    setSwipeOffset(0);
    setTimeout(() => setActiveSwipeId(null), 300); // Wait for transition
  };

  const handleReplyClick = (msg: Message) => {
    setReplyingTo(msg);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 relative overflow-hidden">
      <style>{`
        @keyframes disperse {
          0% { opacity: 1; transform: scale(1) filter: blur(0px); }
          100% { opacity: 0; transform: scale(1.05) translateY(-10px); filter: blur(4px); }
        }
        .message-disperse { animation: disperse 1s cubic-bezier(0.4, 0, 0.2, 1) forwards; pointer-events: none; }
        
        .message-entry {
          animation: message-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        @keyframes message-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .swipe-transition {
          transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
      `}</style>
      
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center opacity-[0.12] select-none z-0">
        <div className="text-5xl md:text-6xl mb-4 grayscale brightness-200">👻</div>
        <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none text-slate-100">Ghost Talk</h2>
        <div className="flex flex-col items-center mt-2 text-center max-w-[80%]">
          {roomType === RoomType.PRIVATE ? (
            <>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">PRIVATE CHAT</p>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] mt-1 text-slate-300">Messages exist only during this private session</p>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] mt-1 text-slate-300">Maximum private chat duration: 1 hour</p>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] mt-1 text-slate-300">No memory. No records.</p>
            </>
          ) : (
            <>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">Chats fade after five minutes</p>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] mt-1 text-slate-300">global resets after every 30 minutes</p>
            </>
          )}
        </div>
      </div>

      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 md:px-6 pt-24 pb-4 md:pt-32 md:pb-6 space-y-1 custom-scrollbar z-10 overscroll-contain touch-pan-y"
      >
        {visibleMessages.map((msg, idx) => {
          const isOwn = msg.senderId === currentUser.id;
          const prevMsg = visibleMessages[idx - 1];
          const isCompact = prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp < 60000);
          const age = now - msg.timestamp;
          const isExpiring = roomType === RoomType.COMMUNITY && age >= 299000;
          
          const isBeingSwiped = activeSwipeId === msg.id;
          const currentOffset = isBeingSwiped ? swipeOffset : 0;
          const isOverThreshold = isBeingSwiped && swipeOffset >= SWIPE_THRESHOLD;

          return (
            <div 
              key={msg.id} 
              className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${isCompact ? 'mt-0.5' : 'mt-3'} group relative ${isExpiring ? 'message-disperse' : 'message-entry'} ${msg.senderId === 'system' ? 'opacity-80 transition-opacity duration-500' : ''}`}
              onTouchStart={(e) => startSwipe(e, msg.id, msg.senderId)}
              onTouchMove={moveSwipe}
              onTouchEnd={endSwipe}
            >
              {!isCompact && msg.senderId !== 'system' && (
                <div className={`flex items-center space-x-1.5 mb-0.5 px-1 ${isOwn ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  <button 
                    onClick={() => !isOwn && onUserClick?.(msg.senderId, msg.senderName)}
                    className={`text-[10px] font-bold uppercase tracking-wide ${!isOwn ? 'text-blue-400' : 'text-slate-600'} active:opacity-60 transition-opacity`}
                  >{msg.senderName}</button>
                  <span className="text-[9px] font-medium text-slate-700">{formatTime(msg.timestamp)}</span>
                </div>
              )}
              
              <div className={`relative flex items-center w-full ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Swipe Indicator */}
                <div className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center transition-all duration-200 ${isBeingSwiped ? 'opacity-100' : 'opacity-0'}`} style={{ transform: `translateX(${Math.min(currentOffset / 2, 30)}px)` }}>
                    <div className={`p-1.5 rounded-full transition-colors ${isOverThreshold ? 'bg-blue-600 text-white scale-110' : 'bg-slate-800 text-slate-500'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                    </div>
                </div>

                <div 
                  className={`relative max-w-[92%] md:max-w-[80%] py-1.5 px-3.5 rounded-xl md:rounded-2xl text-[13px] md:text-sm leading-snug shadow-sm ${!swipeStartRef.current ? 'swipe-transition' : ''} ${isOwn ? 'bg-blue-600 text-white rounded-tr-none' : (msg.senderId === 'system' ? 'bg-slate-800/50 text-slate-400 border border-white/5 rounded-lg' : 'bg-slate-900 text-slate-200 rounded-tl-none')}`}
                  style={{ transform: `translateX(${currentOffset}px)` }}
                >
                  {msg.replyTo && (
                    <div className={`mb-1.5 p-2 rounded-lg text-[11px] border-l-2 ${isOwn ? 'bg-black/20 border-blue-400/50 text-blue-100' : 'bg-white/5 border-slate-700 text-slate-400'}`}>
                      <p className="font-black uppercase text-[8px] mb-0.5 opacity-70">{msg.replyTo.senderName}</p>
                      <p className="truncate line-clamp-1 italic">{msg.replyTo.text}</p>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words font-medium">{msg.text}</div>
                </div>

                {msg.senderId !== 'system' && (
                  <button 
                    onClick={() => handleReplyClick(msg)}
                    className="hidden md:flex mx-2 p-1.5 rounded-full bg-slate-800 text-slate-400 opacity-0 group-hover:opacity-100 transition-all hover:text-blue-400 active:scale-90"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="h-2 w-full shrink-0" />
      </div>

      {showScrollButton && (
        <button 
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[30] px-4 py-2 bg-slate-900/90 text-blue-400 border border-blue-500/20 text-[9px] font-black uppercase tracking-widest rounded-full shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 transition-all active:scale-95"
        >
          ↓ New messages
        </button>
      )}

      <div className="p-2 md:p-3 bg-slate-900/95 backdrop-blur-3xl border-t border-white/5 z-20 shrink-0">
        {replyingTo && (
          <div className="max-w-3xl mx-auto mb-2 flex items-center justify-between bg-slate-950/50 p-2 rounded-xl border border-white/5 animate-in slide-in-from-bottom-1">
            <div className="flex-1 min-w-0 pr-4">
              <p className="text-[10px] font-black uppercase text-blue-500 mb-0.5">Replying to {replyingTo.senderName}</p>
              <p className="text-[11px] text-slate-500 truncate italic">{replyingTo.text}</p>
            </div>
            <button onClick={() => setReplyingTo(null)} className="text-slate-600 hover:text-white transition-colors p-1 active:scale-90">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex items-center space-x-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Ghost a message..."
            rows={1}
            className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-slate-100 placeholder-slate-700 resize-none transition-all"
            style={{ maxHeight: '120px' }}
          />
          <button 
            type="submit" 
            disabled={!inputText.trim()} 
            onPointerDown={(e) => e.preventDefault()}
            className="bg-blue-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/20 active:scale-95 transition-transform disabled:opacity-50 disabled:grayscale"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatBox;