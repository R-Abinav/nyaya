#!/usr/bin/env node

/**
 * Test script for News API services
 *
 * Tests news evidence gathering capabilities for contextual information:
 * - NewsAPI.org (100 requests/day free tier)
 * - NewsData.io (200 requests/day free tier)
 *
 * Usage: Set NEWS_API_KEY or NEWSDATA_API_KEY in .env, then run:
 *   node test-news-api.js
 */

require('dotenv').config();
const {
  searchNewsAPI,
  searchNewsData,
  searchContextualNews,
} = require('./src/services/newsService');

const { NEWS_API_KEY, NEWSDATA_API_KEY } = process.env;

async function testNewsAPI() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING NewsAPI.org (100 requests/day free tier)');
  console.log('='.repeat(80));

  if (!NEWS_API_KEY) {
    console.log('⚠️  NEWS_API_KEY not configured - skipping NewsAPI.org tests');
    console.log('   Get a free key at: https://newsapi.org/register');
    return;
  }

  try {
    console.log('\n1. Testing SpaceX news search...');
    const spaceXNews = await searchNewsAPI({
      query: 'SpaceX launch',
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString(),
    });
    console.log('✓ SpaceX news found:', spaceXNews.totalResults, 'results');
    console.log('  First article:', spaceXNews.articles[0]?.title?.slice(0, 80));
    console.log('  Published:', spaceXNews.articles[0]?.publishedAt);
  } catch (error) {
    console.error('✗ SpaceX news search failed:', error.message);
  }

  try {
    console.log('\n2. Testing airline news search...');
    const airlineNews = await searchNewsAPI({
      query: 'flight delays weather',
      sortBy: 'publishedAt',
    });
    console.log('✓ Airline news found:', airlineNews.totalResults, 'results');
    console.log('  First article:', airlineNews.articles[0]?.title?.slice(0, 80));
  } catch (error) {
    console.error('✗ Airline news search failed:', error.message);
  }

  try {
    console.log('\n3. Testing GitHub trending news...');
    const githubNews = await searchNewsAPI({
      query: 'GitHub trending repositories',
      language: 'en',
    });
    console.log('✓ GitHub news found:', githubNews.totalResults, 'results');
    console.log('  First article:', githubNews.articles[0]?.title?.slice(0, 80));
  } catch (error) {
    console.error('✗ GitHub news search failed:', error.message);
  }
}

async function testNewsData() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING NewsData.io (200 requests/day free tier)');
  console.log('='.repeat(80));

  if (!NEWSDATA_API_KEY) {
    console.log('⚠️  NEWSDATA_API_KEY not configured - skipping NewsData.io tests');
    console.log('   Get a free key at: https://newsdata.io/register');
    return;
  }

  try {
    console.log('\n1. Testing space industry news...');
    const spaceNews = await searchNewsData({
      query: 'space launch',
      language: 'en',
    });
    console.log('✓ Space news found:', spaceNews.totalResults, 'results');
    console.log('  First article:', spaceNews.articles[0]?.title?.slice(0, 80));
    console.log('  Published:', spaceNews.articles[0]?.pubDate);
  } catch (error) {
    console.error('✗ Space news search failed:', error.message);
  }

  try {
    console.log('\n2. Testing aviation news...');
    const aviationNews = await searchNewsData({
      query: 'aviation',
      language: 'en',
    });
    console.log('✓ Aviation news found:', aviationNews.totalResults, 'results');
    console.log('  First article:', aviationNews.articles[0]?.title?.slice(0, 80));
  } catch (error) {
    console.error('✗ Aviation news search failed:', error.message);
  }

  try {
    console.log('\n3. Testing tech news with country filter...');
    const techNews = await searchNewsData({
      query: 'technology',
      language: 'en',
      country: 'us',
    });
    console.log('✓ Tech news found:', techNews.totalResults, 'results');
    console.log('  First article:', techNews.articles[0]?.title?.slice(0, 80));
  } catch (error) {
    console.error('✗ Tech news search failed:', error.message);
  }
}

async function testContextualSearch() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING Contextual News Search (auto-fallback)');
  console.log('='.repeat(80));

  if (!NEWS_API_KEY && !NEWSDATA_API_KEY) {
    console.log('⚠️  No news API keys configured');
    console.log('   Configure NEWS_API_KEY or NEWSDATA_API_KEY in .env');
    return;
  }

  try {
    console.log('\n1. Testing SpaceX contextual search (7 days)...');
    const spacex = await searchContextualNews({
      query: 'SpaceX Falcon 9',
      daysBack: 7,
    });
    console.log('✓ Found via:', spacex.source);
    console.log('  Articles:', spacex.articles.length);
    if (spacex.articles.length > 0) {
      console.log('  Latest:', spacex.articles[0]?.title?.slice(0, 80));
    }
  } catch (error) {
    console.error('✗ SpaceX contextual search failed:', error.message);
  }

  try {
    console.log('\n2. Testing weather contextual search (3 days)...');
    const weather = await searchContextualNews({
      query: 'severe weather airport',
      daysBack: 3,
    });
    console.log('✓ Found via:', weather.source);
    console.log('  Articles:', weather.articles.length);
    if (weather.articles.length > 0) {
      console.log('  Latest:', weather.articles[0]?.title?.slice(0, 80));
    }
  } catch (error) {
    console.error('✗ Weather contextual search failed:', error.message);
  }

  try {
    console.log('\n3. Testing repository trends (14 days)...');
    const repos = await searchContextualNews({
      query: 'GitHub repository stars',
      daysBack: 14,
    });
    console.log('✓ Found via:', repos.source);
    console.log('  Articles:', repos.articles.length);
    if (repos.articles.length > 0) {
      console.log('  Latest:', repos.articles[0]?.title?.slice(0, 80));
    }
  } catch (error) {
    console.error('✗ Repository trends search failed:', error.message);
  }
}

async function testRateLimits() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING Rate Limits & Error Handling');
  console.log('='.repeat(80));

  try {
    console.log('\n1. Testing with invalid query...');
    await searchContextualNews({ query: '', daysBack: 1 });
    console.log('✗ Should have failed with empty query');
  } catch (error) {
    console.log('✓ Correctly rejected empty query:', error.message.slice(0, 60));
  }

  try {
    console.log('\n2. Testing with very old date range...');
    const oldNews = await searchContextualNews({
      query: 'space',
      daysBack: 365,
    });
    console.log('✓ Handled old date range:', oldNews.articles.length, 'articles');
  } catch (error) {
    console.log('⚠️  Old date range not supported:', error.message.slice(0, 60));
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('NYAYA NEWS API TESTS');
  console.log('Testing contextual news evidence gathering');
  console.log('='.repeat(80));

  console.log('\nConfiguration status:');
  console.log('  NEWS_API_KEY:', NEWS_API_KEY ? '✓ Configured' : '✗ Not configured');
  console.log('  NEWSDATA_API_KEY:', NEWSDATA_API_KEY ? '✓ Configured' : '✗ Not configured');

  if (!NEWS_API_KEY && !NEWSDATA_API_KEY) {
    console.log('\n⚠️  WARNING: No news API keys configured!');
    console.log('\nTo enable news evidence gathering:');
    console.log('1. Get a free NewsAPI.org key: https://newsapi.org/register');
    console.log('2. Or get a free NewsData.io key: https://newsdata.io/register');
    console.log('3. Add to .env file:');
    console.log('   NEWS_API_KEY=your_newsapi_key_here');
    console.log('   NEWSDATA_API_KEY=your_newsdata_key_here');
    console.log('\n');
    process.exit(1);
  }

  await testNewsAPI();
  await testNewsData();
  await testContextualSearch();
  await testRateLimits();

  console.log('\n' + '='.repeat(80));
  console.log('TESTS COMPLETE');
  console.log('='.repeat(80));
  console.log('\nNews APIs provide contextual evidence for:');
  console.log('- Company news and reputation (SpaceX, airlines, etc.)');
  console.log('- Weather events and conditions');
  console.log('- Technical issues or delays');
  console.log('- Industry trends and sentiment');
  console.log('- Repository activity and buzz');
  console.log('\nNote: Free tier limits:');
  console.log('- NewsAPI.org: 100 requests/day');
  console.log('- NewsData.io: 200 requests/day');
  console.log('\n');
}

main().catch(console.error);
