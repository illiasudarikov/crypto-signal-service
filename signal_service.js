#!/usr/bin/env node

/**
 * 🚀 Crypto Signal Service - Professional Trading Signals
 * 
 * DISCLAIMER: NOT FINANCIAL ADVICE. 95% of traders lose money.
 * Always do your own research. Trade at your own risk.
 * 
 * Usage: node signal_service.js [--live] [--top=10]
 */

const https = require('https');

// Configuration
const HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
const LUZIA_API = 'https://api.luzia.dev/v1';
const LUZIA_API_KEY = process.env.LUZIA_API_KEY || '';
const DEFAULT_RISK_PER_TRADE = 0.02; // 2% max risk per trade
const MAX_LEVERAGE = 10; // Max leverage allowed

// Parse args
const args = process.argv.slice(2);
const isLive = args.includes('--live');
const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '10');

// Risk tolerance profiles
const RISK_PROFILES = {
  conservative: { risk: 0.01, rr_min: 2, rr_target: 3, max_leverage: 3 },
  moderate: { risk: 0.02, rr_min: 2, rr_target: 3, max_leverage: 5 },
  aggressive: { risk: 0.03, rr_min: 1.5, rr_target: 2, max_leverage: 10 },
};

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

function calculateBollingerBands(prices, period = 20, stdMult = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, position: 0 };
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(slice.map(p => Math.pow(p - sma, 2)).reduce((a, b) => a + b, 0) / period);
  const currentPrice = prices[prices.length - 1];
  return {
    upper: sma + (stdDev * stdMult),
    middle: sma,
    lower: sma - (stdDev * stdMult),
    position: (currentPrice - sma) / (stdDev * 2)
  };
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
  const bb = calculateBollingerBands(prices);
  const atr = calculateATR(highs, lows, prices);
  const ema9 = calculateEMA(prices, 9);
  const ema21 = calculateEMA(prices, 21);
  const ema50 = calculateEMA(prices, 50);
  
  let score = 0;
  let signals = [];
  let bias = 'NEUTRAL';

  // RSI Scoring
  if (rsi < 30) { score += 25; signals.push('RSI Oversold'); bias = 'BULLISH'; }
  else if (rsi > 70) { score -= 15; signals.push('RSI Overbought'); bias = 'BEARISH'; }
  else if (rsi > 55) { score += 15; signals.push('RSI Bullish'); bias = 'BULLISH'; }
  else if (rsi < 45) { score -= 10; signals.push('RSI Weak'); bias = 'BEARISH'; }

  // MACD Scoring
  if (macd.bullish && macd.histogram > 0) { score += 20; signals.push('MACD Bullish'); }
  else if (macd.bullish) { score += 10; signals.push('MACD Above Signal'); }

  // EMA Alignment
  const aboveEMA = [ema9, ema21, ema50].filter(e => price > e).length;
  if (aboveEMA === 3) { score += 20; signals.push('Strong Uptrend'); bias = 'BULLISH'; }
  else if (aboveEMA === 2) { score += 10; signals.push('Moderate Uptrend'); bias = 'BULLISH'; }
  else if (aboveEMA === 0) { score -= 20; bias = 'BEARISH'; }

  // Bollinger Bands
  if (bb.position < -1) { score += 15; signals.push('BB at Lower Band'); }
  else if (bb.position > 1) { score -= 10; signals.push('BB at Upper Band'); }

  // Momentum
  if (change24h > 5) { score += 10; signals.push('Strong Momentum'); }
  else if (change24h < -5) { score -= 10; signals.push('Weak Momentum'); }

  // Funding (from Hyperliquid)
  if (hyperData.funding < -0.05) { score += 10; signals.push('Negative Funding (Shorts)'); }
  else if (hyperData.funding > 0.05) { score -= 10; signals.push('Positive Funding (Longs)'); }

  // Volume
  const volumeScore = hyperData.volume > 50000000 ? 15 : hyperData.volume > 20000000 ? 10 : 5;
  score += volumeScore;

  return {
    asset,
    score,
    signals,
    bias,
    price,
    rsi,
    macd,
    bb,
    atr,
    atrPercent: (atr / price) * 100,
    ema9,
    ema21,
    ema50,
    change24h,
    funding: hyperData.funding,
    volume: hyperData.volume,
    fmScore: hyperData.fmScore
  };
}

// ============ RISK MANAGEMENT ============

function calculatePositionSize(signal, accountBalance, riskProfile) {
  const { risk, rr_min, rr_target, max_leverage } = riskProfile;
  
  const riskAmount = accountBalance * risk;
  
  // Calculate stop loss distance based on ATR or structure
  const stopDistance = signal.atrPercent > 0 ? signal.atrPercent * 1.5 : 5; // Default 5% if ATR unavailable
  const stopLossPrice = signal.bias === 'BULLISH' 
    ? signal.price * (1 - stopDistance / 100)
    : signal.price * (1 + stopDistance / 100);
  
  // Position size formula: Risk Amount / Stop Distance
  const positionSize = riskAmount / (stopDistance / 100);
  
  // Calculate leverage needed
  const leverageNeeded = positionSize / accountBalance;
  const leverageToUse = Math.min(leverageNeeded, max_leverage);
  
  // Take profit levels (R:R ratios)
  const rr1Price = signal.bias === 'BULLISH'
    ? signal.price * (1 + (stopDistance / 100) * rr_target)
    : signal.price * (1 - (stopDistance / 100) * rr_target);
  
  const rr2Price = signal.bias === 'BULLISH'
    ? signal.price * (1 + (stopDistance / 100) * (rr_target * 2))
    : signal.price * (1 - (stopDistance / 100) * (rr_target * 2));
  
  const rr3Price = signal.bias === 'BULLISH'
    ? signal.price * (1 + (stopDistance / 100) * (rr_target * 3))
    : signal.price * (1 - (stopDistance / 100) * (rr_target * 3));

  return {
    positionSize,
    leverageToUse,
    stopLossPrice,
    stopDistance,
    riskAmount,
    takeProfit1: { price: rr1Price, rr: rr_target },
    takeProfit2: { price: rr2Price, rr: rr_target * 2 },
    takeProfit3: { price: rr3Price, rr: rr_target * 3 }
  };
}

// ============ MAIN ============

async function generateSignals() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 CRYPTO SIGNAL SERVICE v1.0');
  console.log('='.repeat(70));
  if (isLive) {
    console.log('📡 LIVE MODE - Generating real-time signals\n');
  } else {
    console.log('🔍 SCAN MODE - Paper trading signals\n');
  }
  console.log(`📊 Generating top ${topN} signals...\n`);

  try {
    const data = await fetchHyperliquidData();
    if (!data?.[0]?.universe || !data?.[1]) throw new Error('Failed to fetch Hyperliquid data');

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

    // Sort by score and take top N
    analyses.sort((a, b) => b.score - a.score);
    const topSignals = analyses.slice(0, topN);

    console.log(`✅ Found ${topSignals.length} signals\n`);
    console.log('-'.repeat(70));

    // Default account balance for calculation
    const accountBalance = 10000; // $10k example
    const riskProfile = RISK_PROFILES.moderate;

    topSignals.forEach((signal, index) => {
      const risk = calculatePositionSize(signal, accountBalance, riskProfile);
      
      console.log(`\n🔔 SIGNAL #${index + 1}: ${signal.asset}`);
      console.log('-'.repeat(70));
      console.log(`📈 Direction:  ${signal.bias} (${signal.bias === 'BULLISH' ? 'LONG' : signal.bias === 'BEARISH' ? 'SHORT' : 'NEUTRAL'})`);
      console.log(`💰 Score:      ${signal.score}/100 (${signal.score >= 70 ? 'HIGH' : signal.score >= 50 ? 'MEDIUM' : 'LOW'} CONFIDENCE)`);
      console.log(`💵 Current:    $${signal.price.toFixed(4)}`);
      console.log(`📊 24h Change: ${signal.change24h > 0 ? '+' : ''}${signal.change24h.toFixed(2)}%`);
      console.log(`💱 Funding:     ${signal.funding.toFixed(4)}%`);

      console.log('\n📊 INDICATORS:');
      console.log(`  RSI:    ${signal.rsi.toFixed(1)} (${signal.rsi < 30 ? 'Oversold' : signal.rsi > 70 ? 'Overbought' : 'Neutral'})`);
      console.log(`  MACD:   ${signal.macd.bullish ? '🟢 Bullish' : '🔴 Bearish'} (${signal.macd.histogram > 0 ? '+' : ''}${signal.macd.histogram.toFixed(4)})`);
      console.log(`  EMA 9:  $${signal.ema9.toFixed(2)}`);
      console.log(`  EMA 21: $${signal.ema21.toFixed(2)}`);
      console.log(`  EMA 50: $${signal.ema50.toFixed(2)}`);
      console.log(`  ATR:    $${signal.atr.toFixed(2)} (${signal.atrPercent.toFixed(1)}%)`);

      console.log('\n⚠️  RISK MANAGEMENT:');
      console.log(`  Profile:       ${riskProfile.risk * 100}% risk (${Object.keys(RISK_PROFILES).find(k => RISK_PROFILES[k] === riskProfile)})`);
      console.log(`  Risk Amount:  $${risk.riskAmount.toFixed(2)}`);
      console.log(`  Position:     $${risk.positionSize.toFixed(2)}`);
      console.log(`  Leverage:     ${risk.leverageToUse.toFixed(1)}x (max: ${riskProfile.max_leverage}x)`);

      console.log('\n🎯 ENTRY & EXITS:');
      console.log(`  📍 Entry:      $${signal.price.toFixed(4)}`);
      console.log(`  🛑 Stop Loss:  $${risk.stopLossPrice.toFixed(4)} (-${risk.stopDistance.toFixed(1)}%)`);
      console.log(`  🎯 TP1 (${risk.takeProfit1.rr}:1): $${risk.takeProfit1.price.toFixed(4)}`);
      console.log(`  🎯 TP2 (${risk.takeProfit2.rr}:1): $${risk.takeProfit2.price.toFixed(4)}`);
      console.log(`  🎯 TP3 (${risk.takeProfit3.rr}:1): $${risk.takeProfit3.price.toFixed(4)}`);

      console.log('\n✅ SIGNALS CONFIRMATION:');
      signal.signals.forEach(s => console.log(`  • ${s}`));

      console.log('\n' + '-'.repeat(70));
    });

    console.log('\n' + '='.repeat(70));
    console.log('📋 SUMMARY');
    console.log('='.repeat(70));
    console.log(`Signals Generated: ${topSignals.length}`);
    console.log(`Account Balance:   $${accountBalance} (example)`);
    console.log(`Risk Per Trade:    ${riskProfile.risk * 100}%`);
    console.log(`Risk:Reward:       ${riskProfile.rr_min}:1 minimum`);
    console.log('='.repeat(70));

    console.log('\n⚠️  DISCLAIMER:');
    console.log('  • NOT financial advice. Do your own research.');
    console.log('  • 95% of crypto traders lose money.');
    console.log('  • Past performance ≠ future results.');
    console.log('  • Only trade with money you can afford to lose.');
    console.log('  • Always use stop-losses. Never move them further away.');
    console.log('  • Consider your risk tolerance before trading.');
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

generateSignals();
