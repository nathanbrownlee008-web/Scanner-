"use client";
import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "value-scanner-phase6-2";

const MARKET_CONFIG = {
  goals: { label: "Goals", emoji: "⚽", lineHint: "Usually 2.5, 3.5, 1.5 etc", forLabel: "Goals scored avg", againstLabel: "Goals conceded avg", typicalMin: 0, typicalMax: 3.5 },
  btts: { label: "BTTS", emoji: "✅", lineHint: "Use goal averages. Over odds = YES, Under odds = NO", forLabel: "Goals scored avg", againstLabel: "Goals conceded avg", typicalMin: 0, typicalMax: 3.5 },
  sot: { label: "Shots on Target", emoji: "🎯", lineHint: "Usually 7.5–9.5", forLabel: "SOT for avg", againstLabel: "SOT against avg", typicalMin: 2, typicalMax: 8 },
  team_sot: { label: "Team SOT", emoji: "🥅", lineHint: "Select home or away team target", forLabel: "Team SOT avg", againstLabel: "Opponent SOT conceded avg", typicalMin: 1, typicalMax: 6 },
  match_shots: { label: "Match Shots", emoji: "📈", lineHint: "Usually 20.5–28.5", forLabel: "Shots for avg", againstLabel: "Shots against avg", typicalMin: 6, typicalMax: 16 },
  team_shots: { label: "Team Shots", emoji: "💥", lineHint: "Select home or away team target", forLabel: "Team shots avg", againstLabel: "Opponent shots conceded avg", typicalMin: 3, typicalMax: 12 },
  corners: { label: "Corners", emoji: "🚩", lineHint: "Usually 8.5–10.5", forLabel: "Corners for avg", againstLabel: "Corners against avg", typicalMin: 3, typicalMax: 8 },
  cards: { label: "Cards", emoji: "🟨", lineHint: "Usually 3.5–5.5", forLabel: "Cards avg", againstLabel: "Cards against avg", typicalMin: 1, typicalMax: 4 },
};

const DEFAULTS = {
  goals: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "2.5", overOdds: "", underOdds: "" },
  btts: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "0.5", overOdds: "", underOdds: "" },
  sot: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "8.5", overOdds: "", underOdds: "" },
  team_sot: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "3.5", overOdds: "", underOdds: "" },
  match_shots: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "23.5", overOdds: "", underOdds: "" },
  team_shots: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "11.5", overOdds: "", underOdds: "" },
  corners: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "9.5", overOdds: "", underOdds: "" },
  cards: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "4.5", overOdds: "", underOdds: "" },
};

function parseNum(v){ const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function parseSeries(text){ return text.split(/[\n, ]+/).map(x=>x.trim()).filter(Boolean).map(Number).filter(Number.isFinite); }
function avg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

function parseScoreLine(text){
  return text
    .split(/[\n,]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(item => {
      const m = item.match(/(\d+)\s*[-:]\s*(\d+)/);
      if (!m) return null;
      return { home: Number(m[1]), away: Number(m[2]) };
    })
    .filter(Boolean);
}
let factCache = [0];
function logFactorial(n){ if (factCache[n] != null) return factCache[n]; let sum = factCache[factCache.length-1]; for(let i=factCache.length;i<=n;i++){ sum += Math.log(i); factCache[i]=sum; } return factCache[n];}
function poissonPmf(k, lambda){ if (lambda <= 0) return k===0?1:0; return Math.exp(-lambda + k*Math.log(lambda) - logFactorial(k));}
function poissonCdf(k, lambda){ if (k < 0) return 0; let sum=0; for(let i=0;i<=k;i++) sum += poissonPmf(i, lambda); return Math.min(1,sum);}
function probOverAsian(line, lambda){ const whole=Math.floor(line); const frac=+(line-whole).toFixed(2); if (Math.abs(frac-0.5)<0.01) return 1-poissonCdf(whole,lambda); if (Math.abs(frac-0.0)<0.01) return 1-poissonCdf(whole,lambda); if (Math.abs(frac-0.25)<0.01){const p1=1-poissonCdf(whole,lambda); const p2=1-poissonCdf(whole,lambda); return (p1+p2)/2;} if (Math.abs(frac-0.75)<0.01){const p1=1-poissonCdf(whole,lambda); const p2=1-poissonCdf(whole+1,lambda); return (p1+p2)/2;} return 1-poissonCdf(Math.floor(line),lambda);}
function fairProbsFromOdds(overOdds, underOdds){ const pO=1/overOdds; const pU=1/underOdds; const total=pO+pU; return { fairOver:pO/total, fairUnder:pU/total }; }
function edgeWidth(edge){ const clamped=Math.max(-10,Math.min(10,edge)); return Math.abs(clamped)*5; }

function isBttsMarket(m){ return m === "btts"; }
function isTeamMarket(m){ return m === "team_shots" || m === "team_sot"; }
function sideName(match, side){
  const bits = (match || "").split(/\s+vs\s+|\s+-\s+/i);
  if (bits.length >= 2) return side === "home" ? bits[0].trim() : bits[1].trim();
  return side === "home" ? "Home team" : "Away team";
}

function confidenceBarClass(label){
  if ((label||"").startsWith("VALUE BET")) return "conf-high";
  if ((label||"").startsWith("WAIT")) return "conf-mid";
  return "conf-low";
}

function getVarianceInfo(expected, line){
  const diff = Math.abs(expected - line);
  if(diff < 0.15){
    return {
      label: "High variance",
      text: "Very close to the line — the outcome can swing easily on one goal, card, or momentum shift. Value can still exist, but the bet is more volatile."
    };
  }
  if(diff < 0.35){
    return {
      label: "Medium variance",
      text: "Some separation from the line — there is still volatility, but it is more stable than a high-variance setup."
    };
  }
  return {
    label: "Low variance",
    text: "Clear gap from the line — the model has stronger separation from the market line, so the prediction is more stable."
  };
}
function trackerPoints(tracked){
  let running = 0;
  return tracked.slice().reverse().map((x, idx) => {
    if (x.result === "Won") running += ((Number(x.odds)-1) * Number(x.stake));
    else if (x.result === "Lost") running -= Number(x.stake);
    return { x: idx, y: running };
  });
}
function trackerGraphPath(points, width=320, height=90){
  if (!points.length) return "";
  const ys = points.map(p=>p.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const range = (maxY - minY) || 1;
  return points.map((p, i) => {
    const x = points.length === 1 ? width/2 : (p.x / (points.length-1)) * width;
    const y = height - ((p.y - minY) / range) * (height - 8) - 4;
    return `${i===0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}
function getRating(edge){
  if(edge >= 10) return "A+";
  if(edge >= 7) return "A";
  if(edge >= 5) return "B";
  if(edge >= 3) return "C";
  return "D";
}
function confFromEdge(edge){ if(edge>=8)return"Strong"; if(edge>=5)return"Good"; if(edge>=3)return"Lean"; return"Low"; }

function getStabilityInfo(expected, line, market){
  const diff = Math.abs(expected - line);
  let factor = 1;
  let label = "Stable";
  let text = "Good separation from the line, so the raw edge is more trustworthy.";

  if (diff < 0.12) {
    factor = 0.42;
    label = "Very volatile";
    text = "This is extremely close to the line, so a tiny swing can flip the result. Confidence is heavily reduced.";
  } else if (diff < 0.22) {
    factor = 0.58;
    label = "Volatile";
    text = "Still close to the line, so the raw edge is trimmed to stop fake high-confidence calls.";
  } else if (diff < 0.38) {
    factor = 0.74;
    label = "Moderate";
    text = "Some gap exists, but not enough to trust the full raw edge blindly.";
  } else if (diff < 0.55) {
    factor = 0.88;
    label = "Fair";
    text = "Decent gap from the line. Confidence is only trimmed slightly.";
  }

  if ((market === "goals" || market === "btts") && diff < 0.30) factor = Math.min(factor, 0.65);
  if ((market === "cards" || market === "corners") && diff < 0.25) factor = Math.min(factor, 0.72);
  if ((market === "team_shots" || market === "team_sot" || market === "match_shots") && diff < 0.45) factor = Math.min(factor, 0.82);

  return { factor, label, text };
}

function scoreFromAdjustedEdge(adjustedEdge, varianceLabel){
  let score = adjustedEdge / 1.9;
  if (varianceLabel === "High variance") score = Math.min(score, 6.0);
  if (varianceLabel === "Medium variance") score = Math.min(score, 7.6);
  if (varianceLabel === "Low variance") score = Math.min(score, 9.0);
  return Math.max(0, Math.min(10, score));
}

function probabilityExplanation(modelOver, modelUnder, line, expectedTotal){
  const overPct = (modelOver * 100).toFixed(1);
  const underPct = (modelUnder * 100).toFixed(1);
  const diff = Math.abs(expectedTotal - line);
  let varianceLabel = "Low variance";
  let varianceText = "Clear gap from the line — more stable prediction, stronger confidence in the edge.";
  if (diff < 0.15) {
    varianceLabel = "High variance";
    varianceText = "Very close to the line — outcome can swing easily, even if value exists.";
  } else if (diff < 0.35) {
    varianceLabel = "Medium variance";
    varianceText = "Some separation from the line — still some volatility, but more stable than high variance.";
  }
  return {
    summary: `Based on the averages entered, the model estimates the top side lands ${overPct}% of the time and the lower side lands ${underPct}% of the time.`,
    reasoning:
      expectedTotal > line
        ? `The expected total sits above the line, which pushes probability toward the OVER side.`
        : expectedTotal < line
        ? `The expected total sits below the line, which pushes probability toward the UNDER side.`
        : `The expected total is right on the line, so this is a very fine-margin spot.`,
    varianceLabel,
    varianceText
  };
}

function analyseRow(row, settings){
  const homeFor=parseNum(row.homeFor), homeAgainst=parseNum(row.homeAgainst), awayFor=parseNum(row.awayFor), awayAgainst=parseNum(row.awayAgainst), line=parseNum(row.line), overOdds=parseNum(row.overOdds), underOdds=parseNum(row.underOdds), market=row.market, teamSide=row.teamSide || "home";
  if ([homeFor,homeAgainst,awayFor,awayAgainst,line,overOdds,underOdds].some(v=>v==null||v<=0)) return null;

  const baseHome=(homeFor+awayAgainst)/2, baseAway=(awayFor+homeAgainst)/2;
  const homeBoost=settings.homeAwayBoost?1.04:1, awayBoost=settings.homeAwayBoost?0.98:1;
  let expectedHome=baseHome*homeBoost, expectedAway=baseAway*awayBoost, expectedTotal=expectedHome+expectedAway;

  const marketAdjust={goals:1.0,btts:1.0,sot:1.0,team_sot:1.0,match_shots:1.06,team_shots:1.06,corners:1.03,cards:1.02};
  expectedTotal*=marketAdjust[market]||1;
  expectedHome*=marketAdjust[market]||1;
  expectedAway*=marketAdjust[market]||1;

  if (settings.knockoutMode && (market==="goals"||market==="sot"||market==="match_shots"||market==="team_shots"||market==="team_sot")) expectedTotal*=0.96;
  if (settings.knockoutMode && market==="cards") expectedTotal*=1.03;

  const {fairOver,fairUnder}=fairProbsFromOdds(overOdds,underOdds);

  let modelOver=0, modelUnder=0, overEdge=0, underEdge=0;
  let fairOverOdds=0, fairUnderOdds=0, suggestedOverOdds=0, suggestedUnderOdds=0;
  let side="skip", pick="SKIP", edge=0, actionLabel="NO VALUE – AVOID", targetOdds=null, guideTitle="Avoid at current odds";
  let labelOver="Over", labelUnder="Under", trueLine=expectedTotal;
  const threshold=settings.edgeThreshold;
  const waitThreshold=Math.max(0.5, threshold*0.5);

  if (isBttsMarket(market)) {
    labelOver="BTTS YES";
    labelUnder="BTTS NO";
    const pHomeScore = 1 - poissonPmf(0, expectedHome);
    const pAwayScore = 1 - poissonPmf(0, expectedAway);
    modelOver = pHomeScore * pAwayScore;
    modelUnder = 1 - modelOver;
    overEdge=(modelOver-fairOver)*100;
    underEdge=(modelUnder-fairUnder)*100;
    if(overEdge>threshold&&overEdge>underEdge){
      side="over"; pick="BTTS YES"; edge=overEdge; fairOverOdds=modelOver>0?1/modelOver:0; suggestedOverOdds=fairOverOdds*settings.suggestedMultiplier; targetOdds=suggestedOverOdds;
      actionLabel=`VALUE BET – TAKE BTTS YES NOW`; guideTitle=`Current odds are already good enough for BTTS YES.`;
    } else if(underEdge>threshold&&underEdge>overEdge){
      side="under"; pick="BTTS NO"; edge=underEdge; fairUnderOdds=modelUnder>0?1/modelUnder:0; suggestedUnderOdds=fairUnderOdds*settings.suggestedMultiplier; targetOdds=suggestedUnderOdds;
      actionLabel=`VALUE BET – TAKE BTTS NO NOW`; guideTitle=`Current odds are already good enough for BTTS NO.`;
    } else if (Math.max(overEdge, underEdge) > waitThreshold) {
      if (overEdge >= underEdge) {
        fairOverOdds=modelOver>0?1/modelOver:0; suggestedOverOdds=fairOverOdds*settings.suggestedMultiplier; targetOdds=suggestedOverOdds;
        actionLabel=`WAIT – BET BTTS YES IF ODDS REACH ${suggestedOverOdds.toFixed(2)}+`;
        guideTitle=`Close on BTTS YES, but the current price is still too low.`;
      } else {
        fairUnderOdds=modelUnder>0?1/modelUnder:0; suggestedUnderOdds=fairUnderOdds*settings.suggestedMultiplier; targetOdds=suggestedUnderOdds;
        actionLabel=`WAIT – BET BTTS NO IF ODDS REACH ${suggestedUnderOdds.toFixed(2)}+`;
        guideTitle=`Close on BTTS NO, but the current price is still too low.`;
      }
    }
    trueLine = expectedTotal;
  } else if (isTeamMarket(market)) {
    const selectedExpected = teamSide === "home" ? expectedHome : expectedAway;
    modelOver = probOverAsian(line, selectedExpected);
    modelUnder = 1-modelOver;
    overEdge=(modelOver-fairOver)*100;
    underEdge=(modelUnder-fairUnder)*100;
    fairOverOdds=modelOver>0?1/modelOver:0;
    fairUnderOdds=modelUnder>0?1/modelUnder:0;
    suggestedOverOdds=fairOverOdds*settings.suggestedMultiplier;
    suggestedUnderOdds=fairUnderOdds*settings.suggestedMultiplier;
    const team = sideName(row.match, teamSide);
    labelOver = `${team} Over`;
    labelUnder = `${team} Under`;
    if(overEdge>threshold&&overEdge>underEdge){
      side="over"; pick=`${team} OVER ${line}`; edge=overEdge; targetOdds=suggestedOverOdds;
      actionLabel=`VALUE BET – TAKE ${team.toUpperCase()} OVER ${line} NOW`; guideTitle=`Current odds are already good enough for ${team} over ${line}.`;
    } else if(underEdge>threshold&&underEdge>overEdge){
      side="under"; pick=`${team} UNDER ${line}`; edge=underEdge; targetOdds=suggestedUnderOdds;
      actionLabel=`VALUE BET – TAKE ${team.toUpperCase()} UNDER ${line} NOW`; guideTitle=`Current odds are already good enough for ${team} under ${line}.`;
    } else if (Math.max(overEdge, underEdge) > waitThreshold) {
      if (overEdge >= underEdge) {
        targetOdds=suggestedOverOdds;
        actionLabel=`WAIT – BET ${team.toUpperCase()} OVER ${line} IF ODDS REACH ${suggestedOverOdds.toFixed(2)}+`;
        guideTitle=`Close on ${team} over ${line}, but the current price is still too low.`;
      } else {
        targetOdds=suggestedUnderOdds;
        actionLabel=`WAIT – BET ${team.toUpperCase()} UNDER ${line} IF ODDS REACH ${suggestedUnderOdds.toFixed(2)}+`;
        guideTitle=`Close on ${team} under ${line}, but the current price is still too low.`;
      }
    }
    trueLine = selectedExpected;
  } else {
    modelOver=probOverAsian(line,expectedTotal);
    modelUnder=1-modelOver;
    overEdge=(modelOver-fairOver)*100;
    underEdge=(modelUnder-fairUnder)*100;
    fairOverOdds=modelOver>0?1/modelOver:0;
    fairUnderOdds=modelUnder>0?1/modelUnder:0;
    suggestedOverOdds=fairOverOdds*settings.suggestedMultiplier;
    suggestedUnderOdds=fairUnderOdds*settings.suggestedMultiplier;
    if(overEdge>threshold&&overEdge>underEdge){
      side="over";pick=`OVER ${line}`;edge=overEdge; targetOdds=suggestedOverOdds;
      actionLabel=`VALUE BET – TAKE OVER ${line} NOW`; guideTitle=`Current odds are already good enough for OVER ${line}.`;
    } else if(underEdge>threshold&&underEdge>overEdge){
      side="under";pick=`UNDER ${line}`;edge=underEdge; targetOdds=suggestedUnderOdds;
      actionLabel=`VALUE BET – TAKE UNDER ${line} NOW`; guideTitle=`Current odds are already good enough for UNDER ${line}.`;
    } else if (Math.max(overEdge, underEdge) > waitThreshold) {
      if (overEdge >= underEdge) {
        targetOdds=suggestedOverOdds;
        actionLabel=`WAIT – BET OVER ${line} IF ODDS REACH ${suggestedOverOdds.toFixed(2)}+ (IN-PLAY / DRIFT)`;
        guideTitle=`Close on OVER ${line}, but the current price is still too low.`;
      } else {
        targetOdds=suggestedUnderOdds;
        actionLabel=`WAIT – BET UNDER ${line} IF ODDS REACH ${suggestedUnderOdds.toFixed(2)}+ (IN-PLAY / DRIFT)`;
        guideTitle=`Close on UNDER ${line}, but the current price is still too low.`;
      }
    }
    trueLine = expectedTotal;
  }

  const varianceBase = isTeamMarket(market)?trueLine:expectedTotal;
  const varianceInfo = getVarianceInfo(varianceBase, line);
  const stabilityInfo = getStabilityInfo(varianceBase, line, market);
  const adjustedEdge = edge * stabilityInfo.factor;
  const confidence = confFromEdge(adjustedEdge);
  const confidenceScore = scoreFromAdjustedEdge(adjustedEdge, varianceInfo.label);
  const probInfo = probabilityExplanation(modelOver, modelUnder, line, varianceBase);
  const explanation =
    isBttsMarket(market)
      ? side==="over"
        ? `The market is underestimating the chance of both teams scoring. BTTS YES is the value side at the current price.`
        : side==="under"
        ? `The market is overestimating both teams scoring. BTTS NO is the value side at the current price.`
        : actionLabel.startsWith("WAIT")
        ? `Do not bet BTTS yet. You only enter if the price improves to your target odds.`
        : `No clear BTTS edge at the current odds.`
      : isTeamMarket(market)
      ? side==="over"
        ? `The selected team projects above the line more often than the odds suggest, so the OVER side has value.`
        : side==="under"
        ? `The selected team projects below the line more often than the odds suggest, so the UNDER side has value.`
        : actionLabel.startsWith("WAIT")
        ? `Do not bet this team market yet. You only enter if the price improves to your target odds.`
        : `No clear team-market edge at the current odds.`
      : side==="over"
      ? `The bookmaker is favouring the UNDER side too much based on the current odds. Based on the data entered, this game has a better chance of going OVER ${line} than the market suggests, which is why OVER is the value side here.`
      : side==="under"
      ? `The bookmaker is favouring the OVER side too much compared with its true probability. Based on the data entered, this game is more likely to stay UNDER ${line} than the market suggests, which is why UNDER is the value side here.`
      : actionLabel.startsWith("WAIT")
      ? `Do not bet yet. The side is close, but you only enter if the price improves to your target odds and the game state still suits the pick.`
      : `No value at the current odds. Avoid forcing a bet here.`;

  return {...row, expectedHome, expectedAway, expectedTotal, modelOver, modelUnder, fairOver, fairUnder, overEdge, underEdge, side, pick, edge, actionLabel, targetOdds, guideTitle, confidence, fairOverOdds, fairUnderOdds, suggestedOverOdds, suggestedUnderOdds, trueLine, confidenceScore, varianceInfo, probInfo, explanation, labelOver, labelUnder, teamSide};
}
const pct=v=>`${(v*100).toFixed(1)}%`; const num=v=>Number(v).toFixed(2);

export default function App(){
  const [activeTab,setActiveTab]=useState("scanner");
  const [market,setMarket]=useState("goals");
  const [forms,setForms]=useState(DEFAULTS);
  const [bulkText,setBulkText]=useState("");
  const [rows,setRows]=useState([]);
  const [tracked,setTracked]=useState([]);
  const [settings,setSettings]=useState({edgeThreshold:3,suggestedMultiplier:1.05,homeAwayBoost:true,knockoutMode:false,stakeStrong:3,stakeGood:2,stakeLean:1});
  const [avgCalc,setAvgCalc]=useState({match:"", market:"goals", mode:"split", homeForSeries:"", homeAgainstSeries:"", awayForSeries:"", awayAgainstSeries:""});
  const [avgBulkText,setAvgBulkText]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [teamSide,setTeamSide]=useState("home");
  const [installPromptEvent,setInstallPromptEvent]=useState(null);
  const [installReady,setInstallReady]=useState(false);
  const [installMsg,setInstallMsg]=useState("");

  useEffect(()=>{ try{ const raw=localStorage.getItem(STORAGE_KEY); if(raw){ const d=JSON.parse(raw); if(d.forms)setForms(d.forms); if(d.bulkText!==undefined)setBulkText(d.bulkText); if(d.rows)setRows(d.rows); if(d.tracked)setTracked(d.tracked); if(d.settings)setSettings(d.settings); if(d.market)setMarket(d.market); if(d.avgCalc)setAvgCalc(d.avgCalc); if(d.avgBulkText!==undefined)setAvgBulkText(d.avgBulkText); if(d.teamSide)setTeamSide(d.teamSide);} }catch(e){} setLoaded(true); },[]);
  useEffect(()=>{ if(!loaded)return; try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({forms,bulkText,rows,tracked,settings,market,avgCalc,avgBulkText,teamSide})); }catch(e){} },[forms,bulkText,rows,tracked,settings,market,avgCalc,avgBulkText,teamSide,loaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    if (isStandalone) {
      setInstallMsg("Installed");
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }

    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
      setInstallReady(true);
      setInstallMsg("Install ready");
    };

    const onAppInstalled = () => {
      setInstallReady(false);
      setInstallPromptEvent(null);
      setInstallMsg("Installed");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstallApp(){
    if (!installPromptEvent) {
      setInstallMsg("Use Chrome menu → Add to Home screen");
      return;
    }
    installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      setInstallMsg("Installing…");
    } else {
      setInstallMsg("Install cancelled");
    }
    setInstallPromptEvent(null);
    setInstallReady(false);
  }

  const active=forms[market]; const cfg=MARKET_CONFIG[market]; const avgCfg=MARKET_CONFIG[avgCalc.market];
  const singleResult=useMemo(()=>analyseRow({...active, market, teamSide}, settings),[active,market,settings,teamSide]);
  const analysedRows=useMemo(()=>rows.map(r=>analyseRow(r,settings)).filter(Boolean).sort((a,b)=>b.edge-a.edge),[rows,settings]);
  const strongCount=analysedRows.filter(r=>r.confidence==="Strong").length; const bestRow=analysedRows[0]||null;
  const trackerStats=useMemo(()=>{ const settled=tracked.filter(x=>x.result!=="Pending"); const wins=settled.filter(x=>x.result==="Won").length; const losses=settled.filter(x=>x.result==="Lost").length; const totalBets=wins+losses; const pending=tracked.filter(x=>x.result==="Pending").length; const profit=settled.reduce((sum,x)=> x.result==="Won" ? sum+((Number(x.odds)-1)*Number(x.stake)) : x.result==="Lost" ? sum-Number(x.stake) : sum ,0); const stake=settled.filter(x=>x.result!=="Void").reduce((sum,x)=>sum+Number(x.stake),0); const roi=stake>0?(profit/stake)*100:0; const winrate=(wins+losses)>0?(wins/(wins+losses))*100:0; return {settled: settled.length, profit, roi, winrate, wins, losses, totalBets, pending}; },[tracked]);

  const graphPoints=useMemo(()=>trackerPoints(tracked),[tracked]); const graphPath=useMemo(()=>trackerGraphPath(graphPoints),[graphPoints]);

  const avgResult=useMemo(()=>{
    const hf=parseSeries(avgCalc.homeForSeries), ha=parseSeries(avgCalc.homeAgainstSeries), af=parseSeries(avgCalc.awayForSeries), aa=parseSeries(avgCalc.awayAgainstSeries);
    return { homeForAvg:avg(hf), homeAgainstAvg:avg(ha), awayForAvg:avg(af), awayAgainstAvg:avg(aa), homeForCount:hf.length, homeAgainstCount:ha.length, awayForCount:af.length, awayAgainstCount:aa.length };
  },[avgCalc]);

  const likelyMarket=useMemo(()=>{
    const vals=[avgResult.homeForAvg, avgResult.homeAgainstAvg, avgResult.awayForAvg, avgResult.awayAgainstAvg].filter(v=>v>0);
    if(!vals.length) return null;
    const totalAvg = avg(vals);
    if (totalAvg <= 3.5) return "goals";
    if (totalAvg <= 4.5) return "cards";
    if (totalAvg <= 8) return "corners";
    return "sot";
  },[avgResult]);

  const marketMismatch = likelyMarket && likelyMarket !== avgCalc.market;

  function update(field,value){ setForms(prev=>({...prev,[market]:{...prev[market],[field]:value}})); }
  function loadAverageToScanner(){
    setMarket(avgCalc.market);
    setForms(prev=>({...prev,[avgCalc.market]:{...prev[avgCalc.market], match:avgCalc.match||prev[avgCalc.market].match, homeFor:avgResult.homeForAvg?avgResult.homeForAvg.toFixed(2):prev[avgCalc.market].homeFor, homeAgainst:avgResult.homeAgainstAvg?avgResult.homeAgainstAvg.toFixed(2):prev[avgCalc.market].homeAgainst, awayFor:avgResult.awayForAvg?avgResult.awayForAvg.toFixed(2):prev[avgCalc.market].awayFor, awayAgainst:avgResult.awayAgainstAvg?avgResult.awayAgainstAvg.toFixed(2):prev[avgCalc.market].awayAgainst }}));
    setActiveTab("scanner");
  }

  function importAverageBulk(){
    const lines = avgBulkText.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    if(lines.length < 2) return;

    let matchName = "";
    let homeLine = "";
    let awayLine = "";

    if(lines.length >= 3){
      matchName = lines[0];
      homeLine = lines[1];
      awayLine = lines[2];
    } else {
      homeLine = lines[0];
      awayLine = lines[1];
    }

    const homeScores = parseScoreLine(homeLine);
    const awayScores = parseScoreLine(awayLine);
    if(!homeScores.length || !awayScores.length) return;

    setAvgCalc(prev => ({
      ...prev,
      match: matchName || prev.match,
      homeForSeries: homeScores.map(x=>x.home).join(","),
      homeAgainstSeries: homeScores.map(x=>x.away).join(","),
      awayForSeries: awayScores.map(x=>x.away).join(","),
      awayAgainstSeries: awayScores.map(x=>x.home).join(",")
    }));
  }

  function addSingleToScanner(){ setRows(prev=>[{...active, market, teamSide, id:`${Date.now()}-single`},...prev]); }
  function importBulk(){ const parsed = bulkText.split("\n").map(x=>x.trim()).filter(Boolean).map((line,idx)=>{ const p=line.split(",").map(x=>x.trim()); if(p.length<9)return null; return {id:`${Date.now()}-${idx}`,match:p[0],market:p[1],homeFor:p[2],homeAgainst:p[3],awayFor:p[4],awayAgainst:p[5],line:p[6],overOdds:p[7],underOdds:p[8],teamSide:p[9]||"home"}; }).filter(Boolean); setRows(parsed); }
  function addScannerRowToTracker(row){ const stake=row.confidence==="Strong"?settings.stakeStrong:row.confidence==="Good"?settings.stakeGood:settings.stakeLean; const odds=(row.side==="over"||row.side==="yes")?row.overOdds:row.underOdds; setTracked(prev=>[{id:`${Date.now()}-${row.id}`,match:row.match,market:MARKET_CONFIG[row.market]?.label||row.market,pick:row.pick,confidence:row.confidence,edge:row.edge,odds,stake,result:"Pending"},...prev]); setActiveTab("tracker"); }
  function addToTrackerFromResult(result){ if(!result||result.side==="skip")return; const stake=result.confidence==="Strong"?settings.stakeStrong:result.confidence==="Good"?settings.stakeGood:settings.stakeLean; const odds=(result.side==="over"||result.side==="yes")?active.overOdds:active.underOdds; setTracked(prev=>[{id:`${Date.now()}`,match:active.match||`${cfg.label} bet`,market:cfg.label,pick:result.pick,confidence:result.confidence,edge:result.edge,odds,stake,result:"Pending"},...prev]); setActiveTab("tracker"); }
  function updateTracked(id,field,value){ setTracked(prev=>prev.map(x=>x.id===id?{...x,[field]:value}:x)); }
  function clearSaved(){ try{localStorage.removeItem(STORAGE_KEY)}catch(e){} setForms(DEFAULTS); setBulkText(""); setRows([]); setTracked([]); setAvgCalc({match:"",market:"goals",mode:"split",homeForSeries:"",homeAgainstSeries:"",awayForSeries:"",awayAgainstSeries:""}); setAvgBulkText(""); setSettings({edgeThreshold:3,suggestedMultiplier:1.05,homeAwayBoost:true,knockoutMode:false,stakeStrong:3,stakeGood:2,stakeLean:1}); }
  function badgeClass(conf){ if(conf==="Strong"||conf==="Good") return "badge green"; if(conf==="Lean") return "badge amber"; return "badge red"; }

  return (
    <main className="page"><div className="shell">
      <div className="topTabs">
        <button className={`topTab ${activeTab==="scanner"?"active":""}`} onClick={()=>setActiveTab("scanner")}>Scanner</button>
        <button className={`topTab ${activeTab==="averages"?"active":""}`} onClick={()=>setActiveTab("averages")}>Averages</button>
        <button className={`topTab ${activeTab==="best"?"active":""}`} onClick={()=>setActiveTab("best")}>Best Bets</button>
        <button className={`topTab ${activeTab==="tracker"?"active":""}`} onClick={()=>setActiveTab("tracker")}>Tracker</button>
        <button className={`topTab ${activeTab==="settings"?"active":""}`} onClick={()=>setActiveTab("settings")}>Settings</button>
      </div>

      <section className="hero">
        <div className="heroCard">
          <div className="titleRow"><div className="logo">🔥</div><div><div className="title">Value Scanner Phase 6.2</div><div className="subtitle">Easier to understand. The Averages tab now tells you exactly whether to use home-only or away-only numbers.</div></div></div>
          <div className="pillRow">
            <div className="pill active">Home-only / away-only guidance</div>
            <div className="pill">Market-aware averages</div>
            <div className="pill">Auto switch scanner</div>
            <button className={`pill ${installReady ? "active" : ""}`} onClick={handleInstallApp}>
              {installReady ? "Install TDT Scanner" : "Add to Home Screen"}
            </button>
          </div>
          {installMsg ? <div className="small" style={{marginTop:8}}>{installMsg}</div> : null}
        </div>
        <div className="helpCard">
          <h3 style={{marginTop:0}}>Correct method</h3>
          <div className="small">
            Home team = last 5 <strong>home</strong> games only.<br/>
            Away team = last 5 <strong>away</strong> games only.<br/>
            Do not mix them.
          </div>
        </div>
      </section>

      <section className="dashboardGrid">
        <div className="kpi"><div className="k">Scanned rows</div><div className="v">{analysedRows.length}</div><div className="s">Saved on this browser</div></div>
        <div className="kpi"><div className="k">Strong bets</div><div className="v">{strongCount}</div><div className="s">High priority</div></div>
        <div className="kpi"><div className="k">Tracker bets</div><div className="v">{tracked.length}</div><div className="s">Saved after refresh</div></div>
        <div className="kpi"><div className="k">Best edge</div><div className="v">{bestRow ? `${(bestRow.adjustedEdge ?? bestRow.edge).toFixed(1)}%` : "-"}</div><div className="s">{bestRow ? bestRow.match : "No rows yet"}</div></div>
      </section>

      {activeTab==="averages" && (
        <section className="avgGrid">
          <div className="card">
            <h2 className="sectionTitle">Averages calculator</h2>
            <p className="sectionSub">Choose the market first, then paste recent match numbers.</p>

            <div className="marketTabs">
              {Object.entries(MARKET_CONFIG).map(([k,item])=>(
                <button key={k} className={`marketTab ${avgCalc.market===k?"active":""}`} onClick={()=>setAvgCalc(s=>({...s, market:k}))}>
                  {item.emoji} {item.label}
                </button>
              ))}
            </div>

            <div className="pillRow">
              <button className={`pill ${avgCalc.mode==="split"?"active":""}`} onClick={()=>setAvgCalc(s=>({...s, mode:"split"}))}>Recommended: split home/away</button>
              <button className={`pill ${avgCalc.mode==="mixed"?"active":""}`} onClick={()=>setAvgCalc(s=>({...s, mode:"mixed"}))}>Quick mode: mixed last 5</button>
            </div>

            {avgCalc.mode === "split" ? (
              <div className="rulebox">
                <strong>Use this:</strong><br/>
                Home team stats = last 5 <strong>home</strong> games only.<br/>
                Away team stats = last 5 <strong>away</strong> games only.
              </div>
            ) : (
              <div className="warn">
                Quick mode mixes home and away games together. It is faster, but less accurate.
              </div>
            )}


            <div className="card" style={{padding:12, marginTop:12, marginBottom:12}}>
              <h3 className="sectionTitle" style={{fontSize:18, marginBottom:6}}>Bulk paste scores</h3>
              <p className="sectionSub">Paste one block instead of filling all 4 boxes manually.</p>
              <textarea
                className="textarea"
                value={avgBulkText}
                onChange={(e)=>setAvgBulkText(e.target.value)}
                placeholder={"Match name (optional)\n2-0,2-0,1-1,0-1,0-1\n3-0,1-4,2-1,1-1,4-1"}
              />
              <div className="inlineWarn">
                Line 2 = home team HOME scorelines. Line 3 = away team AWAY scorelines. The app will auto-fill the 4 series boxes below.
              </div>
              <div className="actions">
                <button className="btn secondary" onClick={importAverageBulk}>Import bulk scores into 4 boxes</button>
              </div>
            </div>

            <div className="formGrid">
              <div className="field full">
                <label>Match name</label>
                <input className="input" value={avgCalc.match} onChange={(e)=>setAvgCalc(s=>({...s, match:e.target.value}))} placeholder="Bologna vs Aston Villa" />
              </div>
              <div className="field">
                <label>{avgCalc.mode==="split" ? `Home team ${avgCfg.forLabel} series (HOME games only)` : `Home team ${avgCfg.forLabel} series (mixed games)`}</label>
                <textarea className="textarea" value={avgCalc.homeForSeries} onChange={(e)=>setAvgCalc(s=>({...s, homeForSeries:e.target.value}))} placeholder="4,5,3,6,4" />
              </div>
              <div className="field">
                <label>{avgCalc.mode==="split" ? `Home team ${avgCfg.againstLabel} series (HOME games only)` : `Home team ${avgCfg.againstLabel} series (mixed games)`}</label>
                <textarea className="textarea" value={avgCalc.homeAgainstSeries} onChange={(e)=>setAvgCalc(s=>({...s, homeAgainstSeries:e.target.value}))} placeholder="3,4,4,2,5" />
              </div>
              <div className="field">
                <label>{avgCalc.mode==="split" ? `Away team ${avgCfg.forLabel} series (AWAY games only)` : `Away team ${avgCfg.forLabel} series (mixed games)`}</label>
                <textarea className="textarea" value={avgCalc.awayForSeries} onChange={(e)=>setAvgCalc(s=>({...s, awayForSeries:e.target.value}))} placeholder="5,3,4,6,5" />
              </div>
              <div className="field">
                <label>{avgCalc.mode==="split" ? `Away team ${avgCfg.againstLabel} series (AWAY games only)` : `Away team ${avgCfg.againstLabel} series (mixed games)`}</label>
                <textarea className="textarea" value={avgCalc.awayAgainstSeries} onChange={(e)=>setAvgCalc(s=>({...s, awayAgainstSeries:e.target.value}))} placeholder="4,5,3,4,4" />
              </div>
            </div>

            {marketMismatch ? (
              <div className="warn">
                These averages look more like <strong>{MARKET_CONFIG[likelyMarket].label}</strong> than <strong>{MARKET_CONFIG[avgCalc.market].label}</strong>. Double-check the market you selected.
              </div>
            ) : likelyMarket ? (
              <div className="goodbox">
                Selected market: <strong>{MARKET_CONFIG[avgCalc.market].label}</strong>. Likely market from number size: <strong>{MARKET_CONFIG[likelyMarket].label}</strong>.
              </div>
            ) : null}

            <div className="actions">
              <button className="btn primary" onClick={loadAverageToScanner}>Use averages in scanner</button>
            </div>
          </div>

          <div className="avgBox">
            <h2 className="sectionTitle">Calculated averages</h2>
            <div className="avgList">
              <div className="avgStat"><div className="k">Home for avg</div><div className="v">{num(avgResult.homeForAvg)}</div><div className="small">{avgResult.homeForCount} games</div></div>
              <div className="avgStat"><div className="k">Home against avg</div><div className="v">{num(avgResult.homeAgainstAvg)}</div><div className="small">{avgResult.homeAgainstCount} games</div></div>
              <div className="avgStat"><div className="k">Away for avg</div><div className="v">{num(avgResult.awayForAvg)}</div><div className="small">{avgResult.awayForCount} games</div></div>
              <div className="avgStat"><div className="k">Away against avg</div><div className="v">{num(avgResult.awayAgainstAvg)}</div><div className="small">{avgResult.awayAgainstCount} games</div></div>
            </div>
            <div className="decision" style={{marginTop:16}}>
              <div className="decisionText good">Ready for {MARKET_CONFIG[avgCalc.market].label}</div>
              <div className="small">Scanner will auto switch to this market when you tap the button.</div>
            </div>
          </div>
        </section>
      )}

      {activeTab==="scanner" && (
        <section className="mainGrid">
          <div className="card">
            <div className="marketTabs">
              {Object.entries(MARKET_CONFIG).map(([k,item])=>(
                <button key={k} className={`marketTab ${market===k?"active":""}`} onClick={()=>setMarket(k)}>
                  {item.emoji} {item.label}
                </button>
              ))}
            </div>
            {isTeamMarket(market) && (
              <div className="pillRow" style={{marginTop:0}}>
                <button className={`pill ${teamSide==="home"?"active":""}`} onClick={()=>setTeamSide("home")}>Target: Home team</button>
                <button className={`pill ${teamSide==="away"?"active":""}`} onClick={()=>setTeamSide("away")}>Target: Away team</button>
              </div>
            )}
            <h2 className="sectionTitle">{cfg.label} scanner</h2>
            <p className="sectionSub">{cfg.lineHint}</p>
            <div className="formGrid">
              <div className="field full"><label>Match</label><input className="input" value={active.match} onChange={(e)=>update("match", e.target.value)} /></div>
              <div className="field"><label>Home {cfg.forLabel}</label><input className="input" value={active.homeFor} onChange={(e)=>update("homeFor", e.target.value)} /></div>
              <div className="field"><label>Home {cfg.againstLabel}</label><input className="input" value={active.homeAgainst} onChange={(e)=>update("homeAgainst", e.target.value)} /></div>
              <div className="field"><label>Away {cfg.forLabel}</label><input className="input" value={active.awayFor} onChange={(e)=>update("awayFor", e.target.value)} /></div>
              <div className="field"><label>Away {cfg.againstLabel}</label><input className="input" value={active.awayAgainst} onChange={(e)=>update("awayAgainst", e.target.value)} /></div>
              <div className="field"><label>{market==="btts"?"Line (use 0.5)":isTeamMarket(market)?"Team line":"Line"}</label><input className="input" value={active.line} onChange={(e)=>update("line", e.target.value)} /></div>
              <div className="field"><label>{market==="btts"?"Yes odds":"Over odds"}</label><input className="input" value={active.overOdds} onChange={(e)=>update("overOdds", e.target.value)} /></div>
              <div className="field"><label>{market==="btts"?"No odds":"Under odds"}</label><input className="input" value={active.underOdds} onChange={(e)=>update("underOdds", e.target.value)} /></div>
            </div>
            <div className="actions">
              <button className="btn primary" onClick={addSingleToScanner}>Add to scanner</button>
              <button className="btn secondary" onClick={()=>singleResult&&addToTrackerFromResult(singleResult)}>Add to tracker</button>
            </div>
            <details className="bulkBox">
              <summary><span>Bulk scanner</span><span className="small">Tap to open / close</span></summary>
              <div className="bulkInner">
                <p className="sectionSub">Format: match,market,homeFor,homeAgainst,awayFor,awayAgainst,line,overOdds,underOdds[,teamSide]</p>
                <textarea className="textarea" value={bulkText} onChange={(e)=>setBulkText(e.target.value)} />
                <div className="actions"><button className="btn primary" onClick={importBulk}>Import rows</button></div>
              </div>
            </details>
          </div>

          <div className="card">
            {!singleResult ? <><h2 className="sectionTitle">Result</h2><p className="sectionSub">Use Averages first, then add line and odds.</p></> : <>
              <div className="pickHeader">
                <div><div className="pickName">{singleResult.pick}</div><div className="small">{active.match || cfg.label} · {cfg.label}</div></div>
                <div className={badgeClass(singleResult.confidence)}>{singleResult.confidence}</div>
              </div>
              <div className="resultMetrics">
                <div className="metric"><div className="k">Expected total</div><div className="v">{num(singleResult.expectedTotal)}</div></div>
                <div className="metric"><div className="k">True line</div><div className="v">{num(singleResult.trueLine)}</div></div>
                <div className="metric"><div className="k">Edge</div><div className="v">{(singleResult.adjustedEdge ?? singleResult.edge).toFixed(1)}%</div></div>
                <div className="metric"><div className="k">Confidence</div><div className="v">{singleResult.confidenceScore.toFixed(1)}/10</div></div>
                <div className="metric"><div className="k">Rating</div><div className="v">{getRating(singleResult.adjustedEdge ?? singleResult.edge)}</div></div>
              </div>
              <div className="resultGrid">
                <div className="detail"><h4>Model probabilities</h4><p>{singleResult.labelOver}: {pct(singleResult.modelOver)}</p><p>{singleResult.labelUnder}: {pct(singleResult.modelUnder)}</p></div>
                <div className="detail"><h4>Book fair probabilities</h4><p>{singleResult.labelOver}: {pct(singleResult.fairOver)}</p><p>{singleResult.labelUnder}: {pct(singleResult.fairUnder)}</p></div>
                <div className={`detail ${singleResult.side==="over"?"":"dim"}`}><h4>{singleResult.labelOver} fair / suggested</h4><p>Fair odds: {num(singleResult.fairOverOdds)}</p><p>Suggested odds: {num(singleResult.suggestedOverOdds)}</p></div>
                <div className={`detail ${singleResult.side==="under"?"":"dim"}`}><h4>{singleResult.labelUnder} fair / suggested</h4><p>Fair odds: {num(singleResult.fairUnderOdds)}</p><p>Suggested odds: {num(singleResult.suggestedUnderOdds)}</p></div>
              </div>
              <div className="edgeMeter">
                <div className="edgeBar">
                  <div className="edgeCenter"></div>
                  {singleResult.overEdge > 0 && <div className={`edgeFill over ${confidenceBarClass(singleResult.actionLabel)}`} style={{width: edgeWidth(singleResult.overEdge) + "%"}}></div>}
                  {singleResult.underEdge > 0 && <div className={`edgeFill under ${confidenceBarClass(singleResult.actionLabel)}`} style={{width: edgeWidth(singleResult.underEdge) + "%"}}></div>}
                </div>
                <div className="edgeLabels"><span>{singleResult.labelUnder.toUpperCase()}</span><span>{singleResult.labelOver.toUpperCase()}</span></div>
              </div>
              <div className="decision">
                <div className={`decisionText ${singleResult.actionLabel.startsWith("VALUE BET")?"strong":singleResult.actionLabel.startsWith("WAIT")?"lean":"skip"}`}>
                  {singleResult.actionLabel}
                </div>
                <div className="small">{singleResult.explanation}</div>
              </div>
              <div className="detail" style={{marginTop:12}}>
                <h4>Probability view</h4>
                <p>{singleResult.probInfo?.summary}</p>
                <p>{singleResult.probInfo?.reasoning}</p>
                <p><strong>{singleResult.probInfo?.varianceLabel}</strong> — {singleResult.probInfo?.varianceText}</p>
                <p><strong>Stability filter</strong> — {singleResult.stabilityInfo?.label}: {singleResult.stabilityInfo?.text}</p>
              </div>
              <div className="detail" style={{marginTop:12}}>
                <h4>Entry guide</h4>
                <p>{singleResult.guideTitle}</p>
                {singleResult.actionLabel.startsWith("WAIT") ? (
                  <>
                    <p>Target odds to look for: {singleResult.targetOdds ? singleResult.targetOdds.toFixed(2) : "-" }+</p>
                    <p>What to look for: slower tempo, lower chance quality, no red cards, no big pressure against your side.</p>
                  </>
                ) : singleResult.actionLabel.startsWith("VALUE BET") ? (
                  <>
                    <p>Bet side: {singleResult.pick}</p>
                    <p>Current book price is already better than your fair price.</p>
                  </>
                ) : (
                  <>
                    <p>No value at the current price.</p>
                    <p>Avoid forcing a bet just because the match looks tempting.</p>
                  </>
                )}
                <div className="small" style={{marginTop:8}}>Raw edge: {singleResult.edge.toFixed(1)}% · Adjusted edge: {(singleResult.adjustedEdge ?? singleResult.edge).toFixed(1)}%</div>
                <div className="varianceExplain">
                  <strong>{singleResult.varianceInfo?.label}</strong>
                  <div className="small">{singleResult.varianceInfo?.text}</div>
                </div>
              </div>
            </>}
          </div>
        </section>
      )}

      {activeTab==="best" && (
        <section><div className="card">
          <h2 className="sectionTitle">Best Bets Today</h2>
          {analysedRows.length===0?<p className="muted">No scanned rows yet.</p>:(
            <div className="bestList">
              {analysedRows.slice(0,8).map((row)=>(
                <div className="bestCard" key={row.id}>
                  <div className="bestTop">
                    <div><div className="bestTitle">{row.pick}</div><div className="bestMeta">{row.match} · {MARKET_CONFIG[row.market]?.emoji} {MARKET_CONFIG[row.market]?.label}</div></div>
                    <div className={badgeClass(row.confidence)}>{row.confidence}</div>
                  </div>
                  <div className="bestStats">
                    <div className="bestStat"><div className="k">Edge</div><div className="v">{(row.adjustedEdge ?? row.edge).toFixed(1)}%</div></div>
                    <div className="bestStat"><div className="k">True line</div><div className="v">{num(row.trueLine)}</div></div>
                    <div className="bestStat"><div className="k">Fair</div><div className="v">{row.side==="over"?num(row.fairOverOdds):num(row.fairUnderOdds)}</div></div>
                    <div className="bestStat"><div className="k">Suggested</div><div className="v">{row.side==="over"?num(row.suggestedOverOdds):num(row.suggestedUnderOdds)}</div></div>
                  </div>
                  <div className="actions"><button className="btn secondary" onClick={()=>addScannerRowToTracker(row)}>Add to tracker</button></div>
                </div>
              ))}
            </div>
          )}
        </div></section>
      )}

      {activeTab==="tracker" && (
        <section className="trackerGrid">
          <div className="card">
            <h2 className="sectionTitle">Tracker Summary</h2>
            <div className="dashboardGrid" style={{marginBottom:12}}>
              <div className="kpi"><div className="k">Settled</div><div className="v">{trackerStats.settled}</div></div>
              <div className="kpi"><div className="k">Win rate</div><div className="v">{trackerStats.winrate.toFixed(1)}%</div></div>
              <div className="kpi"><div className="k">Profit</div><div className="v">{`£${trackerStats.profit.toFixed(2)}`}</div></div>
              <div className="kpi"><div className="k">ROI</div><div className="v">{trackerStats.roi.toFixed(1)}%</div></div>
            </div>
            <div className="dashboardGrid" style={{marginBottom:12}}>
              <div className="kpi"><div className="k">Total bets</div><div className="v">{trackerStats.totalBets}</div></div>
              <div className="kpi"><div className="k">Won</div><div className="v">{trackerStats.wins}</div></div>
              <div className="kpi"><div className="k">Lost</div><div className="v">{trackerStats.losses}</div></div>
              <div className="kpi"><div className="k">Pending</div><div className="v">{trackerStats.pending}</div></div>
            </div>
          </div>
          <div className="card">
            <h2 className="sectionTitle">Tracked Bets</h2>
            {tracked.length===0?<p className="muted">No tracked bets yet.</p>:(
              <>
                <div className="mobileTrackedList">
                  {tracked.map((row)=>(
                    <div className="mobileTrackedCard" key={`mobile-${row.id}`}>
                      <div className="mobileTrackedTop">
                        <div>
                          <div className="mobileTrackedMatch">{row.match}</div>
                          <div className="small">{row.market} · {row.confidence}</div>
                        </div>
                        <div className="small">{Number(row.edge).toFixed(1)}%</div>
                      </div>
                      <div className="mobileTrackedGrid">
                        <div className="mobileTrackedCell"><span>Pick</span><strong>{row.pick}</strong></div>
                        <div className="mobileTrackedCell"><span>Odds</span><input className="input" value={row.odds} onChange={(e)=>updateTracked(row.id,"odds",e.target.value)} /></div>
                        <div className="mobileTrackedCell"><span>Stake</span><input className="input" value={row.stake} onChange={(e)=>updateTracked(row.id,"stake",e.target.value)} /></div>
                        <div className="mobileTrackedCell"><span>Result</span><select className="input" value={row.result} onChange={(e)=>updateTracked(row.id,"result",e.target.value)}><option>Pending</option><option>Won</option><option>Lost</option><option>Void</option></select></div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="tableWrap desktopTrackedTable">
                  <table className="table">
                    <thead><tr><th>Match</th><th>Pick</th><th>Odds</th><th>Stake</th><th>Edge</th><th>Result</th></tr></thead>
                    <tbody>
                      {tracked.map((row)=>(
                        <tr key={row.id}>
                          <td>{row.match}<div className="small">{row.market} · {row.confidence}</div></td>
                          <td>{row.pick}</td>
                          <td><input className="input" value={row.odds} onChange={(e)=>updateTracked(row.id,"odds",e.target.value)} /></td>
                          <td><input className="input" value={row.stake} onChange={(e)=>updateTracked(row.id,"stake",e.target.value)} /></td>
                          <td>{Number(row.edge).toFixed(1)}%</td>
                          <td><select className="input" value={row.result} onChange={(e)=>updateTracked(row.id,"result",e.target.value)}><option>Pending</option><option>Won</option><option>Lost</option><option>Void</option></select></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {activeTab==="settings" && (
        <section><div className="card">
          <h2 className="sectionTitle">Settings</h2>
          <div className="formGrid">
            <div className="field"><label>Edge threshold %</label><input className="input" value={settings.edgeThreshold} onChange={(e)=>setSettings(s=>({...s,edgeThreshold:Number(e.target.value)||0}))} /></div>
            <div className="field"><label>Suggested odds multiplier</label><input className="input" value={settings.suggestedMultiplier} onChange={(e)=>setSettings(s=>({...s,suggestedMultiplier:Number(e.target.value)||1}))} /></div>
            <div className="field"><label>Strong stake</label><input className="input" value={settings.stakeStrong} onChange={(e)=>setSettings(s=>({...s,stakeStrong:Number(e.target.value)||0}))} /></div>
            <div className="field"><label>Good stake</label><input className="input" value={settings.stakeGood} onChange={(e)=>setSettings(s=>({...s,stakeGood:Number(e.target.value)||0}))} /></div>
            <div className="field"><label>Lean stake</label><input className="input" value={settings.stakeLean} onChange={(e)=>setSettings(s=>({...s,stakeLean:Number(e.target.value)||0}))} /></div>
          </div>
          <div className="pillRow">
            <button className={`pill ${settings.homeAwayBoost ? "active" : ""}`} onClick={()=>setSettings(s=>({...s,homeAwayBoost:!s.homeAwayBoost}))}>{settings.homeAwayBoost?"Home/Away boost on":"Home/Away boost off"}</button>
            <button className={`pill ${settings.knockoutMode ? "active" : ""}`} onClick={()=>setSettings(s=>({...s,knockoutMode:!s.knockoutMode}))}>{settings.knockoutMode?"Knockout mode on":"Knockout mode off"}</button>
          </div>
          <div className="actions"><button className="btn danger" onClick={clearSaved}>Clear all saved browser data</button></div>
        </div></section>
      )}
    </div></main>
  );
}
