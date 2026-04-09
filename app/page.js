"use client";
import { useMemo, useState } from "react";

const MARKET_CONFIG = {
  goals: {
    label: "Goals",
    emoji: "⚽",
    lineHint: "Usually 2.5, 3.5, 1.5 etc",
    forLabel: "Goals scored avg",
    againstLabel: "Goals conceded avg",
    help: "Use last 5 or 10 match averages. Example: home scored avg, home conceded avg, away scored avg, away conceded avg.",
  },
  sot: {
    label: "Shots on Target",
    emoji: "🎯",
    lineHint: "Usually 7.5, 8.5, 9.5 etc",
    forLabel: "SOT for avg",
    againstLabel: "SOT against avg",
    help: "Use team SOT for and SOT against averages so the total estimate is more realistic.",
  },
  corners: {
    label: "Corners",
    emoji: "🚩",
    lineHint: "Usually 8.5, 9.5, 10.5 etc",
    forLabel: "Corners for avg",
    againstLabel: "Corners against avg",
    help: "Use corners won and corners conceded averages for each team.",
  },
  cards: {
    label: "Cards",
    emoji: "🟨",
    lineHint: "Usually 3.5, 4.5, 5.5 etc",
    forLabel: "Cards avg",
    againstLabel: "Cards against avg",
    help: "Use team card averages. If you know the referee is strict, manually push the line up in your own judgement.",
  },
};

const DEFAULTS = {
  goals: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "2.5", overOdds: "", underOdds: "" },
  sot: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "8.5", overOdds: "", underOdds: "" },
  corners: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "9.5", overOdds: "", underOdds: "" },
  cards: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "4.5", overOdds: "", underOdds: "" },
};

function parseNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
}

const factCache = [0];
function logFactorial(n) {
  if (factCache[n] != null) return factCache[n];
  let sum = factCache[factCache.length - 1];
  for (let i = factCache.length; i <= n; i++) {
    sum += Math.log(i);
    factCache[i] = sum;
  }
  return factCache[n];
}

function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}

function probOverAsian(line, lambda) {
  const whole = Math.floor(line);
  const frac = +(line - whole).toFixed(2);

  if (Math.abs(frac - 0.5) < 0.01) {
    return 1 - poissonCdf(whole, lambda);
  }
  if (Math.abs(frac - 0.0) < 0.01) {
    return 1 - poissonCdf(whole, lambda);
  }
  if (Math.abs(frac - 0.25) < 0.01) {
    const pOverWhole = 1 - poissonCdf(whole, lambda);
    const pOverHalf = 1 - poissonCdf(whole, lambda);
    return (pOverWhole + pOverHalf) / 2;
  }
  if (Math.abs(frac - 0.75) < 0.01) {
    const pOverHalf = 1 - poissonCdf(whole, lambda);
    const pOverNext = 1 - poissonCdf(whole + 1, lambda);
    return (pOverHalf + pOverNext) / 2;
  }
  return 1 - poissonCdf(Math.floor(line), lambda);
}

function fairProbsFromOdds(overOdds, underOdds) {
  const pO = 1 / overOdds;
  const pU = 1 / underOdds;
  const total = pO + pU;
  return { fairOver: pO / total, fairUnder: pU / total };
}

function analyse(market, values) {
  const homeFor = parseNum(values.homeFor);
  const homeAgainst = parseNum(values.homeAgainst);
  const awayFor = parseNum(values.awayFor);
  const awayAgainst = parseNum(values.awayAgainst);
  const line = parseNum(values.line);
  const overOdds = parseNum(values.overOdds);
  const underOdds = parseNum(values.underOdds);

  if ([homeFor, homeAgainst, awayFor, awayAgainst, line, overOdds, underOdds].some((v) => v == null || v <= 0)) {
    return null;
  }

  const expectedHome = (homeFor + awayAgainst) / 2;
  const expectedAway = (awayFor + homeAgainst) / 2;
  let expectedTotal = expectedHome + expectedAway;

  const marketAdjustments = {
    goals: 1.0,
    sot: 1.0,
    corners: 1.03,
    cards: 1.02,
  };
  expectedTotal = expectedTotal * (marketAdjustments[market] || 1);

  const modelOver = probOverAsian(line, expectedTotal);
  const modelUnder = 1 - modelOver;
  const { fairOver, fairUnder } = fairProbsFromOdds(overOdds, underOdds);

  const overEdge = (modelOver - fairOver) * 100;
  const underEdge = (modelUnder - fairUnder) * 100;

  let pick = "SKIP";
  let side = "skip";
  let edge = 0;

  if (overEdge > 3 && overEdge > underEdge) {
    pick = `OVER ${line}`;
    side = "over";
    edge = overEdge;
  } else if (underEdge > 3 && underEdge > overEdge) {
    pick = `UNDER ${line}`;
    side = "under";
    edge = underEdge;
  }

  let confidence = "Low";
  if (edge >= 8) confidence = "Strong";
  else if (edge >= 5) confidence = "Good";
  else if (edge >= 3) confidence = "Lean";

  return {
    expectedHome,
    expectedAway,
    expectedTotal,
    modelOver,
    modelUnder,
    fairOver,
    fairUnder,
    overEdge,
    underEdge,
    pick,
    side,
    edge,
    confidence,
  };
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function num(v) {
  return Number(v).toFixed(2);
}

export default function App() {
  const [market, setMarket] = useState("goals");
  const [forms, setForms] = useState(DEFAULTS);
  const active = forms[market];
  const cfg = MARKET_CONFIG[market];

  const result = useMemo(() => analyse(market, active), [market, active]);

  function update(field, value) {
    setForms((prev) => ({
      ...prev,
      [market]: {
        ...prev[market],
        [field]: value,
      },
    }));
  }

  function loadExample() {
    const examples = {
      goals: { match: "Freiburg vs Celta Vigo", homeFor: "1.4", homeAgainst: "1.1", awayFor: "1.2", awayAgainst: "1.5", line: "2.5", overOdds: "2.20", underOdds: "1.67" },
      sot: { match: "Bologna vs Aston Villa", homeFor: "3.8", homeAgainst: "4.4", awayFor: "4.7", awayAgainst: "3.9", line: "8.5", overOdds: "1.95", underOdds: "1.75" },
      corners: { match: "Bologna vs Aston Villa", homeFor: "5.2", homeAgainst: "4.6", awayFor: "5.0", awayAgainst: "4.8", line: "9.5", overOdds: "1.91", underOdds: "1.80" },
      cards: { match: "Porto vs Nottingham Forest", homeFor: "2.1", homeAgainst: "2.3", awayFor: "2.2", awayAgainst: "2.0", line: "4.5", overOdds: "2.15", underOdds: "1.60" },
    };
    setForms((prev) => ({ ...prev, [market]: examples[market] }));
  }

  function clearActive() {
    setForms((prev) => ({ ...prev, [market]: DEFAULTS[market] }));
  }

  const badgeClass =
    !result || result.side === "skip"
      ? "badge red"
      : result.confidence === "Strong"
      ? "badge green"
      : result.confidence === "Good"
      ? "badge green"
      : "badge amber";

  return (
    <main className="page">
      <div className="shell">
        <section className="hero">
          <div className="heroCard">
            <div className="titleRow">
              <div className="logo">🔥</div>
              <div>
                <div className="title">Value Scanner</div>
                <div className="subtitle">
                  Proper per-market inputs for goals, shots on target, corners, and cards. This version uses team for / against averages, estimates expected home and away output, then compares your model against bookmaker fair probabilities.
                </div>
              </div>
            </div>

            <div className="heroStats">
              <div className="statBox">
                <div className="statLabel">Active market</div>
                <div className="statValue">{cfg.emoji} {cfg.label}</div>
              </div>
              <div className="statBox">
                <div className="statLabel">Best with</div>
                <div className="statValue">Last 5–10 avgs</div>
              </div>
              <div className="statBox">
                <div className="statLabel">Edge trigger</div>
                <div className="statValue">&gt; 3.0%</div>
              </div>
            </div>
          </div>

          <aside className="helpCard">
            <h3>How to use</h3>
            <p>{cfg.help}</p>
            <ul>
              <li>Home expected = average of home attack and away allowed.</li>
              <li>Away expected = average of away attack and home allowed.</li>
              <li>Total expected is compared against the bookmaker line.</li>
              <li>Odds are de-vigged before value is shown.</li>
            </ul>
          </aside>
        </section>

        <section className="grid">
          <div className="panel">
            <div className="tabs">
              {Object.entries(MARKET_CONFIG).map(([key, item]) => (
                <button
                  key={key}
                  className={`tabBtn ${market === key ? "active" : ""}`}
                  onClick={() => setMarket(key)}
                >
                  {item.emoji} {item.label}
                </button>
              ))}
            </div>

            <h2 className="sectionTitle">{cfg.label} model inputs</h2>
            <p className="sectionHint">Enter proper team for / against averages, not random numbers. {cfg.lineHint}.</p>

            <div className="formGrid">
              <div className="field full">
                <label>Match name</label>
                <input className="input" value={active.match} onChange={(e) => update("match", e.target.value)} placeholder="Bologna vs Aston Villa" />
              </div>

              <div className="field">
                <label>Home team {cfg.forLabel}</label>
                <input className="input" value={active.homeFor} onChange={(e) => update("homeFor", e.target.value)} placeholder="e.g. 1.4" />
              </div>

              <div className="field">
                <label>Home team {cfg.againstLabel}</label>
                <input className="input" value={active.homeAgainst} onChange={(e) => update("homeAgainst", e.target.value)} placeholder="e.g. 1.1" />
              </div>

              <div className="field">
                <label>Away team {cfg.forLabel}</label>
                <input className="input" value={active.awayFor} onChange={(e) => update("awayFor", e.target.value)} placeholder="e.g. 1.2" />
              </div>

              <div className="field">
                <label>Away team {cfg.againstLabel}</label>
                <input className="input" value={active.awayAgainst} onChange={(e) => update("awayAgainst", e.target.value)} placeholder="e.g. 1.5" />
              </div>

              <div className="field">
                <label>Bookmaker line</label>
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
              <button className="btn secondary" onClick={clearActive}>Clear tab</button>
            </div>
          </div>

          <div className="resultCard">
            {!result ? (
              <>
                <h2 className="sectionTitle">Result</h2>
                <p className="sectionHint">Fill in all boxes to see the model output.</p>
              </>
            ) : (
              <>
                <div className="pickBanner">
                  <div>
                    <div className="pickText">{result.pick}</div>
                    <div className="pickSub">{active.match || cfg.label} · {cfg.label}</div>
                  </div>
                  <div className={badgeClass}>{result.confidence} edge</div>
                </div>

                <div className="metrics">
                  <div className="metric">
                    <div className="k">Expected home</div>
                    <div className="v">{num(result.expectedHome)}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Expected away</div>
                    <div className="v">{num(result.expectedAway)}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Expected total</div>
                    <div className="v">{num(result.expectedTotal)}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Best edge</div>
                    <div className="v">{result.edge.toFixed(1)}%</div>
                  </div>
                </div>

                <div className="details">
                  <div className="detailBox">
                    <h4>Model probabilities</h4>
                    <p>Over: {pct(result.modelOver)}</p>
                    <p>Under: {pct(result.modelUnder)}</p>
                    <p>Line: {active.line}</p>
                  </div>

                  <div className="detailBox">
                    <h4>Book fair probabilities</h4>
                    <p>Over: {pct(result.fairOver)}</p>
                    <p>Under: {pct(result.fairUnder)}</p>
                    <p>Odds: {active.overOdds} / {active.underOdds}</p>
                  </div>

                  <div className="detailBox">
                    <h4>Over edge</h4>
                    <p>{result.overEdge.toFixed(1)}%</p>
                    <p>Positive means model likes the over more than the market does.</p>
                  </div>

                  <div className="detailBox">
                    <h4>Under edge</h4>
                    <p>{result.underEdge.toFixed(1)}%</p>
                    <p>Positive means model likes the under more than the market does.</p>
                  </div>
                </div>

                <div className="note">
                  This is a rule-based scanner, not a guaranteed predictor. It is designed to be sensible and transparent: the app shows exactly how it reaches the total and how that compares with bookmaker pricing.
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
