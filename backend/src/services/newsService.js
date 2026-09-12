/**
 * News API Service for contextual evidence gathering
 *
 * Uses NewsData.io (free tier: 200 requests/day)
 *
 * Purpose: Jurors can gather contextual evidence about:
 * - Company news (SpaceX, airlines, etc.)
 * - Weather events affecting launches/flights
 * - Technical issues or delays
 * - General sentiment and trends
 */

const { NEWSDATA_API_KEY } = require('../config/env');

/**
 * Search news using NewsData.io
 * Free tier: 200 requests/day
 * Only allows LLM to set: q, qInTitle, qInMeta
 * Fixed parameters: language=en, image=0, video=0, removeduplicate=1
 */
async function searchNewsData(input = {}) {
  const allowedKeys = new Set(['q', 'qInTitle', 'qInMeta']);
  const unexpectedKeys = Object.keys(input).filter(key => !allowedKeys.has(key));

  if (unexpectedKeys.length > 0) {
    throw new Error(`Unsupported NewsData search parameter(s): ${unexpectedKeys.join(', ')}`);
  }

  const q = typeof input.q === 'string' ? input.q.trim() : '';
  const qInTitle = typeof input.qInTitle === 'string' ? input.qInTitle.trim() : '';
  const qInMeta = typeof input.qInMeta === 'string' ? input.qInMeta.trim() : '';

  if (!q && !qInTitle && !qInMeta) {
    throw new Error('At least one of q, qInTitle, or qInMeta is required');
  }

  if (!NEWSDATA_API_KEY) {
    throw new Error('NEWSDATA_API_KEY not configured');
  }

  const params = new URLSearchParams({
    apikey: NEWSDATA_API_KEY,
    language: 'en',
    image: '0',
    video: '0',
    removeduplicate: '1',
    size: '5',
    excludefield: 'source_id,source_name,source_url,source_icon,source_priority,keywords,creator,image_url,video_url,pubdatetz,content,country,category,language,ai_tag,sentiment,sentiment_stats,ai_region,ai_org,duplicate,ai_summary',
  });

  // Only add the parameters that the LLM is allowed to set
  if (q) params.append('q', q);
  if (qInTitle) params.append('qInTitle', qInTitle);
  if (qInMeta) params.append('qInMeta', qInMeta);

  const url = `https://newsdata.io/api/1/latest?${params.toString()}`;

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
      totalResults: data.totalResults ?? data.results?.length ?? 0,
      articles: data.results?.slice(0, 5).map(article => {
        // Split pubDate into date and time (assuming format: "YYYY-MM-DD HH:MM:SS")
        const pubDate = article.pubDate || '';
        const parts = pubDate.split(' ');
        const datePart = parts[0] || '';
        const timePart = parts[1] || '';

        return {
          title: article.title,
          description: article.description,
          time: timePart,
          link: article.link,
          pub_data: datePart,
        };
      }) || [],
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[newsService] NewsData error:', error.message);
    throw error;
  }
}

/**
 * Search contextual news - uses NewsData.io
 * Converts daysBack parameter to appropriate query if needed
 */
async function searchContextualNews({ query, daysBack = 7 }) {
  console.log(`[newsService] Searching news for: "${query}" (${daysBack} days back)`);

  // For NewsData.io, we can't directly specify date range in the same way
  // The API will return latest news, and we rely on the query to be specific enough
  // We could add date-specific terms to the query if needed, but for now we'll
  // just use the query as-is and let the API return recent results

  try {
    // Use NewsData with the query as provided. The latest endpoint supplies
    // publication dates in each article; no mutable date parameter is exposed.
    return await searchNewsData({ q: query });
  } catch (error) {
    console.error('[newsService] NewsData failed:', error.message);
    throw error;
  }
}

module.exports = {
  searchNewsData,
  searchContextualNews,
};
