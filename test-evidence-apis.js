#!/usr/bin/env node

/**
 * Test script for evidence service with real free APIs
 *
 * Tests all three case types:
 * - Rocket launches (Launch Library 2)
 * - Flight delays (OpenSky + Open-Meteo)
 * - GitHub stars (GitHub API)
 */

const {
  getLaunchStatus,
  getLaunchPadHistory,
  getFlightStatus,
  getWeather,
  getRepoStars,
  getRepoActivity,
} = require('./src/services/evidenceService');

async function testRocketLaunch() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING ROCKET LAUNCH APIs (Launch Library 2)');
  console.log('='.repeat(80));

  try {
    // Test with a recent SpaceX launch ID (you may need to update this)
    console.log('\n1. Testing get_launch_status...');
    const launchStatus = await getLaunchStatus({ launchId: 'f4b6c4c0-42c4-4b9d-8c6f-4c9b9b9b9b9b' });
    console.log('✓ Launch status:', JSON.stringify(launchStatus, null, 2));
  } catch (error) {
    console.error('✗ Launch status failed:', error.message);
    console.log('Note: You may need to provide a valid launch ID from https://ll.thespacedevs.com/2.2.0/launch/upcoming/');
  }

  try {
    console.log('\n2. Testing get_launch_pad_history...');
    // LC-39A pad ID (SpaceX)
    const padHistory = await getLaunchPadHistory({ padId: '87', limit: 5 });
    console.log('✓ Pad history:', JSON.stringify(padHistory, null, 2));
  } catch (error) {
    console.error('✗ Pad history failed:', error.message);
  }
}

async function testFlightDelay() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING FLIGHT DELAY APIs (OpenSky + Open-Meteo)');
  console.log('='.repeat(80));

  try {
    console.log('\n1. Testing get_flight_status...');
    // Random active aircraft (may or may not be in the air)
    const flightStatus = await getFlightStatus({ icao24: 'a12345' });
    console.log('✓ Flight status:', JSON.stringify(flightStatus, null, 2));
  } catch (error) {
    console.error('✗ Flight status failed:', error.message);
  }

  try {
    console.log('\n2. Testing get_weather...');
    // San Francisco coordinates
    const weather = await getWeather({ latitude: 37.7749, longitude: -122.4194 });
    console.log('✓ Weather:', JSON.stringify(weather, null, 2));
  } catch (error) {
    console.error('✗ Weather failed:', error.message);
  }
}

async function testGitHubStars() {
  console.log('\n' + '='.repeat(80));
  console.log('TESTING GITHUB STARS APIs (GitHub API)');
  console.log('='.repeat(80));

  try {
    console.log('\n1. Testing get_repo_stars...');
    const repoStars = await getRepoStars({ owner: 'facebook', repo: 'react' });
    console.log('✓ Repo stars:', JSON.stringify(repoStars, null, 2));
  } catch (error) {
    console.error('✗ Repo stars failed:', error.message);
  }

  try {
    console.log('\n2. Testing get_repo_activity...');
    const repoActivity = await getRepoActivity({ owner: 'facebook', repo: 'react' });
    console.log('✓ Repo activity:', JSON.stringify(repoActivity, null, 2));
  } catch (error) {
    console.error('✗ Repo activity failed:', error.message);
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('NYAYA EVIDENCE SERVICE API TESTS');
  console.log('Testing real, live, free public APIs');
  console.log('='.repeat(80));

  await testRocketLaunch();
  await testFlightDelay();
  await testGitHubStars();

  console.log('\n' + '='.repeat(80));
  console.log('TESTS COMPLETE');
  console.log('='.repeat(80));
  console.log('\nAll APIs use real, live data from free public sources:');
  console.log('- Launch Library 2: https://ll.thespacedevs.com/');
  console.log('- OpenSky Network: https://opensky-network.org/');
  console.log('- Open-Meteo: https://open-meteo.com/');
  console.log('- GitHub API: https://api.github.com/');
  console.log('\n');
}

main().catch(console.error);
