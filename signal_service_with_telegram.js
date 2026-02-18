#!/usr/bin/env node

/**
 * 🚀 Crypto Signal Service - With Telegram Notifications
 */

const https = require('https');

// Configuration
const HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
const LUZIA_API = 'https://api.luzia.dev/v1';
const LUZIA_API_KEY = process.env.LUZIA_API_KEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const CRON_MODE = process.env.CRON_MODE === 'true';
const DEFAULT_RISK_PER_TRADE = 0.02;
const MAX_LEVERAGE = 10;

console.log('\n🔧 ENV CHECK:');
console.log('  TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? '✅ SET' : '❌ NOT SET');
console.log('  TELEGRAM_CHAT_ID:', TELEGRAM_CHAT_ID ? '✅ SET' : '❌ NOT SET');
console.log('  CRON_MODE:', CRON_MODE ? '✅ true' : '❌ false');
console.log('');

// Parse args
const args = process.argv.slice(2);
const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '10');

// ============ DATA FETCHING ============

async function fetchHyperliquidData() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'metaAndAssetCtxs' });
    const req = https.request(HYPERLIQUID_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchLuziaTicker(symbol) {
  if (!LUZIA_API_KEY) return null;
  try {
    const url = `${LUZIA_API}/ticker/binance/${symbol}`;
    const response = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'Authorization': `Bearer ${LUZIA_API_KEY}` } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
      }).on('error', () => resolve(null));
    });
    return response;
  } catch (e) { return null; }
}

// ============ TECHNICAL ANALYSIS ============

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  let avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1];
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateMACD(prices) {
  if (prices.length < 35) return { macd: 0, signal: 0, bullish: true };
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = macdLine * 0.85;
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine, bullish: macdLine > signalLine };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) { atr = (atr * (period - 1) + trs[i]) / period; }
  return atr;
}

function generateSimulatedHistory(currentPrice, change24h) {
  const history = [];
  let price = currentPrice / (1 + change24h / 100);
  for (let i = 0; i < 60; i++) {
    history.push(price);
    const drift = (currentPrice - price) / 60;
    const noise = (Math.random() - 0.5) * price * 0.02;
    price = Math.max(price + drift + noise, price * 0.95);
    history.push(price);
  }
  return history;
}

// ============ SIGNAL GENERATION ============

function analyzeAsset(asset, hyperData, luziaData) {
  const change24h = luziaData?.change24h || hyperData.momentum;
  const price = hyperData.markPx;
  const prices = generateSimulatedHistory(price, change24h);
  const highs = prices.map(p => p * 1.02);
  const lows = prices.map(p => p * 0.98);
  
  const rsi = calculateRSI(prices);
  const macd = calculateMACD(prices);
  const ema9 = calculateEMA(prices, 9);
  const ema21 = calculateEMA(prices, 21);
  const ema50 = calculateEMA(prices, 50);
  const atr = calculateATR(highs, lows, prices);
  
  let score = 0;
  let signals = [];
  let bias = 'NEUTRAL';

  if (rsi < 30) { score += 25; signals.push('RSI Oversold'); bias = 'BULLISH'; }
  else if (rsi > 70) { score -= 15; signals.push('RSI Overbought'); bias = 'BEARISH'; }
  else if (rsi > 55) { score += 15; signals.push('RSI Bullish'); bias = 'BULLISH'; }
  else if (rsi < 45) { score -= 10; signals.push('RSI Weak'); bias = 'BEARISH'; }
  else { score += 5; }

  if (macd.bullish && macd.histogram > 0) { score += 20; signals.push('MACD Bullish'); }
  else if (macd.bullish) { score += 10; signals.push('MACD Above Signal'); }

  const aboveEMA = [ema9, ema21, ema50].filter(e => price > e).length;
  if (aboveEMA === 3) { score += 20; signals.push('Strong Uptrend'); bias = 'BULLISH'; }
  else if (aboveEMA === 2) { score += 10; signals.push('Moderate Uptrend'); bias = 'BULLISH'; }
  else if (aboveEMA === 0) { score -= 20; bias = 'BEARISH'; }

  if (change24h > 5) { score += 10; signals.push('Strong Momentum'); }
  else if (change24h < -5) { score -= 10; signals.push('Weak Momentum'); }

  if (hyperData.funding < -0.05) { score += 10; signals.push('Negative Funding'); }
  else if (hyperData.funding > 0.05) { score -= 10; signals.push('Positive Funding'); }

  const volumeScore = hyperData.volume > 50000000 ? 15 : hyperData.volume > 20000000 ? 10 : 5;
  score += volumeScore;

  return {
    asset, score, signals, bias, price, rsi, macd, atr, atrPercent: (atr / price) * 100,
    ema9, ema21, ema50, change24h, funding: hyperData.funding, volume: hyperData.volume, fmScore: hyperData.fmScore
  };
}

// ============ RISK MANAGEMENT ============

function calculatePositionSize(signal, accountBalance = 10000, risk = 0.02) {
  const riskAmount = accountBalance * risk;
  const stopDistance = signal.atrPercent > 0 ? signal.atrPercent * 1.5 : 5;
  const stopLossPrice = signal.bias === 'BULLISH' 
    ? signal.price * (1 - stopDistance / 100)
    : signal.price * (1 + stopDistance / 100);
  const positionSize = riskAmount / (stopDistance / 100);
  const leverageNeeded = positionSize / accountBalance;
  const leverageToUse = Math.min(leverageNeeded, MAX_LEVERAGE);

  return {
    positionSize, leverageToUse, stopLossPrice, stopDistance, riskAmount,
    takeProfit1: { rr: 3, price: signal.price * (1 + stopDistance / 100 * 3) },
    takeProfit2: { rr: 6, price: signal.price * (1 + stopDistance / 100 * 6) },
    takeProfit3: { rr: 9, price: signal.price * (1 + stopDistance / 100 * 9) }
  };
}

// ============ TELEGRAM NOTIFICATION ============

async function sendTelegramSignal(signal, risk) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`  ⚠️ Cannot send Telegram: ${!TELEGRAM_BOT_TOKEN ? 'Missing BOT_TOKEN' : 'Missing CHAT_ID'}`);
    return false;
  }
  
  const text = `🚀 *CRYPTO SIGNAL #${signal.asset}*\n\n` +
    `📈 *Direction:* ${signal.bias} (${signal.bias === 'BULLISH' ? 'LONG' : 'SHORT'})\n` +
    `💰 *Score:* ${signal.score}/100 (${signal.score >= 70 ? 'HIGH' : 'MEDIUM'} CONFIDENCE)\n` +
    `💵 *Price:* $${signal.price.toFixed(4)}\n` +
    `📊 *24h:* ${signal.change24h > 0 ? '+' : ''}${signal.change24h.toFixed(2)}%\n\n` +
    `📍 *Entry:* $${signal.price.toFixed(4)}\n` +
    `🛑 *Stop:* $${risk.stopLossPrice.toFixed(4)} (-${risk.stopDistance.toFixed(1)}%)\n` +
    `🎯 *TP1:* $${risk.takeProfit1.price.toFixed(4)} (+${risk.takeProfit1.rr}:1)\n` +
    `🎯 *TP2:* $${risk.takeProfit2.price.toFixed(4)} (+${risk.takeProfit2.rr}:1)\n` +
    `🎯 *TP3:* $${risk.takeProfit3.price.toFixed(4)} (+${risk.takeProfit3.rr}:1)\n\n` +
    `⚠️ *Risk:* $${risk.riskAmount.toFixed(2)} | *Leverage:* ${risk.leverageToUse.toFixed(1)}x\n\n` +
    `_Not financial advice. Trade at your own risk._`;
  
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`);
    const postData = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    });
    
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            console.log(`  ✅ Telegram sent: ${signal.asset}`);
            resolve(true);
          } else {
            console.log(`  ⚠️ Telegram failed: ${parsed.description || 'Unknown error'}`);
            resolve(false);
          }
        } catch (e) {
          console.log(`  ❌ Telegram parse error: ${e.message}`);
          resolve(false);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log(`  ❌ Telegram network error: ${e.message}`);
      resolve(false);
    });
    
    req.write(postData);
    req.end();
  });
}

// ============ MAIN ============

async function generateSignals() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 CRYPTO SIGNAL SERVICE v2.0 - With Telegram');
  console.log('='.repeat(70));
  console.log(`📊 Scanning top ${topN} signals...\n`);

  try {
    const data = await fetchHyperliquidData();
    if (!data?.[0]?.universe || !data?.[1]) throw new Error('Failed to fetch data');

    const universe = data[0].universe;
    const assetCtxs = data[1];
    const analyses = [];

    for (let i = 0; i < universe.length; i++) {
      const asset = universe[i].name;
      const funding = parseFloat(assetCtxs[i].funding || '0');
      const volume = parseFloat(assetCtxs[i].dayNtlVlm || '0') * 1000000;
      const prevPrice = parseFloat(assetCtxs[i].prevDayPx || '0');
      const markPrice = parseFloat(assetCtxs[i].markPx || '0');
      const momentum = prevPrice > 0 ? ((markPrice - prevPrice) / prevPrice) * 100 : 0;
      const fmScore = Math.abs(funding) * Math.abs(momentum / 100) * 10000;

      if (volume < 5000000) continue;

      const luziaData = await fetchLuziaTicker(`${asset}-USDT`);
      const analysis = analyzeAsset(asset, { funding, fmScore, markPx: markPrice, momentum, volume }, luziaData);
      analyses.push(analysis);
    }

    analyses.sort((a, b) => b.score - a.score);
    const topSignals = analyses.slice(0, topN);

    console.log(`✅ Found ${topSignals.length} signals\n`);

    if (CRON_MODE && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      console.log('📱 Sending Telegram notifications...\n');
      console.log('DEBUG: TELEGRAM_BOT_TOKEN length:', TELEGRAM_BOT_TOKEN.length);
      console.log('DEBUG: TELEGRAM_CHAT_ID:', TELEGRAM_CHAT_ID);
      
      for (const signal of topSignals.slice(0, 3)) {
        const risk = calculatePositionSize(signal);
        await sendTelegramSignal(signal, risk);
      }
    } else {
      console.log('ℹ️ SKIPPING Telegram notifications (CRON_MODE:', CRON_MODE, 'TELEGRAM_BOT_TOKEN:', !!TELEGRAM_BOT_TOKEN, 'TELEGRAM_CHAT_ID:', !!TELEGRAM_CHAT_ID, ')');
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('⚠️ DISCLAIMER: NOT financial advice. Trade at your own risk.');
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

generateSignals();
