
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "value-scanner-phase6-2-upgraded";

const MARKET_CONFIG = {
  goals: { label: "Goals", emoji: "⚽", lineHint: "Usually 2.5, 3.5, 1.5 etc", forLabel: "Goals scored avg", againstLabel: "Goals conceded avg", typicalMin: 0, typicalMax: 3.5 },
  sot: { label: "Shots on Target", emoji: "🎯", lineHint: "Usually 7.5–9.5", forLabel: "SOT for avg", againstLabel: "SOT against avg", typicalMin: 2, typicalMax: 8 },
  corners: { label: "Corners", emoji: "🚩", lineHint: "Usually 8.5–10.5", forLabel: "Corners for avg", againstLabel: "Corners against avg", typicalMin: 3, typicalMax: 8 },
  cards: { label: "Cards", emoji: "🟨", lineHint: "Usually 3.5–5.5", forLabel: "Cards avg", againstLabel: "Cards against avg", typicalMin: 1, typicalMax: 4 },
};

const DEFAULTS = {
  goals: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "2.5", overOdds: "", underOdds: "" },
  sot: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "8.5", overOdds: "", underOdds: "" },
  corners: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "9.5", overOdds: "", underOdds: "" },
  cards: { match: "", homeFor: "", homeAgainst: "", awayFor: "", awayAgainst: "", line: "4.5", overOdds: "", underOdds: "" },
};

function parseNum(v){ const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function parseSeries(text){ return text.split(/[\n, ]+/).map(x=>x.trim()).filter(Boolean).map(Number).filter(Number.isFinite); }
function avg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function pct(v){ return `${(v * 100).toFixed(1)}%`; }
function num(v){ return Number(v).toFixed(2); }
function edgeWidth(edge){ const clamped=Math.max(-10,Math.min(10,edge)); return Math.abs(clamped)*5; }
function confFromEdge(edge){ if(edge>=8)return"Strong"; if(edge>=5)return"Good"; if(edge>=3)return"Lean"; return"Low"; }

let factCache = [0];
function logFactorial(n){
  if (factCache[n] != null) return factCache[n];
  let sum = factCache[factCache.length - 1];
  for (let i = factCache.length; i <= n; i++) {
    sum += Math.log(i);
    factCache[i] = sum;
  }
  return factCache[n];
}
function poissonPmf(k, lambda){
  if (lambda <= 0) return k===0?1:0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}
function poissonCdf(k, lambda){
  if (k < 0) return 0;
  let sum = 0;
  for (let i=0;i<=k;i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}
function probOverAsian(line, lambda){
  const whole=Math.floor(line);
  const frac=+(line-whole).toFixed(2);
  if (Math.abs(frac-0.5)<0.01) return 1-poissonCdf(whole,lambda);
  if (Math.abs(frac-0.0)<0.01) return 1-poissonCdf(whole,lambda);
  if (Math.abs(frac-0.25)<0.01){
    const p1=1-poissonCdf(whole,lambda);
    const p2=1-poissonCdf(whole,lambda);
    return (p1+p2)/2;
  }
  if (Math.abs(frac-0.75)<0.01){
    const p1=1-poissonCdf(whole,lambda);
    const p2=1-poissonCdf(whole+1,lambda);
    return (p1+p2)/2;
  }
  return 1-poissonCdf(Math.floor(line),lambda);
}
function fairProbsFromOdds(overOdds, underOdds){
  const pO=1/overOdds; const pU=1/underOdds; const total=pO+pU;
  return { fairOver:pO/total, fairUnder:pU/total };
}
function buildExplanation(result, row){
  if (!result) return "";
  const sideText = result.side === "over" ? "Over" : result.side === "under" ? "Under" : "No side";
  if (result.side === "skip") {
    return `Model total ${num(result.expectedTotal)} is too close to line ${row.line}, or the available odds are not high enough.`;
  }
  return `${sideText} is preferred because model total ${num(result.expectedTotal)} sits against line ${row.line}, giving a ${result.edge.toFixed(1)}% edge versus bookmaker fair probabilities.`;
}
function analyseRow(row, settings){
  const homeFor=parseNum(row.homeFor), homeAgainst=parseNum(row.homeAgainst), awayFor=parseNum(row.awayFor), awayAgainst=parseNum(row.awayAgainst), line=parseNum(row.line), overOdds=parseNum(row.overOdds), underOdds=parseNum(row.underOdds), market=row.market;
  if ([homeFor,homeAgainst,awayFor,awayAgainst,line,overOdds,underOdds].some(v=>v==null||v<=0)) return null;

  const baseHome=(homeFor+awayAgainst)/2;
  const baseAway=(awayFor+homeAgainst)/2;
  const homeBoost=settings.homeAwayBoost?1.04:1;
  const awayBoost=settings.homeAwayBoost?0.98:1;

  let expectedHome=baseHome*homeBoost, expectedAway=baseAway*awayBoost, expectedTotal=expectedHome+expectedAway;
  const marketAdjust={goals:1.0,sot:1.0,corners:1.03,cards:1.02};
  expectedTotal*=marketAdjust[market]||1;
  if (settings.knockoutMode && (market==="goals"||market==="sot")) expectedTotal*=0.96;
  if (settings.knockoutMode && market==="cards") expectedTotal*=1.03;

  const modelOver=probOverAsian(line,expectedTotal), modelUnder=1-modelOver;
  const {fairOver,fairUnder}=fairProbsFromOdds(overOdds,underOdds);
  const overEdge=(modelOver-fairOver)*100, underEdge=(modelUnder-fairUnder)*100;
  const threshold=settings.edgeThreshold;

  let side="skip", pick="SKIP", edge=0;
  if(overEdge>threshold&&overEdge>underEdge){ side="over"; pick=`OVER ${line}`; edge=overEdge; }
  else if(underEdge>threshold&&underEdge>overEdge){ side="under"; pick=`UNDER ${line}`; edge=underEdge; }

  const confidence=confFromEdge(edge);
  const fairOverOdds=modelOver>0?1/modelOver:0;
  const fairUnderOdds=modelUnder>0?1/modelUnder:0;
  const suggestedOverOdds=fairOverOdds*settings.suggestedMultiplier;
  const suggestedUnderOdds=fairUnderOdds*settings.suggestedMultiplier;
  const confidenceScore=Math.max(0,Math.min(10,edge/1.5));
  const volatility=Math.abs(expectedTotal-line)<0.15?"High variance":"Normal";

  const result = {
    ...row, expectedHome, expectedAway, expectedTotal, modelOver, modelUnder, fairOver, fairUnder,
    overEdge, underEdge, side, pick, edge, confidence, fairOverOdds, fairUnderOdds, suggestedOverOdds,
    suggestedUnderOdds, trueLine:expectedTotal, confidenceScore, volatility
  };
  return { ...result, explanation: buildExplanation(result, row) };
}
function todayBucket(dateString){
  const d = new Date(dateString);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOther = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startOther) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This week";
  return "Older";
}

export default function App(){
  const [activeTab,setActiveTab]=useState("scanner");
  const [market,setMarket]=useState("goals");
  const [forms,setForms]=useState(DEFAULTS);
  const [bulkText,setBulkText]=useState("");
  const [rows,setRows]=useState([]);
  const [tracked,setTracked]=useState([]);
  const [settings,setSettings]=useState({
    edgeThreshold:3,
    suggestedMultiplier:1.05,
    homeAwayBoost:true,
    knockoutMode:false,
    stakeStrong:3,
    stakeGood:2,
    stakeLean:1
  });
  const [avgCalc,setAvgCalc]=useState({match:"", market:"goals", mode:"split", homeForSeries:"", homeAgainstSeries:"", awayForSeries:"", awayAgainstSeries:""});
  const [filters,setFilters]=useState({confidence:"All", minEdge:"0", minOdds:"0"});
  const [cloudEmail,setCloudEmail]=useState("");
  const [cloudPassword,setCloudPassword]=useState("");
  const [cloudStatus,setCloudStatus]=useState("Cloud sync is off until you connect Supabase.");
  const [cloudUser,setCloudUser]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const supabaseRef = useRef(null);

  useEffect(()=>{
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      supabaseRef.current = createClient(url, key);
      setCloudStatus("Supabase detected. Sign in to sync across devices.");
      supabaseRef.current.auth.getUser().then(({data})=>{
        if (data?.user) setCloudUser(data.user);
      }).catch(()=>{});
    } else {
      setCloudStatus("Supabase env vars not set yet. Local browser save still works.");
    }
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(raw){
        const d=JSON.parse(raw);
        if(d.forms)setForms(d.forms);
        if(d.bulkText!==undefined)setBulkText(d.bulkText);
        if(d.rows)setRows(d.rows);
        if(d.tracked)setTracked(d.tracked);
        if(d.settings)setSettings(d.settings);
        if(d.market)setMarket(d.market);
        if(d.avgCalc)setAvgCalc(d.avgCalc);
        if(d.filters)setFilters(d.filters);
      }
    }catch(e){}
    setLoaded(true);
  },[]);

  useEffect(()=>{
    if(!loaded) return;
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({forms,bulkText,rows,tracked,settings,market,avgCalc,filters}));
    }catch(e){}
  },[forms,bulkText,rows,tracked,settings,market,avgCalc,filters,loaded]);

  const active=forms[market];
  const cfg=MARKET_CONFIG[market];
  const avgCfg=MARKET_CONFIG[avgCalc.market];
  const singleResult=useMemo(()=>analyseRow({...active, market}, settings),[active,market,settings]);
  const analysedRows=useMemo(()=>rows.map(r=>analyseRow(r,settings)).filter(Boolean).sort((a,b)=>b.edge-a.edge),[rows,settings]);

  const filteredRows = useMemo(()=>{
    return analysedRows.filter((row)=>{
      if (filters.confidence !== "All") {
        const order = ["Low","Lean","Good","Strong"];
        if (order.indexOf(row.confidence) < order.indexOf(filters.confidence)) return false;
      }
      if (row.edge < Number(filters.minEdge || 0)) return false;
      const chosenOdds = row.side === "over" ? parseNum(row.overOdds) : row.side === "under" ? parseNum(row.underOdds) : 0;
      if (chosenOdds < Number(filters.minOdds || 0)) return false;
      return true;
    });
  }, [analysedRows, filters]);

  const strongCount=filteredRows.filter(r=>r.confidence==="Strong").length;
  const goodCount=filteredRows.filter(r=>r.confidence==="Good").length;
  const bestRow=filteredRows[0]||null;

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

  const trackerStats=useMemo(()=>{
    const settled=tracked.filter(x=>x.result!=="Pending");
    const wins=settled.filter(x=>x.result==="Won").length;
    const losses=settled.filter(x=>x.result==="Lost").length;
    const profit=settled.reduce((sum,x)=> x.result==="Won" ? sum+((Number(x.odds)-1)*Number(x.stake)) : x.result==="Lost" ? sum-Number(x.stake) : sum ,0);
    const stake=settled.filter(x=>x.result!=="Void").reduce((sum,x)=>sum+Number(x.stake),0);
    const roi=stake>0?(profit/stake)*100:0;
    const winrate=(wins+losses)>0?(wins/(wins+losses))*100:0;
    return {settled: settled.length, profit, roi, winrate};
  },[tracked]);

  const roiByMarket = useMemo(()=>{
    const markets = Object.keys(MARKET_CONFIG);
    return markets.map((m)=>{
      const entries = tracked.filter((x)=>x.marketKey === m && x.result !== "Pending");
      const stake = entries.filter(x=>x.result!=="Void").reduce((sum,x)=>sum+Number(x.stake),0);
      const profit = entries.reduce((sum,x)=> x.result==="Won" ? sum+((Number(x.odds)-1)*Number(x.stake)) : x.result==="Lost" ? sum-Number(x.stake) : sum ,0);
      const roi = stake > 0 ? (profit / stake) * 100 : 0;
      return { key:m, label:MARKET_CONFIG[m].label, roi, count:entries.length, profit };
    });
  }, [tracked]);

  const groupedTracked = useMemo(()=>{
    const groups = { "Today": [], "Yesterday": [], "This week": [], "Older": [] };
    tracked.forEach((item)=>{
      const bucket = todayBucket(item.createdAt || new Date().toISOString());
      groups[bucket].push(item);
    });
    return groups;
  }, [tracked]);

  function buildStatePayload(){
    return { forms, bulkText, rows, tracked, settings, market, avgCalc, filters };
  }

  async function signUpCloud(){
    if (!supabaseRef.current) return setCloudStatus("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY first.");
    const { data, error } = await supabaseRef.current.auth.signUp({ email: cloudEmail, password: cloudPassword });
    if (error) return setCloudStatus(error.message);
    setCloudUser(data.user || null);
    setCloudStatus("Sign-up submitted. If email confirmation is enabled, confirm it first.");
  }
  async function signInCloud(){
    if (!supabaseRef.current) return setCloudStatus("Add Supabase env vars first.");
    const { data, error } = await supabaseRef.current.auth.signInWithPassword({ email: cloudEmail, password: cloudPassword });
    if (error) return setCloudStatus(error.message);
    setCloudUser(data.user || null);
    setCloudStatus("Signed in. You can now save and load cloud state.");
  }
  async function signOutCloud(){
    if (!supabaseRef.current) return;
    await supabaseRef.current.auth.signOut();
    setCloudUser(null);
    setCloudStatus("Signed out from cloud sync.");
  }
  async function saveCloudState(){
    if (!supabaseRef.current || !cloudUser) return setCloudStatus("Sign in first.");
    const payload = buildStatePayload();
    const { error } = await supabaseRef.current.from("value_scanner_state").upsert({
      user_id: cloudUser.id,
      app_state: payload,
      updated_at: new Date().toISOString()
    });
    setCloudStatus(error ? error.message : "Cloud state saved.");
  }
  async function loadCloudState(){
    if (!supabaseRef.current || !cloudUser) return setCloudStatus("Sign in first.");
    const { data, error } = await supabaseRef.current.from("value_scanner_state").select("app_state").eq("user_id", cloudUser.id).single();
    if (error) return setCloudStatus(error.message);
    const d = data?.app_state;
    if (!d) return setCloudStatus("No saved cloud state found yet.");
    if(d.forms)setForms(d.forms);
    if(d.bulkText!==undefined)setBulkText(d.bulkText);
    if(d.rows)setRows(d.rows);
    if(d.tracked)setTracked(d.tracked);
    if(d.settings)setSettings(d.settings);
    if(d.market)setMarket(d.market);
    if(d.avgCalc)setAvgCalc(d.avgCalc);
    if(d.filters)setFilters(d.filters);
    setCloudStatus("Cloud state loaded.");
  }

  function update(field,value){ setForms(prev=>({...prev,[market]:{...prev[market],[field]:value}})); }
  function loadAverageToScanner(){
    setMarket(avgCalc.market);
    setForms(prev=>({...prev,[avgCalc.market]:{
      ...prev[avgCalc.market],
      match:avgCalc.match||prev[avgCalc.market].match,
      homeFor:avgResult.homeForAvg?avgResult.homeForAvg.toFixed(2):prev[avgCalc.market].homeFor,
      homeAgainst:avgResult.homeAgainstAvg?avgResult.homeAgainstAvg.toFixed(2):prev[avgCalc.market].homeAgainst,
      awayFor:avgResult.awayForAvg?avgResult.awayForAvg.toFixed(2):prev[avgCalc.market].awayFor,
      awayAgainst:avgResult.awayAgainstAvg?avgResult.awayAgainstAvg.toFixed(2):prev[avgCalc.market].awayAgainst
    }}));
    setActiveTab("scanner");
  }
  function addSingleToScanner(){ setRows(prev=>[{...active, market, id:`${Date.now()}-single`},...prev]); }
  function importBulk(){
    const parsed = bulkText.split("\n").map(x=>x.trim()).filter(Boolean).map((line,idx)=>{
      const p=line.split(",").map(x=>x.trim());
      if(p.length<9)return null;
      return {id:`${Date.now()}-${idx}`,match:p[0],market:p[1],homeFor:p[2],homeAgainst:p[3],awayFor:p[4],awayAgainst:p[5],line:p[6],overOdds:p[7],underOdds:p[8]};
    }).filter(Boolean);
    setRows(parsed);
  }
  function makeTrackedRow(row){
    const stake=row.confidence==="Strong"?settings.stakeStrong:row.confidence==="Good"?settings.stakeGood:settings.stakeLean;
    const odds=row.side==="over"?row.overOdds:row.underOdds;
    return {
      id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      match:row.match,
      market:MARKET_CONFIG[row.market]?.label||row.market,
      marketKey:row.market,
      pick:row.pick,
      confidence:row.confidence,
      edge:row.edge,
      odds,
      stake,
      result:"Pending",
      createdAt:new Date().toISOString()
    };
  }
  function addScannerRowToTracker(row){ setTracked(prev=>[makeTrackedRow(row),...prev]); setActiveTab("tracker"); }
  function addToTrackerFromResult(result){
    if(!result||result.side==="skip")return;
    const row = {
      ...result,
      match: active.match || `${cfg.label} bet`,
      market,
      overOdds: active.overOdds,
      underOdds: active.underOdds
    };
    setTracked(prev=>[makeTrackedRow(row),...prev]);
    setActiveTab("tracker");
  }
  function updateTracked(id,field,value){ setTracked(prev=>prev.map(x=>x.id===id?{...x,[field]:value}:x)); }
  function clearSaved(){
    try{localStorage.removeItem(STORAGE_KEY)}catch(e){}
    setForms(DEFAULTS); setBulkText(""); setRows([]); setTracked([]);
    setAvgCalc({match:"",market:"goals",mode:"split",homeForSeries:"",homeAgainstSeries:"",awayForSeries:"",awayAgainstSeries:""});
    setFilters({confidence:"All", minEdge:"0", minOdds:"0"});
    setSettings({edgeThreshold:3,suggestedMultiplier:1.05,homeAwayBoost:true,knockoutMode:false,stakeStrong:3,stakeGood:2,stakeLean:1});
  }
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
          <div className="titleRow"><div className="logo">🔥</div><div><div className="title">Value Scanner Phase 6.2+</div><div className="subtitle">Same base you liked, with safer upgrades: cloud sync option, ROI by market, best-bet filters, clearer explanations, one-tap tracker add, date grouping, and stronger warnings.</div></div></div>
          <div className="pillRow"><div className="pill active">Cloud sync ready</div><div className="pill">ROI by market</div><div className="pill">Best-bet filters</div><div className="pill">Date grouping</div></div>
        </div>
        <div className="helpCard">
          <h3 style={{marginTop:0}}>Safe upgrade set</h3>
          <ul className="helperList">
            <li>Current browser save still works as before.</li>
            <li>Supabase cloud sync is optional and only turns on when your env vars are added.</li>
            <li>Best Bets can now be filtered by confidence, edge, and odds.</li>
            <li>Tracker now shows ROI by market and groups entries by date.</li>
          </ul>
        </div>
      </section>

      <section className="dashboardGrid">
        <div className="kpi"><div className="k">Filtered rows</div><div className="v">{filteredRows.length}</div><div className="s">After your filters</div></div>
        <div className="kpi"><div className="k">Strong bets</div><div className="v">{strongCount}</div><div className="s">High priority</div></div>
        <div className="kpi"><div className="k">Good bets</div><div className="v">{goodCount}</div><div className="s">Playable</div></div>
        <div className="kpi"><div className="k">Best edge</div><div className="v">{bestRow ? `${bestRow.edge.toFixed(1)}%` : "-"}</div><div className="s">{bestRow ? bestRow.match : "No rows yet"}</div></div>
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
              <div className="rulebox"><strong>Use this:</strong><br/>Home team stats = last 5 <strong>home</strong> games only.<br/>Away team stats = last 5 <strong>away</strong> games only.</div>
            ) : (
              <div className="warn">Quick mode mixes home and away games together. It is faster, but less accurate.</div>
            )}

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
              <div className="warn">These averages look more like <strong>{MARKET_CONFIG[likelyMarket].label}</strong> than <strong>{MARKET_CONFIG[avgCalc.market].label}</strong>. Double-check the market you selected.</div>
            ) : likelyMarket ? (
              <div className="goodbox">Selected market: <strong>{MARKET_CONFIG[avgCalc.market].label}</strong>. Likely market from number size: <strong>{MARKET_CONFIG[likelyMarket].label}</strong>.</div>
            ) : null}
            {market !== avgCalc.market ? (
              <div className="inlineWarn">Scanner is currently on {MARKET_CONFIG[market].label}. Tapping the button below will switch it to {MARKET_CONFIG[avgCalc.market].label}.</div>
            ) : null}
            <div className="actions"><button className="btn primary" onClick={loadAverageToScanner}>Use averages in scanner</button></div>
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
              <div className="small">Then add bookmaker line and odds in Scanner.</div>
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
            <h2 className="sectionTitle">{cfg.label} scanner</h2>
            <p className="sectionSub">{cfg.lineHint}</p>
            <div className="formGrid">
              <div className="field full"><label>Match</label><input className="input" value={active.match} onChange={(e)=>update("match", e.target.value)} /></div>
              <div className="field"><label>Home {cfg.forLabel}</label><input className="input" value={active.homeFor} onChange={(e)=>update("homeFor", e.target.value)} /></div>
              <div className="field"><label>Home {cfg.againstLabel}</label><input className="input" value={active.homeAgainst} onChange={(e)=>update("homeAgainst", e.target.value)} /></div>
              <div className="field"><label>Away {cfg.forLabel}</label><input className="input" value={active.awayFor} onChange={(e)=>update("awayFor", e.target.value)} /></div>
              <div className="field"><label>Away {cfg.againstLabel}</label><input className="input" value={active.awayAgainst} onChange={(e)=>update("awayAgainst", e.target.value)} /></div>
              <div className="field"><label>Line</label><input className="input" value={active.line} onChange={(e)=>update("line", e.target.value)} /></div>
              <div className="field"><label>Over odds</label><input className="input" value={active.overOdds} onChange={(e)=>update("overOdds", e.target.value)} /></div>
              <div className="field"><label>Under odds</label><input className="input" value={active.underOdds} onChange={(e)=>update("underOdds", e.target.value)} /></div>
            </div>
            <div className="actions">
              <button className="btn primary" onClick={addSingleToScanner}>Add to scanner</button>
              <button className="btn secondary" onClick={()=>singleResult&&addToTrackerFromResult(singleResult)}>Add to tracker</button>
            </div>
            <details className="bulkBox">
              <summary><span>Bulk scanner</span><span className="small">Tap to open / close</span></summary>
              <div className="bulkInner">
                <p className="sectionSub">Format: match,market,homeFor,homeAgainst,awayFor,awayAgainst,line,overOdds,underOdds</p>
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
                <div className="metric"><div className="k">Edge</div><div className="v">{singleResult.edge.toFixed(1)}%</div></div>
                <div className="metric"><div className="k">Confidence</div><div className="v">{singleResult.confidenceScore.toFixed(1)}/10</div></div>
              </div>
              <div className="resultGrid">
                <div className="detail"><h4>Model probabilities</h4><p>Over: {pct(singleResult.modelOver)}</p><p>Under: {pct(singleResult.modelUnder)}</p></div>
                <div className="detail"><h4>Book fair probabilities</h4><p>Over: {pct(singleResult.fairOver)}</p><p>Under: {pct(singleResult.fairUnder)}</p></div>
                <div className={`detail ${singleResult.side==="over"?"":"subtle"}`}><h4>Over fair / suggested</h4><p>Fair odds: {num(singleResult.fairOverOdds)}</p><p>Suggested odds: {num(singleResult.suggestedOverOdds)}</p></div>
                <div className={`detail ${singleResult.side==="under"?"":"subtle"}`}><h4>Under fair / suggested</h4><p>Fair odds: {num(singleResult.fairUnderOdds)}</p><p>Suggested odds: {num(singleResult.suggestedUnderOdds)}</p></div>
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
                <div className={`decisionText ${singleResult.side==="skip"?"skip":singleResult.confidence==="Strong"?"strong":singleResult.confidence==="Good"?"good":"lean"}`}>
                  {singleResult.side==="skip"?"NO BET":`${singleResult.confidence.toUpperCase()} ${singleResult.pick} (${singleResult.edge.toFixed(1)}%)`}
                </div>
                <div className="small">{singleResult.explanation}</div>
              </div>
            </>}
          </div>
        </section>
      )}

      {activeTab==="best" && (
        <section>
          <div className="card" style={{marginBottom:12}}>
            <h2 className="sectionTitle">Best Bet Filters</h2>
            <div className="filterRow">
              <select className="input" value={filters.confidence} onChange={(e)=>setFilters(f=>({...f, confidence:e.target.value}))}>
                <option>All</option><option>Lean</option><option>Good</option><option>Strong</option>
              </select>
              <input className="input" value={filters.minEdge} onChange={(e)=>setFilters(f=>({...f, minEdge:e.target.value}))} placeholder="Min edge %" />
              <input className="input" value={filters.minOdds} onChange={(e)=>setFilters(f=>({...f, minOdds:e.target.value}))} placeholder="Min chosen odds" />
            </div>
          </div>
          <div className="card">
            <h2 className="sectionTitle">Best Bets Today</h2>
            {filteredRows.length===0?<p className="muted">No scanned rows match your filters yet.</p>:(
              <div className="bestList">
                {filteredRows.slice(0,8).map((row)=>(
                  <div className="bestCard" key={row.id}>
                    <div className="bestTop">
                      <div><div className="bestTitle">{row.pick}</div><div className="bestMeta">{row.match} · {MARKET_CONFIG[row.market]?.emoji} {MARKET_CONFIG[row.market]?.label}</div></div>
                      <div className={badgeClass(row.confidence)}>{row.confidence}</div>
                    </div>
                    <div className="bestStats">
                      <div className="bestStat"><div className="k">Edge</div><div className="v">{row.edge.toFixed(1)}%</div></div>
                      <div className="bestStat"><div className="k">True line</div><div className="v">{num(row.trueLine)}</div></div>
                      <div className="bestStat"><div className="k">Fair</div><div className="v">{row.side==="over"?num(row.fairOverOdds):num(row.fairUnderOdds)}</div></div>
                      <div className="bestStat"><div className="k">Suggested</div><div className="v">{row.side==="over"?num(row.suggestedOverOdds):num(row.suggestedUnderOdds)}</div></div>
                    </div>
                    <div className="small" style={{marginTop:10}}>{row.explanation}</div>
                    <div className="actions"><button className="btn secondary" onClick={()=>addScannerRowToTracker(row)}>One-tap add to tracker</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab==="tracker" && (
        <section className="trackerGrid">
          <div className="card">
            <h2 className="sectionTitle">Tracker Summary</h2>
            <div className="dashboardGrid" style={{marginBottom:0}}>
              <div className="kpi"><div className="k">Settled</div><div className="v">{trackerStats.settled}</div></div>
              <div className="kpi"><div className="k">Win rate</div><div className="v">{trackerStats.winrate.toFixed(1)}%</div></div>
              <div className="kpi"><div className="k">Profit</div><div className="v">{trackerStats.profit.toFixed(2)}</div></div>
              <div className="kpi"><div className="k">ROI</div><div className="v">{trackerStats.roi.toFixed(1)}%</div></div>
            </div>

            <h3 className="groupTitle">ROI by market</h3>
            <div className="marketRoiGrid">
              {roiByMarket.map((m)=>(
                <div className="kpi" key={m.key}>
                  <div className="k">{m.label}</div>
                  <div className="v">{m.roi.toFixed(1)}%</div>
                  <div className="s">{m.count} settled · {m.profit.toFixed(2)} profit</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="sectionTitle">Tracked Bets</h2>
            {tracked.length===0?<p className="muted">No tracked bets yet.</p>:(
              Object.entries(groupedTracked).map(([group, items])=> items.length ? (
                <div key={group}>
                  <div className="groupTitle">{group}</div>
                  <div className="tableWrap">
                    <table className="table">
                      <thead><tr><th>Match</th><th>Pick</th><th>Odds</th><th>Stake</th><th>Edge</th><th>Result</th></tr></thead>
                      <tbody>
                        {items.map((row)=>(
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
                </div>
              ) : null)
            )}
          </div>
        </section>
      )}

      {activeTab==="settings" && (
        <section className="syncGrid">
          <div className="card">
            <h2 className="sectionTitle">Scanner settings</h2>
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
            <div className="actions"><button className="btn danger" onClick={clearSaved}>Clear local browser save</button></div>
          </div>

          <div className="card">
            <h2 className="sectionTitle">Cloud sync</h2>
            <p className="sectionSub">This is how you use the same data across different devices and browsers.</p>
            <div className="field"><label>Email</label><input className="input" value={cloudEmail} onChange={(e)=>setCloudEmail(e.target.value)} placeholder="you@example.com" /></div>
            <div className="field"><label>Password</label><input className="input" type="password" value={cloudPassword} onChange={(e)=>setCloudPassword(e.target.value)} placeholder="Create a password" /></div>
            <div className="actions">
              <button className="btn primary" onClick={signUpCloud}>Sign up</button>
              <button className="btn secondary" onClick={signInCloud}>Sign in</button>
              <button className="btn secondary" onClick={saveCloudState}>Save cloud state</button>
              <button className="btn secondary" onClick={loadCloudState}>Load cloud state</button>
              <button className="btn secondary" onClick={signOutCloud}>Sign out</button>
            </div>
            <div className="cloudStatus">{cloudStatus}{cloudUser ? ` Signed in as ${cloudUser.email || cloudUser.id}.` : ""}</div>

            <h3 className="groupTitle">Supabase setup</h3>
            <div className="codeBlock">{`1) Add Vercel env vars:
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

2) Create this table in Supabase SQL editor:

create table if not exists value_scanner_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table value_scanner_state enable row level security;

create policy "Users can read own state"
on value_scanner_state for select
using (auth.uid() = user_id);

create policy "Users can insert own state"
on value_scanner_state for insert
with check (auth.uid() = user_id);

create policy "Users can update own state"
on value_scanner_state for update
using (auth.uid() = user_id);`}</div>
          </div>
        </section>
      )}
    </div></main>
  );
}
