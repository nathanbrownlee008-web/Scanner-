"use client";
import {useState} from "react";

function parseScores(text){
  const games=text.split(/[,\n]+/).map(x=>x.trim()).filter(Boolean);
  let scored=0, conceded=0;
  games.forEach(g=>{
    const parts=g.split("-");
    if(parts.length===2){
      const a=parseInt(parts[0]);const b=parseInt(parts[1]);
      if(!isNaN(a)&&!isNaN(b)){scored+=a;conceded+=b;}
    }
  });
  return {
    avgScored:games.length?scored/games.length:0,
    avgConceded:games.length?conceded/games.length:0,
    games:games.length
  };
}

export default function App(){
  const [homeInput,setHomeInput]=useState("");
  const [awayInput,setAwayInput]=useState("");
  const [line,setLine]=useState("2.5");
  const [overOdds,setOverOdds]=useState("");
  const [underOdds,setUnderOdds]=useState("");

  const home=parseScores(homeInput);
  const away=parseScores(awayInput);

  const expectedHome=(home.avgScored+away.avgConceded)/2 || 0;
  const expectedAway=(away.avgScored+home.avgConceded)/2 || 0;
  const total=expectedHome+expectedAway;

  function fairProb(odds){return odds?1/odds:0}

  const modelOver = total>line ? 0.6 : 0.4;
  const modelUnder = 1-modelOver;

  const fairOver = fairProb(overOdds);
  const fairUnder = fairProb(underOdds);

  const overEdge = (modelOver - fairOver)*100;
  const underEdge = (modelUnder - fairUnder)*100;

  let pick="NO BET";
  if(overEdge>3 && overEdge>underEdge) pick="OVER";
  if(underEdge>3 && underEdge>overEdge) pick="UNDER";

  return(
    <main className="wrap">
      <h1>Phase 7.2 PRO</h1>

      <div className="card">
        <h3>Home (HOME games)</h3>
        <textarea value={homeInput} onChange={e=>setHomeInput(e.target.value)} placeholder="2-1,1-0,3-2"/>
        <p>{home.avgScored.toFixed(2)} scored | {home.avgConceded.toFixed(2)} conceded</p>
      </div>

      <div className="card">
        <h3>Away (AWAY games)</h3>
        <textarea value={awayInput} onChange={e=>setAwayInput(e.target.value)} placeholder="1-2,0-1,2-2"/>
        <p>{away.avgScored.toFixed(2)} scored | {away.avgConceded.toFixed(2)} conceded</p>
      </div>

      <div className="card">
        <h3>Model</h3>
        <p>Expected Total: {total.toFixed(2)}</p>
        <input value={line} onChange={e=>setLine(e.target.value)} placeholder="Line"/>
        <input value={overOdds} onChange={e=>setOverOdds(e.target.value)} placeholder="Over odds"/>
        <input value={underOdds} onChange={e=>setUnderOdds(e.target.value)} placeholder="Under odds"/>
      </div>

      <div className="card">
        <h2>Value Output</h2>
        <p>Over Edge: {overEdge.toFixed(1)}%</p>
        <p>Under Edge: {underEdge.toFixed(1)}%</p>
        <h2>{pick}</h2>
      </div>

    </main>
  );
}
