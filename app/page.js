"use client";
import { useMemo, useState } from "react";

const MARKET_CONFIG = {
  goals: {
    label: "Goals",
    emoji: "⚽",
    lineHint: "Usually 2.5, 3.5, 1.5 etc",
    forLabel: "Goals scored avg",
    againstLabel: "Goals conceded avg",
    help: "Use last 5 or 10 match averages.",
  },
  sot: {
    label: "Shots on Target",
    emoji: "🎯",
    lineHint: "Usually 7.5–9.5",
    forLabel: "SOT for avg",
    againstLabel: "SOT against avg",
    help: "Use team SOT for/against averages.",
  },
  corners: {
    label: "Corners",
    emoji: "🚩",
    lineHint: "Usually 8.5–10.5",
    forLabel: "Corners for avg",
    againstLabel: "Corners against avg",
    help: "Use corners for/against.",
  },
  cards: {
    label: "Cards",
    emoji: "🟨",
    lineHint: "Usually 3.5–5.5",
    forLabel: "Cards avg",
    againstLabel: "Cards against avg",
    help: "Use team card averages.",
  },
};

const DEFAULTS = {
  goals: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "2.5", overOdds: "", underOdds: "" },
  sot: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "8.5", overOdds: "", underOdds: "" },
  corners: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "9.5", overOdds: "", underOdds: "" },
  cards: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "4.5", overOdds: "", underOdds: "" },
};

function parseNum(v){ const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// Poisson helpers
let factCache = [0];
function logFactorial(n){
  if (factCache[n] != null) return factCache[n];
  let sum = factCache[factCache.length-1];
  for (let i = factCache.length; i <= n; i++){ sum += Math.log(i); factCache[i] = sum; }
  return factCache[n];
}
function poissonPmf(k, lambda){
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
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
    const p2 = 1 - poissonCdf(whole+1, lambda);
    return (p1 + p2) / 2;
  }
  return 1 - poissonCdf(Math.floor(line), lambda);
}

function fairProbsFromOdds(overOdds, underOdds){
  const pO = 1/overOdds; const pU = 1/underOdds; const total = pO + pU;
  return { fairOver: pO/total, fairUnder: pU/total };
}

function analyse(market, v){
  const homeFor = parseNum(v.homeFor);
  const homeAgainst = parseNum(v.homeAgainst);
  const awayFor = parseNum(v.awayFor);
  const awayAgainst = parseNum(v.awayAgainst);
  const line = parseNum(v.line);
  const overOdds = parseNum(v.overOdds);
  const underOdds = parseNum(v.underOdds);

  if ([homeFor, homeAgainst, awayFor, awayAgainst, line, overOdds, underOdds].some(x => x == null || x <= 0)) return null;

  const expectedHome = (homeFor + awayAgainst)/2;
  const expectedAway = (awayFor + homeAgainst)/2;
  let expectedTotal = expectedHome + expectedAway;

  const marketAdjust = { goals: 1.0, sot: 1.0, corners: 1.03, cards: 1.02 };
  expectedTotal = expectedTotal * (marketAdjust[market] || 1);

  const modelOver = probOverAsian(line, expectedTotal);
  const modelUnder = 1 - modelOver;
  const { fairOver, fairUnder } = fairProbsFromOdds(overOdds, underOdds);

  const overEdge = (modelOver - fairOver) * 100;
  const underEdge = (modelUnder - fairUnder) * 100;

  let pick = "SKIP";
  let side = "skip";
  let edge = 0;

  if (overEdge > 3 && overEdge > underEdge){ pick = `OVER ${line}`; side = "over"; edge = overEdge; }
  else if (underEdge > 3 && underEdge > overEdge){ pick = `UNDER ${line}`; side = "under"; edge = underEdge; }

  let confidence = "Low";
  if (edge >= 8) confidence = "Strong";
  else if (edge >= 5) confidence = "Good";
  else if (edge >= 3) confidence = "Lean";

  // True line approx (median where P(Over)=0.5). Use mean as proxy for simplicity
  const trueLine = expectedTotal;

  // Confidence score 0–10
  const confidenceScore = Math.max(0, Math.min(10, edge / 1.5));

  // Volatility: closeness to line
  const diff = expectedTotal - line;
  const volatility = Math.abs(diff) < 0.15 ? "High variance (close to line)" : "Normal";

  // Explanation
  let explanation = "No clear edge → skip.";
  if (side === "over") explanation = "Model slightly higher than market → OVER value.";
  if (side === "under") explanation = "Market overpriced → UNDER value.";

  return { expectedHome, expectedAway, expectedTotal, modelOver, modelUnder, fairOver, fairUnder, overEdge, underEdge, pick, side, edge, confidence, trueLine, confidenceScore, volatility, explanation };
}

const pct = v => `${(v*100).toFixed(1)}%`;
const num = v => Number(v).toFixed(2);

export default function App(){
  const [market, setMarket] = useState("goals");
  const [forms, setForms] = useState(DEFAULTS);
  const active = forms[market];
  const cfg = MARKET_CONFIG[market];

  const result = useMemo(()=> analyse(market, active), [market, active]);

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
  function clearActive(){ setForms(prev => ({ ...prev, [market]: DEFAULTS[market] })); }

  const badgeClass =
    !result || result.side === "skip" ? "badge red"
    : result.confidence === "Strong" ? "badge green"
    : result.confidence === "Good" ? "badge green"
    : "badge amber";

  const glowClass =
    !result || result.side === "skip" ? "glow-skip"
    : result.confidence === "Strong" ? "glow-strong"
    : result.confidence === "Good" ? "glow-good"
    : "glow-lean";

  // Edge meter calc (scale -10% to +10%)
  function edgeWidth(edge){ const clamped = Math.max(-10, Math.min(10, edge)); return Math.abs(clamped) * 5; } // 0–50% on each side

  return (
    <main className="page">
      <div className="shell">
        <section className="hero">
          <div className="heroCard">
            <div className="titleRow">
              <div className="logo">🔥</div>
              <div>
                <div className="title">Value Scanner</div>
                <div className="subtitle">Phase 1 upgrade: clearer decisions, true line, edge meter, and confidence.</div>
              </div>
            </div>
            <div className="heroStats">
              <div className="statBox"><div className="statLabel">Market</div><div className="statValue">{cfg.emoji} {cfg.label}</div></div>
              <div className="statBox"><div className="statLabel">Edge trigger</div><div className="statValue">&gt; 3%</div></div>
              <div className="statBox"><div className="statLabel">Mode</div><div className="statValue">Advanced</div></div>
            </div>
          </div>
          <aside className="helpCard">
            <h3>How to use</h3>
            <p>{cfg.help}</p>
            <ul>
              <li>Home expected = avg(home attack, away allowed)</li>
              <li>Away expected = avg(away attack, home allowed)</li>
              <li>We de-vig odds before comparing</li>
            </ul>
          </aside>
        </section>

        <section className="grid">
          <div className="panel">
            <div className="tabs">
              {Object.entries(MARKET_CONFIG).map(([k, item]) => (
                <button key={k} className={`tabBtn ${market===k?"active":""}`} onClick={()=>setMarket(k)}>
                  {item.emoji} {item.label}
                </button>
              ))}
            </div>

            <h2 className="sectionTitle">{cfg.label} inputs</h2>
            <p className="sectionHint">{cfg.lineHint}</p>

            <div className="formGrid">
              <div className="field full">
                <label>Match</label>
                <input className="input" value={active.match} onChange={e=>update("match", e.target.value)} placeholder="Bologna vs Aston Villa"/>
              </div>

              <div className="field">
                <label>Home {cfg.forLabel}</label>
                <input className="input" value={active.homeFor} onChange={e=>update("homeFor", e.target.value)} placeholder="e.g. 1.4"/>
              </div>
              <div className="field">
                <label>Home {cfg.againstLabel}</label>
                <input className="input" value={active.homeAgainst} onChange={e=>update("homeAgainst", e.target.value)} placeholder="e.g. 1.1"/>
              </div>

              <div className="field">
                <label>Away {cfg.forLabel}</label>
                <input className="input" value={active.awayFor} onChange={e=>update("awayFor", e.target.value)} placeholder="e.g. 1.2"/>
              </div>
              <div className="field">
                <label>Away {cfg.againstLabel}</label>
                <input className="input" value={active.awayAgainst} onChange={e=>update("awayAgainst", e.target.value)} placeholder="e.g. 1.5"/>
              </div>

              <div className="field">
                <label>Line</label>
                <input className="input" value={active.line} onChange={e=>update("line", e.target.value)} placeholder="2.5"/>
              </div>
              <div className="field">
                <label>Over odds</label>
                <input className="input" value={active.overOdds} onChange={e=>update("overOdds", e.target.value)} placeholder="2.10"/>
              </div>
              <div className="field">
                <label>Under odds</label>
                <input className="input" value={active.underOdds} onChange={e=>update("underOdds", e.target.value)} placeholder="1.72"/>
              </div>
            </div>

            <div className="actions">
              <button className="btn primary" onClick={loadExample}>Load example</button>
              <button className="btn secondary" onClick={clearActive}>Clear</button>
            </div>
          </div>

          <div className={`resultCard ${glowClass}`}>
            {!result ? (
              <>
                <h2 className="sectionTitle">Result</h2>
                <p className="sectionHint">Fill inputs to calculate.</p>
              </>
            ) : (
              <>
                <div className="pickBanner">
                  <div>
                    <div className="pickText">{result.pick}</div>
                    <div className="pickSub">{active.match || cfg.label}</div>
                    <div className="trueLineRow">
                      <span className="trueBadge">True: {num(result.trueLine)}</span>
                      <span className="trueBadge">Book: {active.line}</span>
                      <span className={`trueBadge trueDiff ${result.trueLine >= active.line ? "up" : "down"}`}>
                        Δ {num(result.trueLine - parseFloat(active.line))}
                      </span>
                    </div>
                  </div>
                  <div className={badgeClass}>{result.confidence}</div>
                </div>

                <div className="metrics">
                  <div className="metric"><div className="k">Exp home</div><div className="v">{num(result.expectedHome)}</div></div>
                  <div className="metric"><div className="k">Exp away</div><div className="v">{num(result.expectedAway)}</div></div>
                  <div className="metric"><div className="k">Exp total</div><div className="v">{num(result.expectedTotal)}</div></div>
                  <div className="metric"><div className="k">Edge</div><div className="v">{result.edge.toFixed(1)}%</div></div>
                </div>

                <div className="details">
                  <div className="detailBox">
                    <h4>Model</h4>
                    <p>Over: {pct(result.modelOver)}</p>
                    <p>Under: {pct(result.modelUnder)}</p>
                  </div>
                  <div className="detailBox">
                    <h4>Book (fair)</h4>
                    <p>Over: {pct(result.fairOver)}</p>
                    <p>Under: {pct(result.fairUnder)}</p>
                  </div>

                  <div className={`detailBox ${result.side==="over"?"":"dim"}`}>
                    <h4>Over edge</h4>
                    <p>{result.overEdge.toFixed(1)}%</p>
                  </div>
                  <div className={`detailBox ${result.side==="under"?"":"dim"}`}>
                    <h4>Under edge</h4>
                    <p>{result.underEdge.toFixed(1)}%</p>
                  </div>
                </div>

                {/* Edge meter */}
                <div className="edgeMeter">
                  <div className="edgeBar">
                    <div className="edgeCenter"></div>
                    {result.overEdge > 0 && (
                      <div className="edgeFill over" style={{ width: edgeWidth(result.overEdge) + "%", left: "50%" }}></div>
                    )}
                    {result.underEdge > 0 && (
                      <div className="edgeFill under" style={{ width: edgeWidth(result.underEdge) + "%", right: "50%" }}></div>
                    )}
                  </div>
                  <div className="edgeLabel">
                    <span>UNDER</span>
                    <span>OVER</span>
                  </div>
                </div>

                {/* Explanation + confidence */}
                <div className="explain">
                  {result.explanation} · Confidence: {result.confidenceScore.toFixed(1)}/10 · {result.volatility}
                </div>

                {/* Bottom decision bar */}
                <div className="decisionBar">
                  <div className={`decisionText ${result.confidence === "Strong" ? "strong" : result.confidence === "Good" ? "good" : result.confidence === "Lean" ? "lean" : "skip"}`}>
                    {result.side === "skip" ? "NO BET" : `${result.confidence.toUpperCase()} ${result.pick} (${result.edge.toFixed(1)}%)`}
                  </div>
                  <div className="trueBadge">Line {active.line}</div>
                </div>

                <div className="note">
                  Transparent model. Use alongside your judgement (injuries, lineups, game state).
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
