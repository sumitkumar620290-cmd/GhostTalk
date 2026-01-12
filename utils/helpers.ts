
export const generateId = () => Math.random().toString(36).substring(2, 15);

export const generateUsername = () => `GHOST-${Math.floor(Math.random() * 90000 + 10000)}`;

export const generateReconnectCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const formatTime = (timestamp: number) => {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true
  }).format(new Date(timestamp));
};

const dayPrompts = [
  "Say something you won’t remember tomorrow.",
  "What’s been on your mind today?",
  "Say one thought without explaining it.",
  "What did today make you feel?",
  "What are you avoiding thinking about?",
  "Say something ordinary that feels heavy.",
  "What’s a quiet thought you carry?",
  "What’s something you didn’t say today?",
  "Say one thing honestly.",
  "What’s taking more energy than it should?",
  "What’s a small truth about today?",
  "Say something unfinished.",
  "What’s been repeating in your head?",
  "What feels unresolved right now?",
  "Say a thought you’d usually ignore.",
  "What’s one thing you noticed today?",
  "Say something that doesn’t need a reply.",
  "What feels louder than it should?",
  "What are you carrying silently?",
  "Say one sentence you didn’t plan.",
  "What’s been distracting you today?",
  "Say something real.",
  "What feels simple but isn’t?",
  "Say a thought and let it go."
];

const nightPrompts = [
  "What keeps your mind awake?",
  "Say a thought that comes at night.",
  "What feels heavier after dark?",
  "Say something you wouldn’t say out loud.",
  "What’s easier to admit at night?",
  "What’s looping in your head right now?",
  "Say a thought meant only for the dark.",
  "What do you think about when no one’s around?",
  "Say something you usually hide.",
  "What feels different at night?",
  "Say something unfiltered.",
  "What’s been bothering you quietly?",
  "What comes back when it’s silent?",
  "Say a thought you don’t judge.",
  "What’s a private feeling right now?",
  "Say something you’re not proud of or happy about.",
  "What do you overthink at night?",
  "Say a thought you’d never post.",
  "What feels unresolved when it’s quiet?",
  "Say something you’re afraid to admit.",
  "What feels real only at night?",
  "Say one sentence and leave it.",
  "What thought follows you after dark?",
  "Say something and let the night keep it."
];

export const getWelcomePrompt = () => {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 18;
  const pool = isDay ? dayPrompts : nightPrompts;
  return pool[Math.floor(Math.random() * pool.length)];
};
