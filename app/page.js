
"use client";
import {useState} from "react";

function parseScores(text){
  const g=text.split(/[,\n]+/).map(x=>x.trim()).filter(Boolean);
  let s=0,c=0;
  g.forEach(x=>{
    const p=x.split("-");
    if(p.length===2){const a=+p[0],b=+p[1]; if(!isNaN(a)&&!isNaN(b)){s+=a;c+=b;}}
  });
  return {sc:s/(g.length||1), cc:c/(g.length||1)};
}

export default function App(){
  const [tab,setTab]=useState("Goals");
  const [h,setH]=useState(""); const [a,setA]=useState("");
  const [line,setLine]=useState("2.5");
  const [o,setO]=useState(""); const [u,setU]=useState("");

  const hp=parseScores(h); const ap=parseScores(a);
  const eh=(hp.sc+ap.cc)/2||0; const ea=(ap.sc+hp.cc)/2||0;
  const total=eh+ea;

  const fairOver= total>0? (1/(Math.max(0.05, Math.min(0.95, total/(+line*2))))):0.5;
  const bookOver = o?1/o:0;
  const edge = (bookOver - fairOver)*100;

  const label = edge>8?"🔥 STRONG":edge>4?"✅ GOOD":edge>1?"⚠️ SMALL":"❌ NO BET";

  return(
    <main className="wrap">
      <h1>🔥 Value Scanner Elite</h1>

      <div className="tabs">
        {["Goals","Corners","SOT","Cards"].map(t=>
          <div key={t} className={"tab "+(tab===t?"active":"")} onClick={()=>setTab(t)}>{t}</div>
        )}
      </div>

      <div className="card">
        <h3>Home (HOME games)</h3>
        <textarea placeholder="2-1,1-0,3-2" value={h} onChange={e=>setH(e.target.value)} />
      </div>

      <div className="card">
        <h3>Away (AWAY games)</h3>
        <textarea placeholder="1-2,0-1,2-2" value={a} onChange={e=>setA(e.target.value)} />
      </div>

      <div className="card">
        <h3>Model</h3>
        <p>Expected total: {total.toFixed(2)}</p>
        <input value={line} onChange={e=>setLine(e.target.value)} placeholder="Line"/>
        <input value={o} onChange={e=>setO(e.target.value)} placeholder="Over odds"/>
        <input value={u} onChange={e=>setU(e.target.value)} placeholder="Under odds"/>
      </div>

      <div className="card">
        <h2>Best Bet</h2>
        <p className={edge>0?"good":"bad"}>{label}</p>
        <p>Edge: {edge.toFixed(1)}%</p>
        <div className="bar">
          <div className="fill" style={{width: Math.min(100, Math.max(0, edge+50))+"%"}}></div>
        </div>
      </div>

    </main>
  );
}
