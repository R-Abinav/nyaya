/**
 * News API Service for contextual evidence gathering
 *
 * Uses NewsAPI.org (free tier: 100 requests/day, developer key required)
 * Fallback: NewsData.io (free tier: 200 requests/day)
 *
 * Purpose: Jurors can gather contextual evidence about:
 * - Company news (SpaceX, airlines, etc.)
 * - Weather events affecting launches/flights
 * - Technical issues or delays
 * - General sentiment and trends
 */

const { NEWS_API_KEY, NEWSDATA_API_KEY } = require('../config/env');

/**
 * Search news using NewsAPI.org
 * Free tier: 100 requests/day, requires API key
 */
async function searchNewsAPI({ query, from, to, language = 'en', sortBy = 'relevancy' }) {
  if (!NEWS_API_KEY) {
    throw new Error('NEWS_API_KEY not configured');
  }

  const params = new URLSearchParams({
    q: query,
    language,
    sortBy,
    apiKey: NEWS_API_KEY,
  });

  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const url = `https://newsapi.org/v2/everything?${params.toString()}`;

  console.log('[newsService] Fetching from NewsAPI.org');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`NewsAPI error: ${error.message || response.status}`);
    }

    const data = await response.json();

    return {
      source: 'newsapi.org',
      totalResults: data.totalResults,
      articles: data.articles?.slice(0, 10).map(article => ({
        title: article.title,
        description: article.description,
        source: article.source?.name,
        author: article.author,
        publishedAt: article.publishedAt,
        url: article.url,
      })) || [],
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[newsService] NewsAPI error:', error.message);
    throw error;
  }
}

/**
 * Search news using NewsData.io
 * Free tier: 200 requests/day
 */
async function searchNewsData({ query, language = 'en', country }) {
  if (!NEWSDATA_API_KEY) {
    throw new Error('NEWSDATA_API_KEY not configured');
  }

  const params = new URLSearchParams({
    q: query,
    language,
    apikey: NEWSDATA_API_KEY,
  });

  if (country) params.append('country', country);

  const url = `https://newsdata.io/api/1/news?${params.toString()}`;

  console.log('[newsService] Fetching from NewsData.io');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`NewsData error: ${error.message || response.status}`);
    }

    const data = await response.json();

    return {
      source: 'newsdata.io',
      totalResults: data.totalResults,
      articles: data.results?.slice(0, 10).map(article => ({
        title: article.title,
        description: article.description,
        source: article.source_id,
        pubDate: article.pubDate,
        link: article.link,
      })) || [],
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[newsService] NewsData error:', error.message);
    throw error;
  }
}

/**
 * Search contextual news - tries NewsAPI first, falls back to NewsData
 */
async function searchContextualNews({ query, daysBack = 7, language = 'en' }) {
  console.log(`[newsService] Searching news for: "${query}" (${daysBack} days back)`);

  // Calculate date range
  const to = new Date().toISOString();
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Try NewsAPI first (better quality, but more limited)
    if (NEWS_API_KEY) {
      return await searchNewsAPI({ query, from, to, language });
    }
  } catch (error) {
    console.warn('[newsService] NewsAPI failed, trying fallback:', error.message);
  }

  try {
    // Fallback to NewsData
    if (NEWSDATA_API_KEY) {
      return await searchNewsData({ query, language });
    }
  } catch (error) {
    console.error('[newsService] All news sources failed:', error.message);
  }

  throw new Error('No news API configured or all sources failed');
}

module.exports = {
  searchNewsAPI,
  searchNewsData,
  searchContextualNews,
};
