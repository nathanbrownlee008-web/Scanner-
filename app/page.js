"use client";
import { useMemo, useState } from "react";

const MARKET_CONFIG = {
  goals: {
    label: "Goals",
    emoji: "⚽",
    lineHint: "Usually 2.5, 3.5, 1.5 etc",
    forLabel: "Goals scored avg",
    againstLabel: "Goals conceded avg",
  },
  sot: {
    label: "Shots on Target",
    emoji: "🎯",
    lineHint: "Usually 7.5–9.5",
    forLabel: "SOT for avg",
    againstLabel: "SOT against avg",
  },
  corners: {
    label: "Corners",
    emoji: "🚩",
    lineHint: "Usually 8.5–10.5",
    forLabel: "Corners for avg",
    againstLabel: "Corners against avg",
  },
  cards: {
    label: "Cards",
    emoji: "🟨",
    lineHint: "Usually 3.5–5.5",
    forLabel: "Cards avg",
    againstLabel: "Cards against avg",
  },
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

function parseNum(v){
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

let factCache = [0];
function logFactorial(n){
  if (factCache[n] != null) return factCache[n];
  let sum = factCache[factCache.length - 1];
  for (let i = factCache.length; i <= n; i++){
    sum += Math.log(i);
    factCache[i] = sum;
  }
  return factCache[n];
}
function poissonPmf(k, lambda){
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}
function poissonCdf(k, lambda){
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}
function probOverAsian(line, lambda){
  const whole = Math.floor(line);
  const frac = +(line - whole).toFixed(2);
  if (Math.abs(frac - 0.5) < 0.01) return 1 - poissonCdf(whole, lambda);
  if (Math.abs(frac - 0.0) < 0.01) return 1 - poissonCdf(whole, lambda);
  if (Math.abs(frac - 0.25) < 0.01) {
    const p1 = 1 - poissonCdf(whole, lambda);
    const p2 = 1 - poissonCdf(whole, lambda);
    return (p1 + p2) / 2;
  }
  if (Math.abs(frac - 0.75) < 0.01) {
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

function analyseRow(row){
  const homeFor = parseNum(row.homeFor);
  const homeAgainst = parseNum(row.homeAgainst);
  const awayFor = parseNum(row.awayFor);
  const awayAgainst = parseNum(row.awayAgainst);
  const line = parseNum(row.line);
  const overOdds = parseNum(row.overOdds);
  const underOdds = parseNum(row.underOdds);
  const market = row.market;

  if ([homeFor, homeAgainst, awayFor, awayAgainst, line, overOdds, underOdds].some((v) => v == null || v <= 0)) {
    return null;
  }

  const expectedHome = (homeFor + awayAgainst) / 2;
  const expectedAway = (awayFor + homeAgainst) / 2;
  const marketAdjust = { goals: 1.0, sot: 1.0, corners: 1.03, cards: 1.02 };
  const expectedTotal = (expectedHome + expectedAway) * (marketAdjust[market] || 1);

  const modelOver = probOverAsian(line, expectedTotal);
  const modelUnder = 1 - modelOver;
  const { fairOver, fairUnder } = fairProbsFromOdds(overOdds, underOdds);

  const overEdge = (modelOver - fairOver) * 100;
  const underEdge = (modelUnder - fairUnder) * 100;

  let side = "skip";
  let pick = "SKIP";
  let edge = 0;
  if (overEdge > 3 && overEdge > underEdge) {
    side = "over";
    pick = `OVER ${line}`;
    edge = overEdge;
  } else if (underEdge > 3 && underEdge > overEdge) {
    side = "under";
    pick = `UNDER ${line}`;
    edge = underEdge;
  }

  let confidence = "Low";
  if (edge >= 8) confidence = "Strong";
  else if (edge >= 5) confidence = "Good";
  else if (edge >= 3) confidence = "Lean";

  const fairOverOdds = modelOver > 0 ? 1 / modelOver : 0;
  const fairUnderOdds = modelUnder > 0 ? 1 / modelUnder : 0;
  const suggestedOverOdds = fairOverOdds * 1.05;
  const suggestedUnderOdds = fairUnderOdds * 1.05;

  const trueLine = expectedTotal;
  const confidenceScore = Math.max(0, Math.min(10, edge / 1.5));
  const volatility = Math.abs(expectedTotal - line) < 0.15 ? "High variance" : "Normal";
  const explanation =
    side === "over" ? "Model higher than market → OVER value." :
    side === "under" ? "Market overpriced → UNDER value." :
    "No clear edge → skip.";

  return {
    ...row,
    expectedHome,
    expectedAway,
    expectedTotal,
    modelOver,
    modelUnder,
    fairOver,
    fairUnder,
    overEdge,
    underEdge,
    side,
    pick,
    edge,
    confidence,
    fairOverOdds,
    fairUnderOdds,
    suggestedOverOdds,
    suggestedUnderOdds,
    trueLine,
    confidenceScore,
    volatility,
    explanation,
  };
}

function parseBulk(text){
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const p = line.split(",").map((x) => x.trim());
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
    })
    .filter(Boolean);
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const num = (v) => Number(v).toFixed(2);

export default function App(){
  const [market, setMarket] = useState("goals");
  const [forms, setForms] = useState(DEFAULTS);
  const [bulkText, setBulkText] = useState(BULK_EXAMPLE);
  const [rows, setRows] = useState([]);

  const active = forms[market];
  const cfg = MARKET_CONFIG[market];
  const singleResult = useMemo(() => analyseRow({ ...active, market }), [active, market]);
  const analysedRows = useMemo(() => rows.map(analyseRow).filter(Boolean).sort((a,b) => b.edge - a.edge), [rows]);

  const strongCount = analysedRows.filter(r => r.confidence === "Strong").length;
  const goodCount = analysedRows.filter(r => r.confidence === "Good").length;
  const leanCount = analysedRows.filter(r => r.confidence === "Lean").length;
  const bestRow = analysedRows[0] || null;

  function update(field, value){
    setForms(prev => ({
      ...prev,
      [market]: { ...prev[market], [field]: value }
    }));
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
    const item = { ...active, market, id: `${Date.now()}-single` };
    setRows(prev => [item, ...prev]);
  }

  function importBulk(){
    const parsed = parseBulk(bulkText);
    setRows(parsed);
  }

  function clearScanner(){
    setRows([]);
  }

  function edgeWidth(edge){
    const clamped = Math.max(-10, Math.min(10, edge));
    return Math.abs(clamped) * 5;
  }

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

  return (
    <main className="page">
      <div className="shell">

        <section className="hero">
          <div className="heroCard">
            <div className="titleRow">
              <div className="logo">🔥</div>
              <div>
                <div className="title">Value Scanner Phase 2</div>
                <div className="subtitle">
                  Dashboard + scanner version with fair odds and suggested odds. You can now analyse one game properly and also rank multiple games by edge.
                </div>
              </div>
            </div>
            <p className="muted">
              Fair odds = the odds implied by your model. Suggested odds = a slightly safer price target to look for.
            </p>
          </div>

          <aside className="helpCard">
            <h3>What to look for</h3>
            <ul>
              <li><strong>Fair odds</strong>: your model's break-even price.</li>
              <li><strong>Suggested odds</strong>: a slightly better price target than fair odds.</li>
              <li>If the bookie is offering <strong>higher</strong> odds than your fair/suggested price on the side you like, that is where value can appear.</li>
            </ul>
          </aside>
        </section>

        <section className="dashboardGrid">
          <div className="kpiCard">
            <div className="kpiLabel">Scanned rows</div>
            <div className="kpiValue">{analysedRows.length}</div>
            <div className="kpiSub">Multi-game scanner</div>
          </div>
          <div className="kpiCard">
            <div className="kpiLabel">Strong bets</div>
            <div className="kpiValue">{strongCount}</div>
            <div className="kpiSub">Highest priority</div>
          </div>
          <div className="kpiCard">
            <div className="kpiLabel">Good bets</div>
            <div className="kpiValue">{goodCount}</div>
            <div className="kpiSub">Playable</div>
          </div>
          <div className="kpiCard">
            <div className="kpiLabel">Best edge</div>
            <div className="kpiValue">{bestRow ? `${bestRow.edge.toFixed(1)}%` : "-"}</div>
            <div className="kpiSub">{bestRow ? bestRow.match : "No rows yet"}</div>
          </div>
        </section>

        <section className="scannerGrid">
          <div className="panel">
            <div className="tabs">
              {Object.entries(MARKET_CONFIG).map(([k, item]) => (
                <button key={k} className={`tabBtn ${market === k ? "active" : ""}`} onClick={() => setMarket(k)}>
                  {item.emoji} {item.label}
                </button>
              ))}
            </div>

            <h3>{cfg.label} single-game model</h3>
            <p className="muted">{cfg.lineHint}</p>

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
            </div>

            <div style={{ marginTop: 18 }}>
              <h3>Bulk scanner</h3>
              <p className="muted">Format: match,market,homeFor,homeAgainst,awayFor,awayAgainst,line,overOdds,underOdds</p>
              <textarea className="textarea" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              <div className="actions">
                <button className="btn primary" onClick={importBulk}>Import rows</button>
                <button className="btn secondary" onClick={clearScanner}>Clear scanner</button>
              </div>
            </div>
          </div>

          <div className="card">
            {!singleResult ? (
              <>
                <h3>Single-game result</h3>
                <p className="muted">Fill in all inputs to calculate.</p>
              </>
            ) : (
              <>
                <div className="pickList">
                  <div className="pickCard">
                    <div className="pickTop">
                      <div>
                        <div className="pickName">{singleResult.pick}</div>
                        <div className="pickSub">{active.match || cfg.label} · {cfg.label}</div>
                      </div>
                      <div className={badgeClass(singleResult.confidence)}>{singleResult.confidence}</div>
                    </div>

                    <div className="metrics">
                      <div className="metric"><div className="k">Expected total</div><div className="v">{num(singleResult.expectedTotal)}</div></div>
                      <div className="metric"><div className="k">True line</div><div className="v">{num(singleResult.trueLine)}</div></div>
                      <div className="metric"><div className="k">Best edge</div><div className="v">{singleResult.edge.toFixed(1)}%</div></div>
                      <div className="metric"><div className="k">Confidence</div><div className="v">{singleResult.confidenceScore.toFixed(1)}/10</div></div>
                    </div>

                    <div className="details">
                      <div className="detailBox">
                        <h4>Model probabilities</h4>
                        <p>Over: {pct(singleResult.modelOver)}</p>
                        <p>Under: {pct(singleResult.modelUnder)}</p>
                      </div>

                      <div className="detailBox">
                        <h4>Book fair probabilities</h4>
                        <p>Over: {pct(singleResult.fairOver)}</p>
                        <p>Under: {pct(singleResult.fairUnder)}</p>
                      </div>

                      <div className="detailBox">
                        <h4>Fair odds to look for</h4>
                        <p>Over fair odds: {num(singleResult.fairOverOdds)}</p>
                        <p>Under fair odds: {num(singleResult.fairUnderOdds)}</p>
                      </div>

                      <div className="detailBox">
                        <h4>Suggested odds target</h4>
                        <p>Over suggested: {num(singleResult.suggestedOverOdds)}</p>
                        <p>Under suggested: {num(singleResult.suggestedUnderOdds)}</p>
                      </div>

                      <div className="detailBox">
                        <h4>Over edge</h4>
                        <p>{singleResult.overEdge.toFixed(1)}%</p>
                      </div>

                      <div className="detailBox">
                        <h4>Under edge</h4>
                        <p>{singleResult.underEdge.toFixed(1)}%</p>
                      </div>
                    </div>

                    <div className="edgeMeter">
                      <div className="edgeBar">
                        <div className="edgeCenter"></div>
                        {singleResult.overEdge > 0 && (
                          <div className="edgeFill over" style={{ width: edgeWidth(singleResult.overEdge) + "%", left: "50%" }}></div>
                        )}
                        {singleResult.underEdge > 0 && (
                          <div className="edgeFill under" style={{ width: edgeWidth(singleResult.underEdge) + "%", right: "50%" }}></div>
                        )}
                      </div>
                      <div className="edgeLabel">
                        <span>UNDER</span>
                        <span>OVER</span>
                      </div>
                    </div>

                    <div className="decisionBar">
                      <div className={`decisionText ${decisionClass}`}>
                        {singleResult.side === "skip" ? "NO BET" : `${singleResult.confidence.toUpperCase()} ${singleResult.pick} (${singleResult.edge.toFixed(1)}%)`}
                      </div>
                      <div className="small">{singleResult.explanation} · {singleResult.volatility}</div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section style={{ marginTop: 18 }}>
          <div className="panel">
            <h3>Best bets dashboard</h3>
            <p className="muted">Sorted by edge. Fair odds = your model break-even. Suggested odds = a slightly safer target price.</p>

            {analysedRows.length === 0 ? (
              <p className="muted">No scanned rows yet. Use “Add to scanner” or bulk import.</p>
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
                      <th>Book over/under</th>
                      <th>Fair odds</th>
                      <th>Suggested odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysedRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div>{row.match}</div>
                          <div className="small">{MARKET_CONFIG[row.market]?.label || row.market}</div>
                        </td>
                        <td>{MARKET_CONFIG[row.market]?.emoji} {MARKET_CONFIG[row.market]?.label}</td>
                        <td className="rowPick">{row.pick}</td>
                        <td className={row.edge > 0 ? "pos" : "neutral"}>{row.edge.toFixed(1)}%</td>
                        <td>{row.confidence}</td>
                        <td>{num(row.trueLine)}</td>
                        <td>{row.line}</td>
                        <td>{row.overOdds} / {row.underOdds}</td>
                        <td>
                          {row.side === "over" ? `Over ${num(row.fairOverOdds)}` :
                           row.side === "under" ? `Under ${num(row.fairUnderOdds)}` :
                           `Over ${num(row.fairOverOdds)} · Under ${num(row.fairUnderOdds)}`}
                        </td>
                        <td>
                          {row.side === "over" ? `Over ${num(row.suggestedOverOdds)}` :
                           row.side === "under" ? `Under ${num(row.suggestedUnderOdds)}` :
                           `Over ${num(row.suggestedOverOdds)} · Under ${num(row.suggestedUnderOdds)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
