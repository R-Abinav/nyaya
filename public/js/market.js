const state = {
  predictions: [],
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setMessage(message = '', isError = false) {
  const element = document.getElementById('market-message');
  element.textContent = message;
  element.style.color = isError ? '#fb7185' : '#fbbf24';
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error('Nyaya server is not running. Start it with "npm run dev", then refresh this page.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatExpiry(value) {
  return new Date(value).toLocaleString();
}

function renderPredictions() {
  const container = document.getElementById('prediction-list');
  if (!state.predictions.length) {
    container.innerHTML = '<p class="empty-state">No predictions are available yet.</p>';
    return;
  }

  container.innerHTML = state.predictions.map(prediction => `
    <article class="prediction-card">
      <h2>${escapeHtml(prediction.statement)}</h2>
      <p class="expiry">${prediction.expired ? 'Expired' : 'Expires'}: ${escapeHtml(formatExpiry(prediction.expiresAt))}</p>
      <div class="options-list">
        ${prediction.options.map(option => `
          <div class="option-row">
            <span>${escapeHtml(option.label)}</span>
            <span class="option-count">${Number(option.betCount || 0)} bets</span>
          </div>
        `).join('')}
      </div>
      <p class="pool-summary">Pool: $${(Number(prediction.totalPoolCents || 0) / 100).toFixed(2)} · ${prediction.totalBets} total bets</p>
    </article>
  `).join('');
}

async function loadPredictions() {
  const data = await requestJson('/predictions');
  state.predictions = data.predictions;
  renderPredictions();
}

function renderHistory(bets) {
  const container = document.getElementById('bet-history');
  if (!bets.length) {
    container.innerHTML = '<p class="empty-state">No bets have been placed yet.</p>';
    return;
  }
  container.innerHTML = bets.map(bet => {
    const option = bet.prediction?.options?.find(candidate => candidate.id === bet.optionId);
    return `
      <div class="history-item">
        <strong>${escapeHtml(option?.label || bet.optionId)}</strong>
        <span> by ${escapeHtml(bet.bettorId)}</span>
        <div class="history-meta">${escapeHtml(bet.prediction?.statement || bet.predictionId)} · ${escapeHtml(formatExpiry(bet.placedAt))}</div>
      </div>
    `;
  }).join('');
}

async function loadHistory() {
  const data = await requestJson('/bets');
  renderHistory(data.bets);
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('refresh-btn').addEventListener('click', () => loadPredictions().catch(error => setMessage(error.message, true)));
  document.getElementById('history-refresh-btn').addEventListener('click', () => loadHistory().catch(error => setMessage(error.message, true)));
  try {
    await Promise.all([loadPredictions(), loadHistory()]);
  } catch (error) {
    setMessage(error.message, true);
  }
});
