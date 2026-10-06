const { GoogleGenAI, Type } = require('@google/genai');

const STATES = ['COLD', 'QUALIFIED', 'OBJECTION_HANDLING', 'CLOSING'];

function classifyMessage(message, currentState, currentScore) {
  const text = message.toLowerCase();
  const closingSignal = /\b(demo|meeting|schedule|pricing|price|trial|buy|purchase|next step|sign up|proposal)\b/.test(text);
  const objectionSignal = /\b(but|concern|expensive|cost|budget|not sure|hesitant|objection|competitor|too much|can't|cannot)\b/.test(text);
  const qualificationSignal = /\b(looking|evaluate|evaluating|interested|team|need|solution|business|sales)\b/.test(text);

  const validState = STATES.includes(currentState) ? currentState : 'COLD';
  const nextState = objectionSignal
    ? 'OBJECTION_HANDLING'
    : closingSignal
      ? (validState === 'COLD' ? 'QUALIFIED' : 'CLOSING')
      : validState !== 'COLD'
        ? validState
        : qualificationSignal
          ? 'QUALIFIED'
          : 'COLD';
  const increments = closingSignal && validState !== 'COLD' ? 18 : objectionSignal ? 8 : qualificationSignal ? 12 : 4;
  return {
    currentState: nextState,
    leadScore: Math.max(0, Math.min(100, Math.max(0, Number(currentScore) || 0) + increments)),
    objectionHandling: {
      active: objectionSignal,
      category: objectionSignal
        ? (/\b(price|pricing|expensive|cost|budget)\b/.test(text) ? 'PRICE' : 'GENERAL')
        : null,
      responseStrategy: objectionSignal
        ? 'Acknowledge the concern, clarify the underlying need, and respond with a relevant outcome.'
        : null,
    },
  };
}

function fallbackReply(currentState, objectionHandling) {
  if (objectionHandling.active) {
    return 'That is a fair concern. Could you share a little more about what is driving it? I can then focus on the outcomes that matter most to your team.';
  }
  if (currentState === 'CLOSING') {
    return 'A short demo sounds like a useful next step. What day next week works best for your team?';
  }
  if (currentState === 'QUALIFIED') {
    return 'Thanks for sharing that context. What is the most important outcome your team wants from a sales solution?';
  }
  return 'Thanks for reaching out. Could you tell me a little about your team and what you are hoping to improve?';
}

async function processSalesConversation(message, history = [], leadState = 'COLD', currentScore = 0) {
  const fallback = classifyMessage(message, leadState, currentScore);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.startsWith('your_')) {
    return { reply: fallbackReply(fallback.currentState, fallback.objectionHandling), ...fallback };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        ...history.slice(-12).map((entry) => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(entry.content || '').slice(0, 2000) }],
        })),
        { role: 'user', parts: [{ text: message }] },
      ],
      config: {
        systemInstruction:
          `You are a helpful B2B sales agent. Current lead state: ${leadState}. ` +
          `Current lead score: ${Math.max(0, Math.min(100, Number(currentScore) || 0))}. ` +
          'Qualify needs, address objections with empathy, and suggest a clear next step. ' +
          'Return a concise reply, one of the allowed lead states, a 0-100 lead score, and structured objection handling.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            currentState: { type: Type.STRING, enum: STATES },
            leadScore: { type: Type.INTEGER, minimum: 0, maximum: 100 },
            objectionHandling: {
              type: Type.OBJECT,
              properties: {
                active: { type: Type.BOOLEAN },
                category: { type: Type.STRING, nullable: true },
                responseStrategy: { type: Type.STRING, nullable: true },
              },
              required: ['active', 'category', 'responseStrategy'],
            },
          },
          required: ['reply', 'currentState', 'leadScore', 'objectionHandling'],
        },
      },
    });
    const result = JSON.parse(response.text || '');
    if (
      typeof result.reply !== 'string' ||
      !STATES.includes(result.currentState) ||
      !Number.isFinite(result.leadScore) ||
      result.leadScore < 0 ||
      result.leadScore > 100 ||
      !result.objectionHandling ||
      typeof result.objectionHandling.active !== 'boolean'
    ) {
      throw new Error('Gemini returned a response outside the expected sales schema.');
    }
    return {
      reply: result.reply,
      currentState: result.currentState,
      leadScore: Math.max(fallback.leadScore, Math.round(result.leadScore)),
      objectionHandling: result.objectionHandling,
    };
  } catch (error) {
    console.error('Gemini sales engine unavailable; using deterministic lead response:', error.message);
    return {
      reply: fallbackReply(fallback.currentState, fallback.objectionHandling),
      ...fallback,
    };
  }
}

module.exports = { processSalesConversation };
