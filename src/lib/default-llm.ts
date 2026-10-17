// Default LLM selection for first-run UX.
// The model comes from DEFAULT_CHAT_MODEL; the provider row must belong to the
// same model family, otherwise chat requests are sent to the wrong vendor API.

export const defaultChatModel = (): string => process.env.DEFAULT_CHAT_MODEL || 'claude-opus-5-5';

export const providerIdForModel = (model: string): string => {
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gemini')) return 'google';
    return 'openai';
};
