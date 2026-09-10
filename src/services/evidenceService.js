const {
  LAUNCH_LIBRARY_API_URL,
  OPENSKY_API_URL,
  OPEN_METEO_API_URL,
  GITHUB_API_URL
} = require('../config/env');

/**
 * Evidence Gateway Service
 *
 * Provides evidence tools for different case types.
 * All data comes from real, live, free public APIs.
 *
 * Case Types:
 * - rocket-launch: Launch Library 2 (thespacedevs.com)
 * - flight-delay: OpenSky Network + Open-Meteo
 * - github-stars: GitHub API
 */

/**
 * ROCKET LAUNCH TOOLS
 */

/**
 * Get launch status from Launch Library 2
 * No API key needed for basic use (rate-limited)
 */
async function getLaunchStatus({ launchId }) {
  const url = `${LAUNCH_LIBRARY_API_URL}/launch/${launchId}`;

  console.log('[evidenceService] Fetching launch status:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Launch Library API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      launchId: data.id,
      name: data.name,
      status: data.status?.name,
      statusAbbrev: data.status?.abbrev,
      windowStart: data.window_start,
      windowEnd: data.window_end,
      probability: data.probability,
      holdReason: data.holdreason,
      failReason: data.failreason,
      lastUpdated: data.last_updated,
      net: data.net,
      pad: {
        name: data.pad?.name,
        location: data.pad?.location?.name,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[evidenceService] Error fetching launch status:', error.message);
    throw error;
  }
}

/**
 * Get launch pad history from Launch Library 2
 */
async function getLaunchPadHistory({ padId, limit = 10 }) {
  const url = `${LAUNCH_LIBRARY_API_URL}/launch/?pad=${padId}&limit=${limit}`;

  console.log('[evidenceService] Fetching pad history:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Launch Library API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      count: data.count,
      launches: data.results?.slice(0, limit).map(launch => ({
        id: launch.id,
        name: launch.name,
        status: launch.status?.name,
        windowStart: launch.window_start,
        success: launch.mission?.launch_designator,
      })),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[evidenceService] Error fetching pad history:', error.message);
    throw error;
  }
}

/**
 * FLIGHT DELAY TOOLS
 */

/**
 * Get flight status from OpenSky Network
 * 4,000 free credits/day
 */
async function getFlightStatus({ icao24 }) {
  const url = `${OPENSKY_API_URL}/states/all?icao24=${icao24}`;

  console.log('[evidenceService] Fetching flight status:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OpenSky API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.states || data.states.length === 0) {
      return {
        found: false,
        message: 'No flight data found for this aircraft',
        timestamp: new Date().toISOString(),
      };
    }

    const state = data.states[0];

    return {
      found: true,
      icao24: state[0],
      callsign: state[1]?.trim(),
      originCountry: state[2],
      timePosition: state[3],
      lastContact: state[4],
      longitude: state[5],
      latitude: state[6],
      baroAltitude: state[7],
      onGround: state[8],
      velocity: state[9],
      trueTrack: state[10],
      verticalRate: state[11],
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[evidenceService] Error fetching flight status:', error.message);
    throw error;
  }
}

/**
 * Get weather data from Open-Meteo
 * Completely free, no API key needed
 */
async function getWeather({ latitude, longitude }) {
  const url = `${OPEN_METEO_API_URL}/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&timezone=auto`;

  console.log('[evidenceService] Fetching weather:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      current: {
        time: data.current?.time,
        temperature: data.current?.temperature_2m,
        windSpeed: data.current?.wind_speed_10m,
        windDirection: data.current?.wind_direction_10m,
        weatherCode: data.current?.weather_code,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[evidenceService] Error fetching weather:', error.message);
    throw error;
  }
}

/**
 * GITHUB STARS TOOLS
 */

/**
 * Get repository star count from GitHub API
 * Free public API, rate-limited for unauthenticated requests
 */
async function getRepoStars({ owner, repo }) {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}`;

  console.log('[evidenceService] Fetching repo stars:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      owner: data.owner?.login,
      repo: data.name,
      fullName: data.full_name,
      stars: data.stargazers_count,
      forks: data.forks_count,
      watchers: data.watchers_count,
      openIssues: data.open_issues_count,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      pushedAt: data.pushed_at,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[evidenceService] Error fetching repo stars:', error.message);
    throw error;
  }
}

/**
 * Get repository activity metrics
 */
async function getRepoActivity({ owner, repo }) {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/stats/participation`;

  console.log('[evidenceService] Fetching repo activity:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nyaya-Juror-Agent/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();

    // Get recent commits count from last 4 weeks
    const recentWeeks = data.all?.slice(-4) || [];
    const recentCommits = recentWeeks.reduce((sum, week) => sum + week, 0);

    return {
      owner,
      repo,
      allCommits: data.all,
      ownerCommits: data.owner,
      recentCommits,
      weeksTracked: data.all?.length || 0,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[evidenceService] Error fetching repo activity:', error.message);
    throw error;
  }
}

/**
 * Execute a tool call based on tool name and arguments
 */
async function executeEvidenceTool(toolName, args) {
  const tools = {
    // Rocket launch tools
    get_launch_status: getLaunchStatus,
    get_launch_pad_history: getLaunchPadHistory,

    // Flight delay tools
    get_flight_status: getFlightStatus,
    get_weather: getWeather,

    // GitHub stars tools
    get_repo_stars: getRepoStars,
    get_repo_activity: getRepoActivity,
  };

  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Unknown evidence tool: ${toolName}`);
  }

  return await tool(args);
}

module.exports = {
  // Rocket launch
  getLaunchStatus,
  getLaunchPadHistory,

  // Flight delay
  getFlightStatus,
  getWeather,

  // GitHub stars
  getRepoStars,
  getRepoActivity,

  // Generic executor
  executeEvidenceTool,
};
