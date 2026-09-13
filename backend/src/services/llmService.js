const { OPENROUTER_API_KEY, OPENROUTER_API_URL, OPENROUTER_MODEL } = require('../config/env');
const { getEthPrice } = require('./priceService');
const { searchNewsData } = require('./newsService');

/**
 * Tool definitions for the LLM
 */
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_price',
      description: 'Get the current Ethereum price in USD',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: 'Search NewsData.io latest English news. Use exact, carefully ordered keywords. Only q, qInTitle, or qInMeta may be provided; image, video, removeduplicate, language, and all other URL parameters are fixed server-side.',
      parameters: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            description: 'Exact ordered keywords across article content.',
          },
          qInTitle: {
            type: 'string',
            description: 'Exact ordered keywords in the title.',
          },
          qInMeta: {
            type: 'string',
            description: 'Exact ordered keywords in metadata.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

/**
 * Executes a tool call
 * @param {Object} toolCall - The tool call object
 * @returns {Promise<Object>}
 */
async function executeToolCall(toolCall) {
  if (toolCall.function.name === 'get_price') {
    console.log('[llmService] Calling get_price...');
    const result = await getEthPrice();
    console.log('[llmService] get_price result:', result);
    return result;
  } else if (toolCall.function.name === 'search_news') {
    const args = JSON.parse(toolCall.function.arguments || '{}');
    console.log('[llmService] Calling search_news with args:', args);
    const result = await searchNewsData(args);
    console.log('[llmService] search_news returned', result.articles?.length || 0, 'articles');
    return result;
  } else {
    console.warn('[llmService] Unknown tool called:', toolCall.function.name);
    return { error: `Unknown tool: ${toolCall.function.name}` };
  }
}

/**
 * Sends a request to the OpenRouter API
 * @param {Array} messages - The conversation messages
 * @returns {Promise<Object>}
 */
async function sendLLMRequest(messages) {
  const requestBody = {
    model: OPENROUTER_MODEL,
    messages,
    tools,
    tool_choice: 'auto',
  };

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Nyaya Prediction Market',
    },
    body: JSON.stringify(requestBody),
  });

  console.log('[llmService] Response status:', response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[llmService] API error response:', errorText);
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log('[llmService] Response body:', JSON.stringify(data, null, 2));

  // Check for API-level errors
  if (data.error) {
    console.error('[llmService] API returned error:', data.error);
    throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data;
}

/**
 * Generates a prediction using LLM with tool calling
 * @param {string} question - The prediction question
 * @returns {Promise<Object>}
 */
async function generatePrediction(question) {
  console.log('[llmService] Received question:', question || '(default)');

  const messages = [
    {
      role: 'system',
      content: 'You are a financial analyst AI. Use the available tools to gather information. For NewsData.io searches, choose careful exact ordered keywords in q, qInTitle, or qInMeta because poor keyword order may return no results. Consider recent trends, sentiment, and relevant events. Provide a prediction with a verdict (yes/no) and confidence level (0-100%). Answer concisely.',
    },
    {
      role: 'user',
      content: (question || 'Will Ethereum be above $3,000 at 5 p.m. UTC today?') + ' Use the tools to check the current price and recent news, then provide your analysis.',
    },
  ];

  console.log('[llmService] Sending initial request to OpenRouter...');
  console.log('[llmService] API key present:', !!OPENROUTER_API_KEY);

  let data = await sendLLMRequest(messages);

  if (!data.choices?.length) {
    console.error('[llmService] No choices in response — API error or model issue');
    throw new Error('OpenRouter returned no choices');
  }

  let assistantMessage = data.choices[0].message;
  let toolCallCount = 0;
  const toolsCalled = [];
  let iteration = 0;

  // Handle tool calls in a loop
  const MAX_ITERATIONS = 10;
  while (assistantMessage.tool_calls?.length > 0) {
    iteration++;

    if (iteration > MAX_ITERATIONS) {
      console.error('[llmService] Max iterations reached, stopping tool call loop');
      break;
    }

    console.log(`[llmService] Tool-call loop iteration ${iteration}, tools:`, assistantMessage.tool_calls.map(t => t.function.name));
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      toolCallCount++;
      toolsCalled.push(toolCall.function.name);

      const toolResult = await executeToolCall(toolCall);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }

    console.log(`[llmService] Sending follow-up request (iteration ${iteration})...`);

    try {
      data = await sendLLMRequest(messages);

      if (!data.choices?.length) {
        console.error('[llmService] No choices in follow-up response, full data:', JSON.stringify(data, null, 2));

        // If we have a partial response, use it
        if (assistantMessage.content) {
          console.warn('[llmService] Using last valid assistant message');
          break;
        }

        throw new Error('OpenRouter returned no choices on follow-up');
      }

      assistantMessage = data.choices[0].message;
    } catch (error) {
      console.error('[llmService] Error in follow-up request:', error.message);

      // If we have a previous valid message, use it as fallback
      if (assistantMessage.content) {
        console.warn('[llmService] Using last valid assistant message as fallback');
        break;
      }

      throw error;
    }
  }

  console.log('[llmService] Final answer received, verdict extraction...');

  // Ensure we have content to analyze
  if (!assistantMessage.content) {
    console.error('[llmService] No content in final assistant message');
    return {
      verdict: 'no',
      analysis: 'Unable to generate prediction due to API issues. Please try again.',
      toolCallCount,
      toolsCalled,
      error: 'No content in final response',
    };
  }

  // More robust verdict extraction
  const content = assistantMessage.content.toLowerCase();
  let verdict = 'no'; // default to no

  // Check for explicit yes/no patterns
  if (content.includes('verdict: yes') || content.includes('verdict:yes')) {
    verdict = 'yes';
  } else if (content.includes('verdict: no') || content.includes('verdict:no')) {
    verdict = 'no';
  } else if (content.match(/\byes\b/i) && !content.match(/\bno\b/i)) {
    verdict = 'yes';
  }

  return {
    verdict,
    analysis: assistantMessage.content,
    toolCallCount,
    toolsCalled,
  };
}

module.exports = {
  generatePrediction,
};
