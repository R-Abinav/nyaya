async function checkPrice() {
  const btn = document.getElementById('price-btn');
  const display = document.getElementById('price-display');
  btn.disabled = true;
  display.innerHTML = '<span class="spinner"></span>';

  try {
    const res = await fetch('/price/eth');
    const data = await res.json();
    display.textContent = `ETH $${data.price.toLocaleString()}`;
  } catch {
    display.textContent = 'Error fetching price';
  } finally {
    btn.disabled = false;
  }
}

async function askPrediction() {
  const btn = document.getElementById('ask-btn');
  const input = document.getElementById('question');
  const resultEl = document.getElementById('result');
  const question = input.value.trim();

  if (!question) {
    input.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Thinking…';
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="padding:1.5rem;text-align:center;"><span class="spinner"></span> Querying AI…</div>';

  try {
    const res = await fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    if (data.error) {
      resultEl.innerHTML = `<div class="result-body" style="color:#fb7185;">${data.error}: ${data.message}</div>`;
      return;
    }

    const time = new Date(data.ts * 1000).toLocaleTimeString();
    const verdictClass = data.verdict === 'yes' ? 'verdict-yes' : 'verdict-no';
    const toolChips = data.toolsCalled.map(t => `<span class="tool-chip">${t}</span>`).join('');

    resultEl.innerHTML = `
      <div class="result-header">
        <span class="verdict-badge ${verdictClass}">${data.verdict}</span>
        <span class="result-ts">${time}</span>
      </div>
      <div class="result-body">
        <div class="analysis">${data.analysis}</div>
        <div class="tool-info">
          🔧 <strong>${data.toolCallCount}</strong> tool call${data.toolCallCount !== 1 ? 's' : ''}:
          ${toolChips}
        </div>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `<div class="result-body" style="color:#fb7185;">Request failed: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Predict';
  }
}

// Submit on Enter
document.getElementById('question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') askPrediction();
});
