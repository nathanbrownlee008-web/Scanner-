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
  const [input,setInput]=useState("");
  const res=parseScores(input);

  return(
    <main className="box">
      <h1>Phase 7 – Score Parser</h1>
      <p>Paste scores like: 2-1,1-0,3-2</p>
      <textarea style={{width:"100%",height:120}} value={input} onChange={e=>setInput(e.target.value)} />
      <h3>Results</h3>
      <p>Avg Scored: {res.avgScored.toFixed(2)}</p>
      <p>Avg Conceded: {res.avgConceded.toFixed(2)}</p>
      <p>Games: {res.games}</p>
    </main>
  );
}
