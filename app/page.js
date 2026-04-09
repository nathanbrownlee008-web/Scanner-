 "use client";
import { useState } from "react";

export default function App() {
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
    const modelProbOver = expected / (l*2); // simple scaling
    const modelProbUnder = 1 - modelProbOver;

    const bookProbOver = 1/o;
    const bookProbUnder = 1/u;

    let pick = "SKIP";
    let value = 0;

    if (modelProbOver > bookProbOver) {
      pick = "OVER ✅";
      value = (modelProbOver - bookProbOver)*100;
    } else if (modelProbUnder > bookProbUnder) {
      pick = "UNDER ✅";
      value = (modelProbUnder - bookProbUnder)*100;
    }

    setResult({
      expected: expected.toFixed(2),
      pick,
      value: value.toFixed(1),
      modelOver: (modelProbOver*100).toFixed(1),
      bookOver: (bookProbOver*100).toFixed(1)
    });
  }

  return (
    <div style={{padding:30}}>
      <h1 style={{fontSize:32}}>🔥 Value Scanner PRO</h1>

      <input placeholder="Home avg" onChange={e=>setHome(e.target.value)} /><br/><br/>
      <input placeholder="Away avg" onChange={e=>setAway(e.target.value)} /><br/><br/>
      <input placeholder="Bookie line (e.g 8.5)" onChange={e=>setLine(e.target.value)} /><br/><br/>
      <input placeholder="Over odds" onChange={e=>setOverOdds(e.target.value)} /><br/><br/>
      <input placeholder="Under odds" onChange={e=>setUnderOdds(e.target.value)} /><br/><br/>

      <button onClick={calc} style={{padding:10, fontSize:16}}>Calculate</button>

      {result && (
        <div style={{marginTop:20}}>
          <p>Expected: {result.expected}</p>
          <p>Model Over %: {result.modelOver}</p>
          <p>Book Over %: {result.bookOver}</p>
          <h2>{result.pick}</h2>
          <p>Value Edge: {result.value}%</p>
        </div>
      )}
    </div>
  );
}
