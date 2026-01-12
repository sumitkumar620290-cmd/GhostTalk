
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODERATION_SYSTEM_PROMPT = `You are a content moderator for an anonymous chat app.
Analyze the message text and categorize it according to these strict rules:

CATEGORIES:
- BLOCKED: Child sexual exploitation/CSAM, terrorism, mass violence, weapons/bomb making, human trafficking, extremist recruitment, explicit threats of physical violence.
- BORDERLINE: Harassment, repeated aggressive toxicity, subtle hate speech, manipulative behavior.
- ALLOWED: Consensual adult sexual discussion, adult roleplay, drug experiences (non-instructional), dark humor, political debate, edgy slang.

Stateless operation. No context provided other than the text itself.
Respond ONLY with one word: ALLOWED, BORDERLINE, or BLOCKED.`;

export async function moderate(text) {
  if (!text || text.trim().length === 0) return 'ALLOWED';

  // 1. Regex Guard for critical illegal violations (fail-safe)
  const criticalRegex = /child.*(porn|sex|abuse)|terroris(m|t)|trafficking|bomb.*making|mass.*killing/i;
  if (criticalRegex.test(text)) {
    return 'BLOCKED';
  }

  // 2. AI Semantic Classifier
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Moderation request: "${text}"`,
      config: {
        systemInstruction: MODERATION_SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: 10,
      },
    });

    const result = response.text?.trim().toUpperCase();
    
    if (result === 'BLOCKED') return 'BLOCKED';
    if (result === 'BORDERLINE') return 'BORDERLINE';
    return 'ALLOWED';
  } catch (error) {
    console.error('Moderation system error:', error);
    // Conservative fail-open for reliability
    return 'ALLOWED';
  }
}

/**
 * Generates a session topic starter based on style.
 * TYPE A (DEEP): Reflective, identity, regret.
 * TYPE B (PLAYFUL): Curiosity, "what if", personal quirks.
 */
export async function generateTopic(style = 'DEEP') {
  const prompt = style === 'DEEP' 
    ? "Generate a deep, reflective conversation starter about identity, regrets, secrets, or unspoken thoughts. Open-ended, neutral but engaging, 18+ suitable." 
    : "Generate a playful, light-hearted 'what if' question or curious conversation starter about personal quirks or fantasies. Non-graphic, neutral, engaging.";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "You generate ONE simple conversation starter sentence. Max 12 words. No explicit sexual acts, no violence, no illegal acts, no kids. Output ONLY the question text.",
        temperature: 0.8,
        maxOutputTokens: 50,
      },
    });

    return response.text?.trim() || "What is a thought you've never shared out loud?";
  } catch (error) {
    return "What brings you here today?";
  }
}
