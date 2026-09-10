const { NEWS_API_URL } = require('../config/env');

/**
 * Searches for cryptocurrency news with flexible parameters
 * @param {Object} options - Search options
 * @param {string} [options.query=''] - Search query
 * @param {number} [options.limit=20] - Number of articles to return
 * @param {string} [options.category=''] - Filter by category
 * @param {string} [options.source=''] - Filter by source
 * @returns {Promise<Object>}
 */
async function searchNews({ query = '', limit = 20, category = '', source = '' } = {}) {
  // Enforce limits to prevent LLM from going rogue
  const MAX_LIMIT = 100;
  const actualLimit = Math.min(limit, MAX_LIMIT);

  // Build query parameters
  const params = new URLSearchParams();
  if (query) params.append('q', query);
  if (category) params.append('category', category);
  if (source) params.append('source', source);
  params.append('limit', actualLimit.toString());

  const url = `${NEWS_API_URL}/news?${params.toString()}`;

  console.log('[newsService] Fetching from:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Prediction-Market/1.0 (Node.js)',
        'Accept': 'application/json',
      },
    });
    const data = await response.json();

    const articles = data.articles || [];

    return {
      articles: articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source,
        pubDate: article.pubDate,
        timeAgo: article.timeAgo,
        link: article.link,
      })),
      totalCount: data.totalCount || articles.length,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      parameters: {
        query,
        limit: actualLimit,
        category,
        source,
      },
    };
  } catch (error) {
    console.error('[newsService] Error fetching news:', error.message);
    return {
      error: `Failed to fetch news: ${error.message}`,
      articles: [],
    };
  }
}

module.exports = {
  searchNews,
};
