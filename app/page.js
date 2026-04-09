"use client";
import { useMemo, useState } from "react";

const MARKET_CONFIG = {
  goals: { label: "Goals", emoji: "⚽", lineHint: "Usually 2.5, 3.5, 1.5 etc", forLabel: "Goals scored avg", againstLabel: "Goals conceded avg" },
  sot: { label: "Shots on Target", emoji: "🎯", lineHint: "Usually 7.5–9.5", forLabel: "SOT for avg", againstLabel: "SOT against avg" },
  corners: { label: "Corners", emoji: "🚩", lineHint: "Usually 8.5–10.5", forLabel: "Corners for avg", againstLabel: "Corners against avg" },
  cards: { label: "Cards", emoji: "🟨", lineHint: "Usually 3.5–5.5", forLabel: "Cards avg", againstLabel: "Cards against avg" },
};

const DEFAULTS = {
  goals: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "2.5", overOdds: "", underOdds: "" },
  sot: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "8.5", overOdds: "", underOdds: "" },
  corners: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "9.5", overOdds: "", underOdds: "" },
  cards: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "4.5", overOdds: "", underOdds: "" },
};

const BULK_EXAMPLE = `Freiburg vs Celta Vigo,goals,1.4,1.1,1.2,1.5,2.5,2.20,1.67
Bologna vs Aston Villa,sot,3.8,4.4,4.7,3.9,8.5,1.95,1.75
Bologna vs Aston Villa,corners,5.2,4.6,5.0,4.8,9.5,1.91,1.80
Porto vs Nottingham Forest,cards,2.1,2.3,2.2,2.0,4.5,2.15,1.60`;

function parseNum(v){ const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

let factCache = [0];
function logFactorial(n){
  if (factCache[n] != null) return factCache[n];
  let sum = factCache[factCache.length - 1];
  for (let i = factCache.length; i <= n; i++){ sum += Math.log(i); factCache[i] = sum; }
  return factCache[n];
}
function poissonPmf(k, lambda){
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}
function poissonCdf(k, lambda){
  if (k < 0) return 0;
  let sum = 0;
  for (let i=0;i<=k;i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}
function probOverAsian(line, lambda){
  const whole = Math.floor(line);
  const frac = +(line - whole).toFixed(2);
  if (Math.abs(frac - 0.5) < 0.01) return 1 - poissonCdf(whole, lambda);
  if (Math.abs(frac - 0.0) < 0.01) return 1 - poissonCdf(whole, lambda);
  if (Math.abs(frac - 0.25) < 0.01){
    const p1 = 1 - poissonCdf(whole, lambda);
    const p2 = 1 - poissonCdf(whole, lambda);
    return (p1 + p2) / 2;
  }
  if (Math.abs(frac - 0.75) < 0.01){
    const p1 = 1 - poissonCdf(whole, lambda);
    const p2 = 1 - poissonCdf(whole + 1, lambda);
    return (p1 + p2) / 2;
  }
  return 1 - poissonCdf(Math.floor(line), lambda);
}
function fairProbsFromOdds(overOdds, underOdds){
  const pO = 1 / overOdds;
  const pU = 1 / underOdds;
  const total = pO + pU;
  return { fairOver: pO / total, fairUnder: pU / total };
}
function edgeWidth(edge){
  const clamped = Math.max(-10, Math.min(10, edge));
  return Math.abs(clamped) * 5;
}
function confFromEdge(edge){
  if (edge >= 8) return "Strong";
  if (edge >= 5) return "Good";
  if (edge >= 3) return "Lean";
  return "Low";
}
function analyseRow(row, settings){
  const homeFor = parseNum(row.homeFor);
  const homeAgainst = parseNum(row.homeAgainst);
  const awayFor = parseNum(row.awayFor);
  const awayAgainst = parseNum(row.awayAgainst);
  const line = parseNum(row.line);
  const overOdds = parseNum(row.overOdds);
  const underOdds = parseNum(row.underOdds);
  const market = row.market;
  if ([homeFor, homeAgainst, awayFor, awayAgainst, line, overOdds, underOdds].some(v => v == null || v <= 0)) return null;

  const baseHome = (homeFor + awayAgainst) / 2;
  const baseAway = (awayFor + homeAgainst) / 2;

  const homeBoost = settings.homeAwayBoost ? 1.04 : 1;
  const awayBoost = settings.homeAwayBoost ? 0.98 : 1;

  let expectedHome = baseHome * homeBoost;
  let expectedAway = baseAway * awayBoost;
  let expectedTotal = expectedHome + expectedAway;

  const marketAdjust = { goals: 1.0, sot: 1.0, corners: 1.03, cards: 1.02 };
  expectedTotal *= (marketAdjust[market] || 1);

  if (settings.knockoutMode && (market === "goals" || market === "sot")) expectedTotal *= 0.96;
  if (settings.knockoutMode && market === "cards") expectedTotal *= 1.03;

  const modelOver = probOverAsian(line, expectedTotal);
  const modelUnder = 1 - modelOver;
  const { fairOver, fairUnder } = fairProbsFromOdds(overOdds, underOdds);

  const overEdge = (modelOver - fairOver) * 100;
  const underEdge = (modelUnder - fairUnder) * 100;
  const threshold = settings.edgeThreshold;

  let side = "skip";
  let pick = "SKIP";
  let edge = 0;
  if (overEdge > threshold && overEdge > underEdge){
    side = "over";
    pick = `OVER ${line}`;
    edge = overEdge;
  } else if (underEdge > threshold && underEdge > overEdge){
    side = "under";
    pick = `UNDER ${line}`;
    edge = underEdge;
  }

  const confidence = confFromEdge(edge);
  const fairOverOdds = modelOver > 0 ? 1 / modelOver : 0;
  const fairUnderOdds = modelUnder > 0 ? 1 / modelUnder : 0;
  const suggestedOverOdds = fairOverOdds * settings.suggestedMultiplier;
  const suggestedUnderOdds = fairUnderOdds * settings.suggestedMultiplier;

  const confidenceScore = Math.max(0, Math.min(10, edge / 1.5));
  const volatility = Math.abs(expectedTotal - line) < 0.15 ? "High variance" : "Normal";
  const explanation =
    side === "over" ? "Model higher than market → OVER value." :
    side === "under" ? "Market overpriced → UNDER value." :
    "No clear edge → skip.";

  return {
    ...row,
    expectedHome, expectedAway, expectedTotal,
    modelOver, modelUnder, fairOver, fairUnder,
    overEdge, underEdge, side, pick, edge, confidence,
    fairOverOdds, fairUnderOdds, suggestedOverOdds, suggestedUnderOdds,
    trueLine: expectedTotal,
    confidenceScore, volatility, explanation,
  };
}
function parseBulk(text){
  return text.split("\n").map(x => x.trim()).filter(Boolean).map((line, idx) => {
    const p = line.split(",").map(x => x.trim());
    if (p.length < 9) return null;
    return {
      id: `${Date.now()}-${idx}`,
      match: p[0],
      market: p[1],
      homeFor: p[2],
      homeAgainst: p[3],
      awayFor: p[4],
      awayAgainst: p[5],
      line: p[6],
      overOdds: p[7],
      underOdds: p[8],
    };
  }).filter(Boolean);
}
const pct = v => `${(v * 100).toFixed(1)}%`;
const num = v => Number(v).toFixed(2);

export default function App(){
  const [activeTab, setActiveTab] = useState("scanner");
  const [market, setMarket] = useState("goals");
  const [forms, setForms] = useState(DEFAULTS);
  const [bulkText, setBulkText] = useState(BULK_EXAMPLE);
  const [rows, setRows] = useState([]);
  const [tracked, setTracked] = useState([]);
  const [settings, setSettings] = useState({
    edgeThreshold: 3,
    suggestedMultiplier: 1.05,
    homeAwayBoost: true,
    knockoutMode: false,
    stakeStrong: 3,
    stakeGood: 2,
    stakeLean: 1,
  });

  const active = forms[market];
  const cfg = MARKET_CONFIG[market];

  const singleResult = useMemo(() => analyseRow({ ...active, market }, settings), [active, market, settings]);
  const analysedRows = useMemo(() => rows.map(r => analyseRow(r, settings)).filter(Boolean).sort((a,b) => b.edge - a.edge), [rows, settings]);

  const strongCount = analysedRows.filter(r => r.confidence === "Strong").length;
  const goodCount = analysedRows.filter(r => r.confidence === "Good").length;
  const leanCount = analysedRows.filter(r => r.confidence === "Lean").length;
  const bestRow = analysedRows[0] || null;

  const trackerStats = useMemo(() => {
    const settled = tracked.filter(x => x.result !== "Pending");
    const wins = settled.filter(x => x.result === "Won").length;
    const losses = settled.filter(x => x.result === "Lost").length;
    const voids = settled.filter(x => x.result === "Void").length;
    const profit = settled.reduce((sum, x) => {
      if (x.result === "Won") return sum + ((Number(x.odds) - 1) * Number(x.stake));
      if (x.result === "Lost") return sum - Number(x.stake);
      return sum;
    }, 0);
    const stake = settled.filter(x => x.result !== "Void").reduce((sum, x) => sum + Number(x.stake), 0);
    const roi = stake > 0 ? (profit / stake) * 100 : 0;
    const winrate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    return { settled: settled.length, wins, losses, voids, profit, roi, winrate };
  }, [tracked]);

  function update(field, value){
    setForms(prev => ({ ...prev, [market]: { ...prev[market], [field]: value } }));
  }
  function loadExample(){
    const ex = {
      goals: { match:"Freiburg vs Celta Vigo", homeFor:"1.4", homeAgainst:"1.1", awayFor:"1.2", awayAgainst:"1.5", line:"2.5", overOdds:"2.20", underOdds:"1.67" },
      sot: { match:"Bologna vs Aston Villa", homeFor:"3.8", homeAgainst:"4.4", awayFor:"4.7", awayAgainst:"3.9", line:"8.5", overOdds:"1.95", underOdds:"1.75" },
      corners: { match:"Bologna vs Aston Villa", homeFor:"5.2", homeAgainst:"4.6", awayFor:"5.0", awayAgainst:"4.8", line:"9.5", overOdds:"1.91", underOdds:"1.80" },
      cards: { match:"Porto vs Nottingham Forest", homeFor:"2.1", homeAgainst:"2.3", awayFor:"2.2", awayAgainst:"2.0", line:"4.5", overOdds:"2.15", underOdds:"1.60" },
    };
    setForms(prev => ({ ...prev, [market]: ex[market] }));
  }
  function addSingleToScanner(){
    setRows(prev => [{ ...active, market, id: `${Date.now()}-single` }, ...prev]);
  }
  function importBulk(){ setRows(parseBulk(bulkText)); }
  function clearScanner(){ setRows([]); }

  function badgeClass(conf){
    if (conf === "Strong" || conf === "Good") return "badge green";
    if (conf === "Lean") return "badge amber";
    return "badge red";
  }
  const decisionClass =
    !singleResult || singleResult.side === "skip" ? "skip" :
    singleResult.confidence === "Strong" ? "strong" :
    singleResult.confidence === "Good" ? "good" :
    "lean";

  function addToTrackerFromResult(result){
    if (!result || result.side === "skip") return;
    const stake =
      result.confidence === "Strong" ? settings.stakeStrong :
      result.confidence === "Good" ? settings.stakeGood :
      settings.stakeLean;
    const odds = result.side === "over" ? active.overOdds : active.underOdds;
    setTracked(prev => [{
      id: `${Date.now()}`,
      match: active.match || `${cfg.label} bet`,
      market: MARKET_CONFIG[market].label,
      pick: result.pick,
      confidence: result.confidence,
      edge: result.edge,
      odds,
      stake,
      result: "Pending",
    }, ...prev]);
    setActiveTab("tracker");
  }
  function addScannerRowToTracker(row){
    const stake =
      row.confidence === "Strong" ? settings.stakeStrong :
      row.confidence === "Good" ? settings.stakeGood :
      settings.stakeLean;
    const odds = row.side === "over" ? row.overOdds : row.underOdds;
    setTracked(prev => [{
      id: `${Date.now()}-${row.id}`,
      match: row.match,
      market: MARKET_CONFIG[row.market]?.label || row.market,
      pick: row.pick,
      confidence: row.confidence,
      edge: row.edge,
      odds,
      stake,
      result: "Pending",
    }, ...prev]);
    setActiveTab("tracker");
  }
  function updateTracked(id, field, value){
    setTracked(prev => prev.map(x => x.id === id ? { ...x, [field]: value } : x));
  }

  return (
    <main className="page">
      <div className="shell">
        <div className="topTabs">
          <button className={`topTab ${activeTab==="scanner"?"active":""}`} onClick={() => setActiveTab("scanner")}>Scanner</button>
          <button className={`topTab ${activeTab==="best"?"active":""}`} onClick={() => setActiveTab("best")}>Best Bets</button>
          <button className={`topTab ${activeTab==="tracker"?"active":""}`} onClick={() => setActiveTab("tracker")}>Tracker</button>
          <button className={`topTab ${activeTab==="settings"?"active":""}`} onClick={() => setActiveTab("settings")}>Settings</button>
        </div>

        <section className="hero">
          <div className="heroCard">
            <div className="titleRow">
              <div className="logo">🔥</div>
              <div>
                <div className="title">Value Scanner Phase 3</div>
                <div className="subtitle">Responsive mobile-fit layout, collapsible bulk scanner, best bets dashboard, tracker, and settings.</div>
              </div>
            </div>
            <div className="pillRow">
              <div className="pill">Mobile-fit layout</div>
              <div className="pill">Collapsible bulk import</div>
              <div className="pill">Best bets dashboard</div>
              <div className="pill">Tracker + ROI</div>
            </div>
          </div>
          <div className="helpCard">
            <h3 style={{marginTop:0}}>What fair odds mean</h3>
            <p className="muted">Fair odds are your model break-even price. Suggested odds are a slightly safer target price to hold out for.</p>
            <ul className="small">
              <li>If your fair price for Over is 1.85 and the bookie offers 2.00, that can be value.</li>
              <li>If the bookie offers worse than your fair price, the edge usually is not there.</li>
            </ul>
          </div>
        </section>

        <section className="dashboardGrid">
          <div className="kpi"><div className="k">Scanned rows</div><div className="v">{analysedRows.length}</div><div className="s">Multi-game scanner</div></div>
          <div className="kpi"><div className="k">Strong bets</div><div className="v">{strongCount}</div><div className="s">Top priority</div></div>
          <div className="kpi"><div className="k">Good bets</div><div className="v">{goodCount}</div><div className="s">Playable</div></div>
          <div className="kpi"><div className="k">Best edge</div><div className="v">{bestRow ? `${bestRow.edge.toFixed(1)}%` : "-"}</div><div className="s">{bestRow ? bestRow.match : "No rows yet"}</div></div>
        </section>

        {activeTab === "scanner" && (
          <section className="mainGrid">
            <div className="card">
              <div className="marketTabs">
                {Object.entries(MARKET_CONFIG).map(([k, item]) => (
                  <button key={k} className={`marketTab ${market===k?"active":""}`} onClick={() => setMarket(k)}>
                    {item.emoji} {item.label}
                  </button>
                ))}
              </div>

              <h2 className="sectionTitle">{cfg.label} scanner</h2>
              <p className="sectionSub">{cfg.lineHint}</p>

              <div className="formGrid">
                <div className="field full">
                  <label>Match</label>
                  <input className="input" value={active.match} onChange={(e) => update("match", e.target.value)} placeholder="Bologna vs Aston Villa" />
                </div>
                <div className="field">
                  <label>Home {cfg.forLabel}</label>
                  <input className="input" value={active.homeFor} onChange={(e) => update("homeFor", e.target.value)} placeholder="e.g. 1.4" />
                </div>
                <div className="field">
                  <label>Home {cfg.againstLabel}</label>
                  <input className="input" value={active.homeAgainst} onChange={(e) => update("homeAgainst", e.target.value)} placeholder="e.g. 1.1" />
                </div>
                <div className="field">
                  <label>Away {cfg.forLabel}</label>
                  <input className="input" value={active.awayFor} onChange={(e) => update("awayFor", e.target.value)} placeholder="e.g. 1.2" />
                </div>
                <div className="field">
                  <label>Away {cfg.againstLabel}</label>
                  <input className="input" value={active.awayAgainst} onChange={(e) => update("awayAgainst", e.target.value)} placeholder="e.g. 1.5" />
                </div>
                <div className="field">
                  <label>Line</label>
                  <input className="input" value={active.line} onChange={(e) => update("line", e.target.value)} placeholder="e.g. 2.5" />
                </div>
                <div className="field">
                  <label>Over odds</label>
                  <input className="input" value={active.overOdds} onChange={(e) => update("overOdds", e.target.value)} placeholder="e.g. 2.10" />
                </div>
                <div className="field">
                  <label>Under odds</label>
                  <input className="input" value={active.underOdds} onChange={(e) => update("underOdds", e.target.value)} placeholder="e.g. 1.72" />
                </div>
              </div>

              <div className="actions">
                <button className="btn primary" onClick={loadExample}>Load example</button>
                <button className="btn secondary" onClick={addSingleToScanner}>Add to scanner</button>
                <button className="btn secondary" onClick={() => singleResult && addToTrackerFromResult(singleResult)}>Add to tracker</button>
              </div>

              <details className="bulkBox">
                <summary>
                  <span>Bulk scanner</span>
                  <span className="small">Tap to open / close</span>
                </summary>
                <div className="bulkInner">
                  <p className="sectionSub">Format: match,market,homeFor,homeAgainst,awayFor,awayAgainst,line,overOdds,underOdds</p>
                  <textarea className="textarea" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
                  <div className="actions">
                    <button className="btn primary" onClick={importBulk}>Import rows</button>
                    <button className="btn secondary" onClick={clearScanner}>Clear scanner</button>
                  </div>
                </div>
              </details>
            </div>

            <div className="card">
              {!singleResult ? (
                <>
                  <h2 className="sectionTitle">Result</h2>
                  <p className="sectionSub">Fill all inputs to calculate.</p>
                </>
              ) : (
                <>
                  <div className="pickHeader">
                    <div>
                      <div className="pickName">{singleResult.pick}</div>
                      <div className="small">{active.match || cfg.label} · {cfg.label}</div>
                    </div>
                    <div className={badgeClass(singleResult.confidence)}>{singleResult.confidence}</div>
                  </div>

                  <div className="resultMetrics">
                    <div className="metric"><div className="k">Expected total</div><div className="v">{num(singleResult.expectedTotal)}</div></div>
                    <div className="metric"><div className="k">True line</div><div className="v">{num(singleResult.trueLine)}</div></div>
                    <div className="metric"><div className="k">Edge</div><div className="v">{singleResult.edge.toFixed(1)}%</div></div>
                    <div className="metric"><div className="k">Confidence</div><div className="v">{singleResult.confidenceScore.toFixed(1)}/10</div></div>
                  </div>

                  <div className="resultGrid">
                    <div className="detail">
                      <h4>Model probabilities</h4>
                      <p>Over: {pct(singleResult.modelOver)}</p>
                      <p>Under: {pct(singleResult.modelUnder)}</p>
                    </div>
                    <div className="detail">
                      <h4>Book fair probabilities</h4>
                      <p>Over: {pct(singleResult.fairOver)}</p>
                      <p>Under: {pct(singleResult.fairUnder)}</p>
                    </div>
                    <div className={`detail ${singleResult.side==="over"?"":"dim"}`}>
                      <h4>Over fair / suggested</h4>
                      <p>Fair odds: {num(singleResult.fairOverOdds)}</p>
                      <p>Suggested odds: {num(singleResult.suggestedOverOdds)}</p>
                    </div>
                    <div className={`detail ${singleResult.side==="under"?"":"dim"}`}>
                      <h4>Under fair / suggested</h4>
                      <p>Fair odds: {num(singleResult.fairUnderOdds)}</p>
                      <p>Suggested odds: {num(singleResult.suggestedUnderOdds)}</p>
                    </div>
                    <div className={`detail ${singleResult.side==="over"?"":"dim"}`}>
                      <h4>Over edge</h4>
                      <p>{singleResult.overEdge.toFixed(1)}%</p>
                    </div>
                    <div className={`detail ${singleResult.side==="under"?"":"dim"}`}>
                      <h4>Under edge</h4>
                      <p>{singleResult.underEdge.toFixed(1)}%</p>
                    </div>
                  </div>

                  <div className="edgeMeter">
                    <div className="edgeBar">
                      <div className="edgeCenter"></div>
                      {singleResult.overEdge > 0 && <div className="edgeFill over" style={{width: edgeWidth(singleResult.overEdge) + "%"}}></div>}
                      {singleResult.underEdge > 0 && <div className="edgeFill under" style={{width: edgeWidth(singleResult.underEdge) + "%"}}></div>}
                    </div>
                    <div className="edgeLabels"><span>UNDER</span><span>OVER</span></div>
                  </div>

                  <div className="decision">
                    <div className={`decisionText ${decisionClass}`}>
                      {singleResult.side === "skip" ? "NO BET" : `${singleResult.confidence.toUpperCase()} ${singleResult.pick} (${singleResult.edge.toFixed(1)}%)`}
                    </div>
                    <div className="small">{singleResult.explanation} · {singleResult.volatility}</div>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === "best" && (
          <section className="tabShell">
            <div className="card">
              <h2 className="sectionTitle">Best Bets Today</h2>
              <p className="sectionSub">Top scanner rows sorted by edge.</p>

              {analysedRows.length === 0 ? (
                <p className="muted">No scanned rows yet. Add rows in Scanner.</p>
              ) : (
                <div className="bestList">
                  {analysedRows.slice(0, 8).map((row) => (
                    <div className="bestCard" key={row.id}>
                      <div className="bestTop">
                        <div>
                          <div className="bestTitle">{row.pick}</div>
                          <div className="bestMeta">{row.match} · {MARKET_CONFIG[row.market]?.emoji} {MARKET_CONFIG[row.market]?.label}</div>
                        </div>
                        <div className={badgeClass(row.confidence)}>{row.confidence}</div>
                      </div>

                      <div className="bestStats">
                        <div className="bestStat"><div className="k">Edge</div><div className="v">{row.edge.toFixed(1)}%</div></div>
                        <div className="bestStat"><div className="k">True line</div><div className="v">{num(row.trueLine)}</div></div>
                        <div className="bestStat"><div className="k">Fair odds</div><div className="v">{row.side === "over" ? num(row.fairOverOdds) : row.side === "under" ? num(row.fairUnderOdds) : "-"}</div></div>
                        <div className="bestStat"><div className="k">Suggested</div><div className="v">{row.side === "over" ? num(row.suggestedOverOdds) : row.side === "under" ? num(row.suggestedUnderOdds) : "-"}</div></div>
                      </div>

                      <div className="actions">
                        <button className="btn secondary" onClick={() => addScannerRowToTracker(row)}>Add to tracker</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="sectionTitle">Scanner Table</h2>
              <p className="sectionSub">Full list with fair and suggested odds.</p>
              {analysedRows.length === 0 ? (
                <p className="muted">No rows yet.</p>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Match</th>
                        <th>Market</th>
                        <th>Pick</th>
                        <th>Edge</th>
                        <th>Confidence</th>
                        <th>True line</th>
                        <th>Book line</th>
                        <th>Book O/U</th>
                        <th>Fair odds</th>
                        <th>Suggested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysedRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.match}</td>
                          <td>{MARKET_CONFIG[row.market]?.emoji} {MARKET_CONFIG[row.market]?.label}</td>
                          <td>{row.pick}</td>
                          <td>{row.edge.toFixed(1)}%</td>
                          <td>{row.confidence}</td>
                          <td>{num(row.trueLine)}</td>
                          <td>{row.line}</td>
                          <td>{row.overOdds} / {row.underOdds}</td>
                          <td>{row.side === "over" ? `Over ${num(row.fairOverOdds)}` : row.side === "under" ? `Under ${num(row.fairUnderOdds)}` : `Over ${num(row.fairOverOdds)} · Under ${num(row.fairUnderOdds)}`}</td>
                          <td>{row.side === "over" ? `Over ${num(row.suggestedOverOdds)}` : row.side === "under" ? `Under ${num(row.suggestedUnderOdds)}` : `Over ${num(row.suggestedOverOdds)} · Under ${num(row.suggestedUnderOdds)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "tracker" && (
          <section className="trackerGrid">
            <div className="card">
              <h2 className="sectionTitle">Tracker Summary</h2>
              <div className="dashboardGrid" style={{marginBottom:0}}>
                <div className="kpi"><div className="k">Settled</div><div className="v">{trackerStats.settled}</div></div>
                <div className="kpi"><div className="k">Win rate</div><div className="v">{trackerStats.winrate.toFixed(1)}%</div></div>
                <div className="kpi"><div className="k">Profit</div><div className="v">{trackerStats.profit.toFixed(2)}</div></div>
                <div className="kpi"><div className="k">ROI</div><div className="v">{trackerStats.roi.toFixed(1)}%</div></div>
              </div>
            </div>

            <div className="card">
              <h2 className="sectionTitle">Tracked Bets</h2>
              {tracked.length === 0 ? (
                <p className="muted">No tracked bets yet. Add from Scanner or Best Bets.</p>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Match</th>
                        <th>Pick</th>
                        <th>Odds</th>
                        <th>Stake</th>
                        <th>Edge</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracked.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {row.match}
                            <div className="small">{row.market} · {row.confidence}</div>
                          </td>
                          <td>{row.pick}</td>
                          <td>
                            <input className="input" value={row.odds} onChange={(e) => updateTracked(row.id, "odds", e.target.value)} />
                          </td>
                          <td>
                            <input className="input" value={row.stake} onChange={(e) => updateTracked(row.id, "stake", e.target.value)} />
                          </td>
                          <td>{Number(row.edge).toFixed(1)}%</td>
                          <td>
                            <select className="input" value={row.result} onChange={(e) => updateTracked(row.id, "result", e.target.value)}>
                              <option>Pending</option>
                              <option>Won</option>
                              <option>Lost</option>
                              <option>Void</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className="settingsGrid">
            <div className="card">
              <h2 className="sectionTitle">Settings</h2>
              <p className="sectionSub">Tune your scanner thresholds and defaults.</p>
              <div className="formGrid">
                <div className="field">
                  <label>Edge threshold %</label>
                  <input className="input" value={settings.edgeThreshold} onChange={(e) => setSettings(s => ({...s, edgeThreshold: Number(e.target.value) || 0}))} />
                </div>
                <div className="field">
                  <label>Suggested odds multiplier</label>
                  <input className="input" value={settings.suggestedMultiplier} onChange={(e) => setSettings(s => ({...s, suggestedMultiplier: Number(e.target.value) || 1}))} />
                </div>
                <div className="field">
                  <label>Strong stake</label>
                  <input className="input" value={settings.stakeStrong} onChange={(e) => setSettings(s => ({...s, stakeStrong: Number(e.target.value) || 0}))} />
                </div>
                <div className="field">
                  <label>Good stake</label>
                  <input className="input" value={settings.stakeGood} onChange={(e) => setSettings(s => ({...s, stakeGood: Number(e.target.value) || 0}))} />
                </div>
                <div className="field">
                  <label>Lean stake</label>
                  <input className="input" value={settings.stakeLean} onChange={(e) => setSettings(s => ({...s, stakeLean: Number(e.target.value) || 0}))} />
                </div>
              </div>
              <div className="pillRow">
                <button className={`pill ${settings.homeAwayBoost ? "active" : ""}`} onClick={() => setSettings(s => ({...s, homeAwayBoost: !s.homeAwayBoost}))}>
                  {settings.homeAwayBoost ? "Home/Away boost on" : "Home/Away boost off"}
                </button>
                <button className={`pill ${settings.knockoutMode ? "active" : ""}`} onClick={() => setSettings(s => ({...s, knockoutMode: !s.knockoutMode}))}>
                  {settings.knockoutMode ? "Knockout mode on" : "Knockout mode off"}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
