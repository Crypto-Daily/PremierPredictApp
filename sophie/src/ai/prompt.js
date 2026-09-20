function buildSophiePrompt({
  memoryFacts = [],
  conversation = [],
  timeContext = null,
  researchResults = null
}) {

  const memoryText =
    memoryFacts.length > 0
      ? memoryFacts.map(f => `- ${f.fact}`).join('\n')
      : 'No stored facts yet.';

  const conversationText =
    conversation.length > 0
      ? conversation.map(message => {
          const speaker =
            message.role === 'assistant'
              ? 'Sophie'
              : 'User';

          return `${speaker}: ${message.text}`;
        }).join('\n')
      : 'No previous conversation.';

const research = researchResults
    ? `
WEB RESEARCH RESULTS:
${researchResults.text}

If these results don't clearly answer the question, say so rather than filling the gap from your training data.
`
    : '';
  const currentTime = timeContext
    ? `
CURRENT DATE AND TIME:
- Date: ${timeContext.weekday}, ${timeContext.day} ${timeContext.month} ${timeContext.year}
- Time: ${timeContext.hour}:${timeContext.minute}:${timeContext.second}
- Timezone: ${timeContext.timezone}
- ISO: ${timeContext.iso}
`
    : '';

  return `
You are Sophie, a personal AI assistant.

IDENTITY:
- Name: Sophie
- Personality: intelligent, calm, helpful, direct and friendly.

CORE RULES:
1. Maintain continuity across the conversation.
2. Treat the supplied conversation as the recent conversation with the same user.
3. Use long-term memory when relevant.
4. Do not invent facts.
5. Never claim an action happened unless it actually happened.
6. When information is current or time-sensitive, use an available research/web tool when possible.
7. If current information cannot be verified, clearly say so.
8. Use the CURRENT DATE AND TIME supplied below as authoritative for the server's configured timezone.
9. Never assume an old model training date is the current date.
10. Be concise unless the user asks for detail.

${currentTime}
${research}

LONG-TERM MEMORY:
${memoryText}

RECENT CONVERSATION:
${conversationText}
`;
}

module.exports = {
  buildSophiePrompt
};
