#!/usr/bin/env node

/**
 * 📊 Web Dashboard for Crypto Signals
 */

const express = require('express');
const { execSync } = require('child_process');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Store latest signals in memory
let latestSignals = null;
let lastUpdate = null;

// Endpoint to generate and store signals
async function refreshSignals() {
  try {
    const output = execSync('node signal_service.js --top=10', { 
      encoding: 'utf8', 
      cwd: __dirname,
      timeout: 60000 
    });
    
    // Parse signals from output
    const lines = output.split('\n');
    const signals = [];
    let currentSignal = null;
    
    for (const line of lines) {
      if (line.includes('SIGNAL #')) {
        if (currentSignal) signals.push(currentSignal);
        currentSignal = { raw: line };
      } else if (currentSignal && line.includes('Direction:')) {
        currentSignal.direction = line.split('Direction:')[1].trim();
      } else if (currentSignal && line.includes('Score:')) {
        currentSignal.score = line.split('Score:')[1].trim();
      } else if (currentSignal && line.includes('Price:')) {
        currentSignal.price = line.split('Price:')[1].trim();
      }
    }
    if (currentSignal) signals.push(currentSignal);
    
    latestSignals = signals;
    lastUpdate = new Date().toISOString();
    return signals;
  } catch (e) {
    return null;
  }
}

// Dashboard HTML
const dashboardHTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Crypto Signal Dashboard</title>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="300">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 20px; }
    h1 { color: #00d9ff; text-align: center; }
    .header { text-align: center; margin-bottom: 30px; }
    .last-update { color: #888; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; max-width: 1400px; margin: 0 auto; }
    .card { background: #16213e; border-radius: 12px; padding: 20px; border: 1px solid #0f3460; transition: transform 0.2s; }
    .card:hover { transform: translateY(-5px); border-color: #00d9ff; }
    .card.high { border-left: 4px solid #00ff88; }
    .card.medium { border-left: 4px solid #ffaa00; }
    .card.low { border-left: 4px solid #ff4444; }
    .asset { font-size: 24px; font-weight: bold; color: #00d9ff; margin-bottom: 10px; }
    .score { font-size: 32px; font-weight: bold; margin-bottom: 15px; }
    .high .score { color: #00ff88; }
    .medium .score { color: #ffaa00; }
    .low .score { color: #ff4444; }
    .detail { margin: 8px 0; font-size: 14px; }
    .label { color: #888; }
    .direction { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
    .long { background: #00ff88; color: #1a1a2e; }
    .short { background: #ff4444; color: #fff; }
    .watch { background: #ffaa00; color: #1a1a2e; }
    .refresh-btn { display: block; width: 200px; margin: 20px auto; padding: 12px; background: #00d9ff; border: none; border-radius: 8px; color: #1a1a2e; font-weight: bold; cursor: pointer; }
    .refresh-btn:hover { background: #00b8d4; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🚀 Crypto Signal Dashboard</h1>
    <p class="last-update">Last updated: ${lastUpdate || 'Loading...'}</p>
    <button class="refresh-btn" onclick="refresh()">🔄 Refresh Signals</button>
  </div>
  <div class="grid" id="signals">
    ${latestSignals ? latestSignals.map(s => `
      <div class="card ${s.score.includes('HIGH') ? 'high' : s.score.includes('MEDIUM') ? 'medium' : 'low'}">
        <div class="asset">${s.asset}</div>
        <div class="score">${s.score.split('/')[0].trim()}/100</div>
        <div class="detail"><span class="label">Direction:</span> <span class="direction ${s.direction?.includes('BULLISH') ? 'long' : s.direction?.includes('BEARISH') ? 'short' : 'watch'}">${s.direction || 'N/A'}</span></div>
        <div class="detail"><span class="label">Price:</span> ${s.price || 'N/A'}</div>
      </div>
    `).join('') : '<p style="text-align:center">Loading signals...</p>'}
  </div>
  <script>
    async function refresh() {
      document.body.style.opacity = '0.5';
      await fetch('/api/refresh');
      location.reload();
    }
    setTimeout(() => location.reload(), 300000);
  </script>
</body>
</html>
`;

// API: Get signals
app.get('/api/signals', (req, res) => {
  res.json({ signals: latestSignals, lastUpdate });
});

// API: Refresh signals
app.get('/api/refresh', async (req, res) => {
  await refreshSignals();
  res.json({ success: true, lastUpdate });
});

// Dashboard
app.get('/', (req, res) => {
  res.send(dashboardHTML);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', lastUpdate });
});

// Start server
app.listen(PORT, async () => {
  console.log(`📊 Dashboard running on port ${PORT}`);
  await refreshSignals();
});
