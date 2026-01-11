
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, User } from '../types';
import { formatTime } from '../utils/helpers';

interface ChatBoxProps {
  messages: Message[];
  currentUser: User;
  onSendMessage: (text: string) => void;
  title: string;
  isCommunity?: boolean;
  onUserClick?: (userId: string, username: string) => void;
  onReport?: (msgId: string) => void;
}

const ChatBox: React.FC<ChatBoxProps> = ({ messages, currentUser, onSendMessage, onUserClick }) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const [now, setNow] = useState(Date.now());

  // Clock to trigger re-renders for the 5-minute fading/expiry
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  // Filter messages to show only those sent within the last 5 minutes
  const visibleMessages = messages.filter(m => now - m.timestamp < 300000);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior
      });
    }
  }, []);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Using a tighter threshold for better UX: if within 100px of bottom, consider "at bottom"
      isAtBottom.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  };

  // Only trigger auto-scroll when a NEW message arrives at the bottom
  const lastMessageId = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].id : null;
  
  useEffect(() => {
    if (isAtBottom.current && lastMessageId) {
      scrollToBottom('smooth');
    }
  }, [lastMessageId, scrollToBottom]);

  // Maintain scroll on resize (mobile keyboard)
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
      onSendMessage(text);
      setInputText('');
      // Force "at bottom" to true so we scroll to our own new message
      isAtBottom.current = true;
      setTimeout(() => scrollToBottom('smooth'), 50);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 relative overflow-hidden">
      <style>{`
        @keyframes disperse {
          0% { opacity: 1; transform: scale(1) filter: blur(0px); }
          100% { opacity: 0; transform: scale(1.05) translateY(-10px); filter: blur(4px); }
        }
        .message-disperse { animation: disperse 1s cubic-bezier(0.4, 0, 0.2, 1) forwards; pointer-events: none; }
      `}</style>
      
      {/* WATERMARK BRANDING */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center opacity-[0.03] select-none z-0">
        <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none">Ghost Talk</h2>
        <div className="flex flex-col items-center mt-2 text-center">
          <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] opacity-60">Chats fade after five minutes</p>
          <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] mt-1 opacity-60">global resets after every 30 minutes</p>
        </div>
      </div>

      {/* MESSAGES AREA */}
      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 md:px-6 pt-16 pb-4 md:pt-20 md:pb-6 space-y-1 custom-scrollbar z-10 overscroll-contain touch-pan-y"
      >
        {visibleMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-30 select-none text-center">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-3xl shadow-xl border border-white/5">👻</div>
            <div className="space-y-1">
              <p className="text-sm font-black uppercase tracking-widest text-white">Silence</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Voices fade into the static</p>
            </div>
          </div>
        )}

        {visibleMessages.map((msg, idx) => {
          const isOwn = msg.senderId === currentUser.id;
          const prevMsg = visibleMessages[idx - 1];
          const isCompact = prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp < 60000);
          const age = now - msg.timestamp;
          const isExpiring = age >= 299000;

          return (
            <div 
              key={msg.id} 
              className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${isCompact ? 'mt-0.5' : 'mt-3'} group ${isExpiring ? 'message-disperse' : ''}`}
            >
              {!isCompact && (
                <div className={`flex items-center space-x-1.5 mb-0.5 px-1 ${isOwn ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  <button 
                    onClick={() => !isOwn && onUserClick?.(msg.senderId, msg.senderName)}
                    className={`text-[10px] font-bold uppercase tracking-wide ${!isOwn ? 'text-blue-400' : 'text-slate-600'}`}
                  >{msg.senderName}</button>
                  <span className="text-[9px] font-medium text-slate-700">{formatTime(msg.timestamp)}</span>
                </div>
              )}
              
              <div className={`relative max-w-[92%] md:max-w-[80%] py-1.5 px-3.5 rounded-xl md:rounded-2xl text-[13px] md:text-sm leading-snug shadow-sm ${isOwn ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-900 text-slate-200 rounded-tl-none'}`}>
                <div className="whitespace-pre-wrap break-words font-medium">{msg.text}</div>
              </div>
            </div>
          );
        })}
        <div className="h-2 w-full shrink-0" />
      </div>

      {/* INPUT AREA */}
      <div className="p-2 md:p-3 bg-slate-900/95 backdrop-blur-3xl border-t border-white/5 z-20 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex items-center space-x-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Ghost a message..."
            rows={1}
            className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-[14px] focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-slate-100 placeholder-slate-700 resize-none"
            style={{ maxHeight: '120px' }}
          />
          <button 
            type="submit" 
            disabled={!inputText.trim()} 
            className="bg-blue-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/20 active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatBox;
