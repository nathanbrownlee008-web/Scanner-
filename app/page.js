 "use client";
import { useState } from "react";

export default function App() {
  const [market, setMarket] = useState("goals");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [line, setLine] = useState("");
  const [overOdds, setOverOdds] = useState("");
  const [underOdds, setUnderOdds] = useState("");
  const [result, setResult] = useState(null);

  function calc() {
    const h = parseFloat(home);
    const a = parseFloat(away);
    const l = parseFloat(line);
    const o = parseFloat(overOdds);
    const u = parseFloat(underOdds);

    if (!h || !a || !l || !o || !u) return;

    const expected = h + a;

    let modelProbOver = expected / (l * 2);
    if (market === "goals") modelProbOver = expected / (l * 1.8);
    if (market === "corners") modelProbOver = expected / (l * 2.2);
    if (market === "cards") modelProbOver = expected / (l * 1.6);

    if (modelProbOver > 1) modelProbOver = 0.95;
    if (modelProbOver < 0) modelProbOver = 0.05;

    const modelProbUnder = 1 - modelProbOver;
    const bookProbOver = 1 / o;
    const bookProbUnder = 1 / u;

    let pick = "SKIP";
    let edge = 0;

    if (modelProbOver > bookProbOver + 0.03) {
      pick = "OVER ✅";
      edge = (modelProbOver - bookProbOver) * 100;
    } else if (modelProbUnder > bookProbUnder + 0.03) {
      pick = "UNDER ✅";
      edge = (modelProbUnder - bookProbUnder) * 100;
    }

    setResult({
      expected: expected.toFixed(2),
      pick,
      edge: edge.toFixed(1),
      modelOver: (modelProbOver * 100).toFixed(1),
      bookOver: (bookProbOver * 100).toFixed(1)
    });
  }

  return (
    <div style={{padding:20}}>
      <h1 style={{fontSize:32}}>🔥 Value Scanner PRO V2</h1>

      <div style={{display:"flex", gap:10, marginBottom:20}}>
        {["goals","corners","cards","sot"].map(m=>(
          <button key={m} onClick={()=>setMarket(m)}
            style={{
              padding:"10px 15px",
              background:market===m?"#16a34a":"#222",
              color:"white",
              border:"none",
              borderRadius:8
            }}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{maxWidth:500}}>
        <input placeholder="Home avg" onChange={e=>setHome(e.target.value)} style={input}/>
        <input placeholder="Away avg" onChange={e=>setAway(e.target.value)} style={input}/>
        <input placeholder="Bookie line" onChange={e=>setLine(e.target.value)} style={input}/>
        <input placeholder="Over odds" onChange={e=>setOverOdds(e.target.value)} style={input}/>
        <input placeholder="Under odds" onChange={e=>setUnderOdds(e.target.value)} style={input}/>

        <button onClick={calc} style={btn}>Calculate</button>
      </div>

      {result && (
        <div style={{marginTop:30, padding:20, background:"#111", borderRadius:12}}>
          <h2>Result</h2>
          <p>Expected: {result.expected}</p>
          <p>Model Over %: {result.modelOver}</p>
          <p>Book Over %: {result.bookOver}</p>
          <h1>{result.pick}</h1>
          <p>Edge: {result.edge}%</p>
        </div>
      )}
    </div>
  );
}

const input = {
  display:"block",
  width:"100%",
  padding:12,
  marginBottom:10,
  borderRadius:8,
  border:"none",
  fontSize:16
};

const btn = {
  padding:12,
  width:"100%",
  background:"#16a34a",
  border:"none",
  borderRadius:8,
  color:"white",
  fontSize:16
};
