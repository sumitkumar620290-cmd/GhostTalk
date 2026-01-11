
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

const ChatBox: React.FC<ChatBoxProps> = ({ messages, currentUser, onSendMessage, title, isCommunity, onUserClick }) => {
  const [inputText, setInputText] = useState('');
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    const filterMessages = () => {
      if (!isCommunity) {
        setVisibleMessages(messages);
        return;
      }
      const currentTime = Date.now();
      const filtered = messages.filter(m => currentTime - m.timestamp < 301000);
      
      setVisibleMessages(prev => {
        if (prev.length === filtered.length && 
            (prev.length === 0 || prev[prev.length-1].id === filtered[filtered.length-1].id)) {
          return prev;
        }
        return filtered;
      });
    };

    filterMessages();
    const interval = setInterval(filterMessages, 1000);
    return () => clearInterval(interval);
  }, [messages, isCommunity]);

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
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      isAtBottom.current = atBottom;
    }
  };

  useEffect(() => {
    if (isAtBottom.current) {
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [visibleMessages, scrollToBottom]);

  useEffect(() => {
    const handleResize = () => {
      if (isAtBottom.current) {
        scrollToBottom('auto');
      }
    };
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, [scrollToBottom]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
      isAtBottom.current = true;
      setTimeout(() => scrollToBottom('smooth'), 100);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 relative overflow-hidden">
      <style>{`
        @keyframes disperse {
          0% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0px); }
          100% { opacity: 0; transform: scale(1.15) translateY(-20px); filter: blur(8px); }
        }
        .message-disperse { animation: disperse 1s cubic-bezier(0.4, 0, 0.2, 1) forwards; pointer-events: none; }
      `}</style>
      
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-end pb-32 md:pb-48 opacity-[0.03] select-none z-0">
        <h2 className="text-[12vw] font-black uppercase tracking-tighter leading-none mb-4">Ghost Talk</h2>
        <div className="text-center space-y-2">
          <p className="text-xl md:text-2xl font-black uppercase tracking-[0.5em]">Messages delete after 5m</p>
        </div>
      </div>

      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 md:px-12 pt-52 pb-6 md:pt-52 md:pb-10 space-y-6 md:space-y-8 custom-scrollbar z-10 overscroll-contain touch-pan-y"
      >
        {visibleMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-start pt-20 md:pt-32 space-y-6 opacity-30 select-none text-center">
            <div className="w-20 h-20 bg-slate-800/50 rounded-[1.5rem] flex items-center justify-center text-4xl shadow-inner">🌌</div>
            <div className="space-y-1">
              <p className="text-lg font-black uppercase tracking-[0.3em] text-white">SILENT SPACE</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Voices fade fast. Be the first.</p>
            </div>
          </div>
        )}

        {visibleMessages.map((msg, idx) => {
          const isOwn = msg.senderId === currentUser.id;
          const prevMsg = visibleMessages[idx - 1];
          const isCompact = prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp < 60000);
          const age = now - msg.timestamp;
          const isExpiring = isCommunity && age >= 300000;

          return (
            <div 
              key={msg.id} 
              className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${isCompact ? 'mt-1' : 'mt-6'} group ${isExpiring ? 'message-disperse' : ''}`}
            >
              {!isCompact && (
                <div className={`flex items-center space-x-2 mb-2 px-1 ${isOwn ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  <button 
                    onClick={() => isCommunity && !isOwn && onUserClick?.(msg.senderId, msg.senderName)}
                    className={`text-[9px] font-black uppercase tracking-widest ${isCommunity && !isOwn ? 'text-blue-400 underline decoration-blue-500/20' : 'text-slate-600'}`}
                  >{msg.senderName}</button>
                  <span className="text-[8px] font-bold text-slate-800">{formatTime(msg.timestamp)}</span>
                </div>
              )}
              
              <div className={`relative max-w-[85%] md:max-w-[70%] p-4 rounded-2xl md:rounded-3xl text-sm md:text-base leading-relaxed ${isOwn ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-900 text-slate-200 rounded-tl-none'}`}>
                <div className="whitespace-pre-wrap break-words">{msg.text}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 md:p-5 bg-slate-900/90 backdrop-blur-3xl border-t border-white/5 z-20 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex items-center space-x-3">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Whisper something..."
            rows={1}
            className="flex-1 bg-slate-950 border border-white/5 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-slate-100 placeholder-slate-700 resize-none"
            style={{ maxHeight: '120px' }}
          />
          <button type="submit" disabled={!inputText.trim()} className="bg-blue-600 w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-20 active:scale-90 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatBox;
