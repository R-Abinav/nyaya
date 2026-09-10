# News API Testing Documentation

## Overview

The news service provides contextual evidence gathering for juror investigations. It supports two free news APIs with automatic fallback:

- **NewsAPI.org**: 100 requests/day (better quality, requires registration)
- **NewsData.io**: 200 requests/day (backup/alternative)

## Use Cases

Jurors can use news APIs to gather contextual evidence about:

1. **Launch Investigations**
   - Company news (SpaceX, Blue Origin, etc.)
   - Launch delays or technical issues
   - Weather conditions affecting launches
   - Industry trends and sentiment

2. **Flight Delay Investigations**
   - Airline operational issues
   - Weather event coverage
   - Airport closures or delays
   - Strike or labor actions

3. **Repository Investigations**
   - Project buzz and media coverage
   - Major releases or announcements
   - Community sentiment
   - Competitive landscape

## Setup

### Option 1: NewsAPI.org (Recommended)

1. Register at: https://newsapi.org/register
2. Get your free API key (100 requests/day)
3. Add to `.env`:
   ```bash
   NEWS_API_KEY=your_newsapi_key_here
   ```

### Option 2: NewsData.io (Alternative)

1. Register at: https://newsdata.io/register
2. Get your free API key (200 requests/day)
3. Add to `.env`:
   ```bash
   NEWSDATA_API_KEY=your_newsdata_key_here
   ```

### Both (Best Coverage)

Configure both for automatic fallback:
```bash
NEWS_API_KEY=your_newsapi_key
NEWSDATA_API_KEY=your_newsdata_key
```

## Running Tests

```bash
# Run comprehensive news API tests
node test-news-api.js
```

### Test Coverage

The test suite verifies:

1. **NewsAPI.org Tests**
   - ✓ SpaceX news search
   - ✓ Airline/flight news search
   - ✓ GitHub trending news
   - ✓ Date range filtering
   - ✓ Sort order options

2. **NewsData.io Tests**
   - ✓ Space industry news
   - ✓ Aviation news
   - ✓ Country-filtered searches
   - ✓ Language filtering

3. **Contextual Search Tests**
   - ✓ Auto-fallback between providers
   - ✓ Configurable lookback periods (3, 7, 14 days)
   - ✓ Query relevance scoring
   - ✓ Article metadata extraction

4. **Error Handling Tests**
   - ✓ Invalid query handling
   - ✓ Rate limit detection
   - ✓ API failure fallback
   - ✓ Missing configuration detection

## API Functions

### `searchContextualNews(options)`

Primary function for juror agents. Auto-selects best available API.

```javascript
const { searchContextualNews } = require('./src/services/newsService');

const news = await searchContextualNews({
  query: 'SpaceX Falcon 9 launch',
  daysBack: 7,        // Look back 7 days (default: 7)
  language: 'en'      // Language code (default: 'en')
});

// Returns:
{
  source: 'newsapi.org',  // Which API was used
  totalResults: 42,
  articles: [
    {
      title: 'SpaceX Successfully Launches Starlink Mission',
      description: '...',
      source: 'Space.com',
      publishedAt: '2026-09-08T...',
      url: 'https://...'
    },
    // ... more articles
  ],
  timestamp: '2026-09-10T...'
}
```

### `searchNewsAPI(options)`

Direct access to NewsAPI.org (requires NEWS_API_KEY).

```javascript
const { searchNewsAPI } = require('./src/services/newsService');

const news = await searchNewsAPI({
  query: 'flight delays',
  from: '2026-09-03T00:00:00Z',
  to: '2026-09-10T00:00:00Z',
  sortBy: 'relevancy'  // or 'publishedAt', 'popularity'
});
```

### `searchNewsData(options)`

Direct access to NewsData.io (requires NEWSDATA_API_KEY).

```javascript
const { searchNewsData } = require('./src/services/newsService');

const news = await searchNewsData({
  query: 'GitHub trending',
  language: 'en',
  country: 'us'  // Optional country filter
});
```

## Integration with Juror Agents

News tools are available as optional evidence sources. Jurors decide whether to use them based on case type and their personality.

### Example Tool Definition

```javascript
{
  type: 'function',
  function: {
    name: 'search_contextual_news',
    description: 'Search recent news for contextual evidence about companies, events, or trends. Costs evidence spend.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "SpaceX launch delay", "airline weather")'
        },
        daysBack: {
          type: 'number',
          description: 'How many days back to search (default: 7, max: 30)',
          default: 7
        }
      },
      required: ['query']
    }
  }
}
```

## Rate Limits & Best Practices

### NewsAPI.org
- **Limit**: 100 requests/day
- **Resets**: Daily at midnight UTC
- **Best for**: High-quality mainstream news
- **Lookback**: Up to 1 month on free tier

### NewsData.io
- **Limit**: 200 requests/day
- **Resets**: Daily
- **Best for**: International coverage, more sources
- **Lookback**: Recent news only on free tier

### Recommendations

1. **Use sparingly**: News costs evidence spend, only call when relevant
2. **Be specific**: Narrow queries get better results
3. **Check recency**: Older news may not affect current outcomes
4. **Combine sources**: Use news + primary data for best evidence

## Error Handling

The service handles common errors gracefully:

```javascript
try {
  const news = await searchContextualNews({ query: 'SpaceX' });
} catch (error) {
  if (error.message.includes('No news API configured')) {
    // No API keys available
  } else if (error.message.includes('rate limit')) {
    // Hit daily limit
  } else {
    // Other error
  }
}
```

## Testing Without API Keys

The test suite gracefully skips tests when API keys aren't configured:

```bash
node test-news-api.js
# ⚠️  NEWS_API_KEY not configured - skipping NewsAPI.org tests
# ⚠️  NEWSDATA_API_KEY not configured - skipping NewsData.io tests
```

Get free keys to run full tests:
- https://newsapi.org/register
- https://newsdata.io/register

## Example Test Output

```
================================================================================
TESTING NewsAPI.org (100 requests/day free tier)
================================================================================

1. Testing SpaceX news search...
✓ SpaceX news found: 156 results
  First article: SpaceX Falcon 9 Successfully Delivers Starlink Satellites to Orbit
  Published: 2026-09-08T14:23:00Z

2. Testing airline news search...
✓ Airline news found: 89 results
  First article: Major Airlines Cancel Flights Due to Hurricane Conditions

3. Testing GitHub trending news...
✓ GitHub news found: 43 results
  First article: GitHub Announces New AI-Powered Code Review Features

================================================================================
TESTS COMPLETE
================================================================================
```

## Notes

- News is **optional contextual evidence**, not required for all cases
- Jurors should weigh news relevance vs cost
- Primary data (Launch Library, OpenSky, GitHub API) should be preferred
- News is most useful when primary sources don't explain anomalies
