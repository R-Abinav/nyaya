const { FIRECRAWL_API } = require('../config/env');

const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v1/search';
const MAX_RESULTS = 5;
const MAX_TEXT_LENGTH = 1200;

function errorResult(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

function conciseResult(item) {
  const sourceMetadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  return {
    title: typeof item.title === 'string' ? item.title : undefined,
    url: typeof item.url === 'string' ? item.url : undefined,
    description: typeof item.description === 'string' ? item.description.slice(0, MAX_TEXT_LENGTH) : undefined,
    content: typeof item.markdown === 'string'
      ? item.markdown.slice(0, MAX_TEXT_LENGTH)
      : typeof item.content === 'string' ? item.content.slice(0, MAX_TEXT_LENGTH) : undefined,
    publishedDate: item.publishedDate,
    metadata: {
      description: typeof sourceMetadata.description === 'string' ? sourceMetadata.description.slice(0, MAX_TEXT_LENGTH) : undefined,
      language: sourceMetadata.language,
      publishedTime: sourceMetadata.publishedTime,
      sourceURL: sourceMetadata.sourceURL,
    },
  };
}

async function searchFirecrawl({ query, limit = MAX_RESULTS }) {
  if (!FIRECRAWL_API) return errorResult('FIRECRAWL_API_MISSING', 'Firecrawl web search is not configured on the server.', false);
  if (typeof query !== 'string' || !query.trim()) return errorResult('INVALID_QUERY', 'A non-empty search query is required.', false);

  const boundedLimit = Math.min(Math.max(Number(limit) || MAX_RESULTS, 1), MAX_RESULTS);
  let response;
  try {
    response = await fetch(FIRECRAWL_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: query.trim(), limit: boundedLimit }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return errorResult('NETWORK_ERROR', `Firecrawl search could not be reached: ${error.message}`, true);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return errorResult('INVALID_RESPONSE', `Firecrawl returned an unreadable response (${response.status}).`, response.status >= 500);
  }

  if (response.status === 401 || response.status === 403) return errorResult('INVALID_API_KEY', 'Firecrawl rejected the configured API key.', false);
  if (response.status === 429) return errorResult('RATE_LIMITED', 'Firecrawl rate limit reached. Try again later.', true);
  if (!response.ok || payload?.success === false) {
    const message = payload.error || payload.message || `Firecrawl search failed (${response.status}).`;
    return errorResult('FIRECRAWL_ERROR', message, response.status >= 500);
  }

  const items = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.results) ? payload.results : [];
  return {
    ok: true,
    query: query.trim(),
    results: items.map(conciseResult),
    resultCount: items.length,
    ...(items.length === 0 ? { note: 'No web results matched this query.' } : {}),
  };
}

module.exports = { searchFirecrawl };
