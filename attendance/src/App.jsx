import { useState, useEffect, useMemo, useCallback } from "react";

// ─── XLSX via CDN ─────────────────────────────────────────────────────────────
let _xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise(res => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = res;
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}

// ─── Storage ──────────────────────────────────────────────────────────────────
const SK = { board: "slc_board_v1", general: "slc_general_v1", attendance: "slc_attendance_v1" };
const loadLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const saveLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getToday = () => {
  const d = new Date();
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
};
const getNow = () => new Date().toLocaleString("en-US");
const fullName = (m) => `${m.firstName} ${m.lastName}`;

function parseFile(file, cb) {
  loadXLSX().then(() => {
    const fr = new FileReader();
    fr.onload = e => {
      const wb = window.XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      cb(window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }));
    };
    fr.readAsArrayBuffer(file);
  });
}

function parseGeneralRows(rows, uploadDate) {
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i].map(c => String(c).toLowerCase().trim());
    if (r.some(h => h.includes("first") || h === "name" || h === "fname")) { start = i + 1; break; }
  }
  const out = []; const seen = new Set();
  for (let i = start; i < rows.length; i++) {
    const fn = String(rows[i][0] || "").trim().replace(/\u00a0/g, "");
    const ln = String(rows[i][1] || "").trim().replace(/\u00a0/g, "");
    if (!fn || !ln) continue;
    const key = `${fn}|${ln}`.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push({ firstName: fn, lastName: ln, uploadBatchDate: uploadDate }); }
  }
  return out;
}

function parseBoardRows(rows, uploadDate) {
  const header = (rows[0] || []).map(c => String(c).toLowerCase().trim());
  if (header.some(h => h.includes("first"))) return parseGeneralRows(rows, uploadDate);
  const hdr = rows[0] || [];
  let col = 1;
  for (let i = hdr.length - 1; i >= 1; i--) {
    const v = String(hdr[i] || "").trim();
    if (v && v !== "None" && v !== "") { col = i; break; }
  }
  const out = []; const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const cell = String(rows[i][col] || "").trim();
    if (!cell || cell.toLowerCase() === "none") continue;
    const parts = cell.split(/\s+/);
    if (parts.length < 2) continue;
    const fn = parts[0]; const ln = parts.slice(1).join(" ");
    const key = `${fn}|${ln}`.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push({ firstName: fn, lastName: ln, uploadBatchDate: uploadDate }); }
  }
  return out;
}

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => `"${String(r[c]||"").replace(/"/g,'""')}"`).join(","))].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: filename
  });
  a.click();
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:      "#08152a",
  card:    "#0d1e38",
  card2:   "#111f38",
  border:  "#1b3560",
  gold:    "#f5c518",
  white:   "#eef3ff",
  gray:    "#6a80a8",
  success: "#25a55a",
  warn:    "#d4821a",
  danger:  "#b83232",
  kbg:     "#0a1a33",   // keyboard background
  kkey:    "#162848",   // key face
  kborder: "#1e3a6a",   // key border
  radius:  16,
};
const FC = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const FB = "'Barlow', Arial, sans-serif";

// ─── On-Screen Keyboard ───────────────────────────────────────────────────────
const KB_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["Z","X","C","V","B","N","M"],
];

function TouchKeyboard({ value, onChange, onClear }) {
  const [caps, setCaps] = useState(true);

  const tap = useCallback((k) => {
    if (k === "BACK") { onChange(value.slice(0, -1)); return; }
    if (k === "SPACE") { onChange(value + " "); return; }
    if (k === "CLEAR") { onClear(); return; }
    if (k === "CAPS") { setCaps(c => !c); return; }
    onChange(value + (caps ? k : k.toLowerCase()));
  }, [value, caps, onChange, onClear]);

  const Key = ({ label, display, wide, special, danger: isDanger }) => {
    const w = wide === "xl" ? 200 : wide ? 80 : 54;
    const bg = isDanger ? "rgba(184,50,50,.35)" : special ? C.card : C.kkey;
    const bdr = isDanger ? C.danger : special ? C.border : C.kborder;
    const col = isDanger ? "#ff8080" : special ? C.gray : C.white;
    return (
      <button
        onPointerDown={e => { e.preventDefault(); tap(label); e.currentTarget.style.transform = "scale(.88)"; e.currentTarget.style.background = C.gold; e.currentTarget.style.color = C.bg; }}
        onPointerUp={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.background = bg; e.currentTarget.style.color = col; }}
        onPointerLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.background = bg; e.currentTarget.style.color = col; }}
        style={{
          width: w, minWidth: w, height: 58, background: bg, border: `2px solid ${bdr}`,
          borderRadius: 10, color: col, fontSize: wide === "xl" ? 16 : special ? 13 : 22,
          fontFamily: special ? FB : FC, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation",
          transition: "transform .08s",
          boxShadow: "0 3px 0 rgba(0,0,0,.5)",
        }}
      >
        {display || (caps ? label : label.toLowerCase())}
      </button>
    );
  };

  return (
    <div style={{
      background: C.kbg, borderTop: `3px solid ${C.border}`,
      padding: "14px 10px 16px", display: "flex", flexDirection: "column",
      alignItems: "center", gap: 8, flexShrink: 0,
    }}>
      {KB_ROWS.map((row, ri) => (
        <div key={ri} style={{ display: "flex", gap: 6, justifyContent: "center" }}>
          {ri === 2 && <Key label="CAPS" display={caps ? "⇧ ON" : "⇧ OFF"} wide special />}
          {row.map(k => <Key key={k} label={k} />)}
          {ri === 2 && <Key label="BACK" display="⌫" wide special danger />}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <Key label="CLEAR" display="✕ Clear" wide="xl" special danger />
        <Key label="SPACE" display="SPACE" wide="xl" special />
      </div>
    </div>
  );
}

// ─── PIN Pad ──────────────────────────────────────────────────────────────────
function PinPad({ value, onChange }) {
  const digits = ["1","2","3","4","5","6","7","8","9","←","0","✓"];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, maxWidth:280, margin:"0 auto" }}>
      {digits.map(d => {
        const isBack = d === "←";
        const isOk = d === "✓";
        const bg = isOk ? C.gold : isBack ? "rgba(184,50,50,.25)" : C.kkey;
        const bdr = isOk ? C.gold : isBack ? C.danger : C.kborder;
        const col = isOk ? C.bg : isBack ? "#ff8888" : C.white;
        return (
          <button key={d}
            onPointerDown={e => { e.preventDefault();
              if (isBack) onChange(value.slice(0,-1));
              else if (!isOk) onChange(value.length < 6 ? value + d : value);
              e.currentTarget.style.transform = "scale(.9)";
            }}
            onPointerUp={e => e.currentTarget.style.transform = ""}
            onPointerLeave={e => e.currentTarget.style.transform = ""}
            style={{ height:70, background:bg, border:`2px solid ${bdr}`, borderRadius:12,
              color:col, fontSize:26, fontFamily:FC, fontWeight:800, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 3px 0 rgba(0,0,0,.5)", touchAction:"manipulation",
              userSelect:"none", WebkitUserSelect:"none", transition:"transform .08s" }}>
            {d}
          </button>
        );
      })}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, []);
  const bg = { success: C.success, warn: C.warn, danger: C.danger }[type] || C.success;
  return (
    <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)",
      background:bg, color:"#fff", padding:"16px 32px", borderRadius:40,
      fontSize:18, fontWeight:600, zIndex:9999, boxShadow:"0 8px 32px rgba(0,0,0,.6)",
      maxWidth:"92vw", textAlign:"center", fontFamily:FB }}>
      {msg}
    </div>
  );
}

function ConfirmDialog({ msg, onYes, onNo }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", display:"flex",
      alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }}>
      <div style={{ background:C.card, border:`2px solid ${C.gold}`, borderRadius:C.radius,
        padding:36, maxWidth:420, width:"100%", textAlign:"center", fontFamily:FB }}>
        <div style={{ fontSize:20, color:C.white, marginBottom:28, lineHeight:1.45 }}>{msg}</div>
        <div style={{ display:"flex", gap:14, justifyContent:"center" }}>
          <button onClick={onNo} style={{ padding:"13px 28px", background:C.card2,
            border:`2px solid ${C.border}`, color:C.white, borderRadius:10, fontSize:17,
            cursor:"pointer", fontWeight:600 }}>Cancel</button>
          <button onClick={onYes} style={{ padding:"13px 28px", background:C.danger,
            border:"none", color:"#fff", borderRadius:10, fontSize:17, cursor:"pointer", fontWeight:700 }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

function Header({ title, onBack }) {
  return (
    <div style={{ background:"linear-gradient(135deg,#0b1d3a,#102040)", borderBottom:`3px solid ${C.gold}`,
      padding:"14px 18px", display:"flex", alignItems:"center", gap:14, minHeight:66, flexShrink:0 }}>
      {onBack && (
        <button onClick={onBack} style={{ background:"rgba(245,197,24,.12)", border:`2px solid ${C.gold}`,
          color:C.gold, borderRadius:10, padding:"10px 20px", fontSize:22, cursor:"pointer",
          fontFamily:FC, fontWeight:700, flexShrink:0, touchAction:"manipulation" }}>← Back</button>
      )}
      <div>
        <div style={{ fontFamily:FC, fontWeight:800, fontSize:26, color:C.gold, letterSpacing:1, lineHeight:1 }}>
          🦁 SHAKOPEE LIONS CLUB
        </div>
        <div style={{ color:C.gray, fontSize:13, fontFamily:FB, marginTop:3 }}>{title}</div>
      </div>
    </div>
  );
}

// ─── Random Drawing Screen ────────────────────────────────────────────────────
function DrawingScreen({ onBack }) {
  const td = getToday();
  const attendance = loadLS(SK.attendance) || [];

  // Unique checked-in general members today (no duplicates)
  const pool = useMemo(() => {
    const seen = new Set();
    return attendance.filter(r =>
      r.meetingType === "general" && r.meetingDate === td && !r.duplicateFlag &&
      !seen.has(r.fullName) && seen.add(r.fullName)
    ).map(r => r.fullName);
  }, []);

  const drawCount = Math.max(1, Math.round(pool.length * 0.1));

  const [phase, setPhase]       = useState("ready");   // ready | spinning | reveal | done
  const [winners, setWinners]   = useState([]);
  const [revealed, setRevealed] = useState([]);
  const [spinning, setSpinning] = useState("");        // name flickering during slot spin
  const [spinIdx, setSpinIdx]   = useState(0);         // which winner we're revealing

  // Fisher-Yates shuffle
  const shuffle = (arr) => {
    const a = [...arr]; for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;
  };

  const startDraw = () => {
    const drawn = shuffle(pool).slice(0, drawCount);
    setWinners(drawn);
    setRevealed([]);
    setSpinIdx(0);
    setPhase("spinning");
  };

  // Slot-machine spin effect per winner
  useEffect(() => {
    if (phase !== "spinning") return;
    if (spinIdx >= winners.length) { setPhase("done"); setSpinning(""); return; }

    let ticks = 0;
    const totalTicks = 18 + spinIdx * 4; // gets slightly longer for each draw
    const iv = setInterval(() => {
      setSpinning(pool[Math.floor(Math.random() * pool.length)]);
      ticks++;
      if (ticks >= totalTicks) {
        clearInterval(iv);
        const winner = winners[spinIdx];
        setSpinning("");
        setRevealed(prev => [...prev, winner]);
        setTimeout(() => setSpinIdx(i => i + 1), 900);
      }
    }, 80);
    return () => clearInterval(iv);
  }, [phase, spinIdx]);

  const reset = () => { setPhase("ready"); setWinners([]); setRevealed([]); setSpinning(""); setSpinIdx(0); };

  // ── Slot display ──
  const SlotDisplay = () => (
    <div style={{
      background:"linear-gradient(135deg,#0a1a10,#0d2a18)",
      border:`3px solid ${C.gold}`, borderRadius:20,
      padding:"28px 20px", textAlign:"center", margin:"0 auto", width:"100%",
      boxShadow:`0 0 40px rgba(245,197,24,.25)`,
    }}>
      <div style={{ fontFamily:FC, fontSize:14, color:C.gray, letterSpacing:3, marginBottom:10 }}>DRAWING NOW</div>
      <div style={{
        fontFamily:FC, fontWeight:800, fontSize:44, color:C.gold,
        minHeight:64, display:"flex", alignItems:"center", justifyContent:"center",
        letterSpacing:1, textShadow:`0 0 20px rgba(245,197,24,.6)`,
        animation: spinning ? "flicker .08s infinite" : "none",
      }}>
        {spinning || "…"}
      </div>
      <div style={{ color:C.gray, fontSize:13, fontFamily:FB, marginTop:8 }}>
        Drawing {spinIdx + 1} of {winners.length}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column" }}>
      <style>{`
        @keyframes flicker { 0%{opacity:1} 50%{opacity:.4} 100%{opacity:1} }
        @keyframes popIn { 0%{transform:scale(0) rotate(-8deg);opacity:0} 70%{transform:scale(1.08) rotate(2deg)} 100%{transform:scale(1) rotate(0);opacity:1} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
      `}</style>
      <Header title={`🎰 Member Drawing · ${td}`} onBack={onBack} />

      <div style={{ flex:1, overflowY:"auto", padding:"20px 18px", display:"flex", flexDirection:"column", gap:20, maxWidth:700, margin:"0 auto", width:"100%" }}>

        {/* Info bar */}
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1, background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius, padding:"14px 18px", textAlign:"center" }}>
            <div style={{ color:C.gray, fontSize:13, fontFamily:FB }}>Present today</div>
            <div style={{ fontFamily:FC, fontSize:36, fontWeight:800, color:C.white }}>{pool.length}</div>
          </div>
          <div style={{ flex:1, background:C.card, border:`2px solid ${C.gold}`, borderRadius:C.radius, padding:"14px 18px", textAlign:"center" }}>
            <div style={{ color:C.gray, fontSize:13, fontFamily:FB }}>Winners drawn</div>
            <div style={{ fontFamily:FC, fontSize:36, fontWeight:800, color:C.gold }}>{drawCount}</div>
          </div>
          <div style={{ flex:1, background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius, padding:"14px 18px", textAlign:"center" }}>
            <div style={{ color:C.gray, fontSize:13, fontFamily:FB }}>Revealed</div>
            <div style={{ fontFamily:FC, fontSize:36, fontWeight:800, color:C.success }}>{revealed.length}</div>
          </div>
        </div>

        {/* No attendance warning */}
        {pool.length === 0 && (
          <div style={{ background:"rgba(212,130,26,.1)", border:`2px solid ${C.warn}`, borderRadius:C.radius,
            padding:28, textAlign:"center", fontFamily:FB }}>
            <div style={{ fontSize:40, marginBottom:10 }}>⚠️</div>
            <div style={{ color:C.warn, fontSize:18, fontWeight:600 }}>No general members checked in today</div>
            <div style={{ color:C.gray, fontSize:14, marginTop:6 }}>Check members in first, then run the drawing.</div>
          </div>
        )}

        {/* Slot machine during spin */}
        {phase === "spinning" && <SlotDisplay />}

        {/* Winner cards */}
        {revealed.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontFamily:FC, fontWeight:700, fontSize:18, color:C.gold, letterSpacing:2 }}>
              🏆 WINNERS
            </div>
            {revealed.map((name, i) => (
              <div key={name} style={{
                background:"linear-gradient(135deg,#0d2a10,#0a1e0a)",
                border:`3px solid ${C.gold}`,
                borderRadius:C.radius, padding:"18px 24px",
                display:"flex", alignItems:"center", gap:16,
                animation:"popIn .45s cubic-bezier(.34,1.56,.64,1) both",
                boxShadow:`0 4px 24px rgba(245,197,24,.2)`,
              }}>
                <div style={{
                  background:C.gold, color:C.bg, borderRadius:"50%",
                  width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:FC, fontWeight:800, fontSize:22, flexShrink:0,
                }}>{i+1}</div>
                <div style={{ fontFamily:FC, fontWeight:800, fontSize:32, color:C.gold,
                  textShadow:`0 0 16px rgba(245,197,24,.4)`, letterSpacing:.5 }}>{name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Done — all revealed */}
        {phase === "done" && (
          <div style={{ background:C.card, border:`2px solid ${C.success}`, borderRadius:C.radius,
            padding:"20px 24px", textAlign:"center", fontFamily:FB }}>
            <div style={{ fontSize:36, marginBottom:8 }}>🎉</div>
            <div style={{ color:C.success, fontFamily:FC, fontSize:24, fontWeight:700 }}>Drawing Complete!</div>
            <div style={{ color:C.gray, fontSize:14, marginTop:4 }}>
              {revealed.length} winner{revealed.length!==1?"s":""} selected from {pool.length} present members
            </div>
          </div>
        )}

        {/* Ready state instructions */}
        {phase === "ready" && pool.length > 0 && (
          <div style={{ background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius,
            padding:"22px 24px", textAlign:"center", fontFamily:FB }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🎰</div>
            <div style={{ color:C.white, fontSize:17, marginBottom:6 }}>
              Ready to draw <strong style={{color:C.gold}}>{drawCount}</strong> winner{drawCount!==1?"s":""} from <strong style={{color:C.white}}>{pool.length}</strong> present members
            </div>
            <div style={{ color:C.gray, fontSize:13 }}>10% of today's attendance, rounded to nearest whole number</div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          {pool.length > 0 && (phase === "ready" || phase === "done") && (
            <button onClick={startDraw} style={{
              flex:2, minWidth:200, padding:"20px 24px",
              background:`linear-gradient(135deg,${C.gold},${C.goldDk || "#c9a214"})`,
              border:"none", borderRadius:C.radius,
              fontFamily:FC, fontWeight:800, fontSize:26, cursor:"pointer", color:C.bg,
              boxShadow:`0 6px 24px rgba(245,197,24,.35)`, touchAction:"manipulation",
            }}
              onPointerDown={e => e.currentTarget.style.transform="scale(.96)"}
              onPointerUp={e => e.currentTarget.style.transform=""}
              onPointerLeave={e => e.currentTarget.style.transform=""}
            >
              {phase === "done" ? "🎰 Draw Again" : "🎰 Start Drawing"}
            </button>
          )}
          {(phase === "done" || revealed.length > 0) && (
            <button onClick={reset} style={{
              flex:1, minWidth:120, padding:"20px 16px",
              background:C.card2, border:`2px solid ${C.border}`,
              borderRadius:C.radius, fontFamily:FC, fontWeight:700, fontSize:20,
              cursor:"pointer", color:C.gray, touchAction:"manipulation",
            }}>↺ Reset</button>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ boardCount, generalCount, generalApiState, onNav }) {
  const Btn = ({ icon, label, sub, warn, target }) => (
    <button onClick={() => onNav(target)} style={{
      background:`linear-gradient(160deg,${C.card2} 0%,#0c1b30 100%)`,
      border:`2.5px solid ${warn ? C.warn : C.gold}`, borderRadius:C.radius,
      padding:"26px 22px", cursor:"pointer", width:"100%", textAlign:"left",
      boxShadow:"0 6px 24px rgba(0,0,0,.45)", touchAction:"manipulation",
    }}
      onPointerDown={e => e.currentTarget.style.transform="scale(.97)"}
      onPointerUp={e => e.currentTarget.style.transform=""}
      onPointerLeave={e => e.currentTarget.style.transform=""}
    >
      <div style={{ fontSize:40 }}>{icon}</div>
      <div style={{ fontFamily:FC, fontWeight:800, fontSize:30, color:C.white, marginTop:10 }}>{label}</div>
      <div style={{ color: warn ? C.warn : C.gray, fontSize:14, marginTop:6, fontFamily:FB }}>{sub}</div>
    </button>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap'); * { -webkit-tap-highlight-color: transparent; }`}</style>
      <Header title="Attendance Tracker" />
      <div style={{ flex:1, padding:"24px 18px", display:"flex", flexDirection:"column", gap:16, maxWidth:640, margin:"0 auto", width:"100%" }}>
        <div style={{ textAlign:"center", color:C.gray, fontSize:15, fontFamily:FB, marginBottom:4 }}>{getToday()}</div>
        <Btn icon="📋" label="Board Meeting Attendance"
          sub={boardCount ? `${boardCount} board members loaded` : "⚠ No members loaded — visit Admin"}
          warn={!boardCount} target="board" />
        <Btn icon="🦁" label="General Membership Attendance"
          sub={
            generalApiState === "loading" ? "⏳ Loading members from server…" :
            generalApiState === "server-loading" ? "⏳ Server loading Neon data, please wait…" :
            generalApiState === "error" ? "⚠ Could not load members — check server" :
            generalCount ? `${generalCount} members loaded` : "⚠ No members loaded"
          }
          warn={generalApiState === "error" || (!generalCount && generalApiState === "ready")}
          target="general" />
        <Btn icon="⚙️" label="Admin" sub="Upload lists · View records · Export CSV" target="admin" />
        <Btn icon="🎰" label="Member Drawing" sub="Random 10% drawing from today's general attendance" target="drawing" />
        <div style={{ textAlign:"center", color:"#263c5c", fontSize:13, fontFamily:FB, marginTop:14 }}>
          We Serve · Shakopee Lions Club · Est. 1962
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Screen ────────────────────────────────────────────────────────
function AttendanceScreen({ mode, members, onBack }) {
  const [query, setQuery] = useState("");
  const [attendance, setAttendance] = useState(() => loadLS(SK.attendance) || []);
  const [toast, setToast] = useState(null);
  const td = getToday();
  const modeLabel = mode === "board" ? "Board Meeting" : "General Membership";

  const checkedInSet = useMemo(() => {
    const s = new Set();
    attendance.filter(r => r.meetingType === mode && r.meetingDate === td && !r.duplicateFlag)
      .forEach(r => s.add(r.fullName));
    return s;
  }, [attendance, mode, td]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members.filter(m =>
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q) ||
      fullName(m).toLowerCase().includes(q)
    ).slice(0, 12);
  }, [query, members]);

  const checkin = (member) => {
    const fn = fullName(member);
    const isDup = attendance.some(r => r.meetingType === mode && r.meetingDate === td && r.fullName === fn);
    const rec = {
      id: `${Date.now()}_${Math.random()}`,
      firstName: member.firstName, lastName: member.lastName, fullName: fn,
      meetingType: mode, meetingDate: td,
      checkInTimestamp: getNow(), duplicateFlag: isDup,
    };
    const updated = [...attendance, rec];
    setAttendance(updated); saveLS(SK.attendance, updated);
    setToast(isDup
      ? { msg: `⚠️ ${fn} already checked in today!`, type: "warn" }
      : { msg: `✅ ${fn} checked in!`, type: "success" }
    );
    setQuery("");
  };

  return (
    <div style={{ height:"100vh", background:C.bg, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <Header title={`${modeLabel} · ${td}`} onBack={onBack} />

      {/* Scrollable results area */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>

        {/* Counter + search display */}
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1, background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius,
            padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ color:C.gray, fontFamily:FB, fontSize:14 }}>Checked in today</span>
            <span style={{ fontFamily:FC, fontSize:36, fontWeight:800, color:C.gold }}>{checkedInSet.size}</span>
          </div>
          <div style={{ flex:2, background:C.card, border:`2px solid ${query ? C.gold : C.border}`,
            borderRadius:C.radius, padding:"12px 18px", display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:22 }}>🔍</span>
            <span style={{ fontFamily:FC, fontSize:24, fontWeight:700,
              color: query ? C.white : C.gray, letterSpacing:1, flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {query || "Start typing a name…"}
            </span>
            {query && (
              <button onClick={() => setQuery("")}
                style={{ background:"rgba(184,50,50,.3)", border:`1px solid ${C.danger}`, color:"#ff8888",
                  borderRadius:8, padding:"4px 12px", fontSize:14, cursor:"pointer", fontFamily:FB, touchAction:"manipulation" }}>
                ✕
              </button>
            )}
          </div>
        </div>

        {/* No results */}
        {query.trim() && !filtered.length && (
          <div style={{ textAlign:"center", color:C.gray, padding:24, fontSize:16, fontFamily:FB }}>
            No members found matching "{query}"
          </div>
        )}

        {/* Member result buttons */}
        {filtered.map(m => {
          const fn = fullName(m);
          const already = checkedInSet.has(fn);
          return (
            <button key={fn} onClick={() => checkin(m)} style={{
              background: already
                ? `linear-gradient(135deg,rgba(212,130,26,.12),${C.card})`
                : `linear-gradient(135deg,${C.card2},#1b3560)`,
              border:`2.5px solid ${already ? C.warn : C.gold}`,
              borderRadius:C.radius, padding:"16px 20px", cursor:"pointer",
              textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between",
              boxShadow:"0 3px 14px rgba(0,0,0,.35)", touchAction:"manipulation", flexShrink:0,
            }}
              onPointerDown={e => e.currentTarget.style.transform="scale(.98)"}
              onPointerUp={e => e.currentTarget.style.transform=""}
              onPointerLeave={e => e.currentTarget.style.transform=""}
            >
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:FC, fontWeight:700, fontSize:28, color:C.white }}>{fn}</div>
                <div style={{ display:"flex", gap:8, marginTop:4, flexWrap:"wrap", alignItems:"center" }}>
                  {m.cash && <span style={{ background:"rgba(245,197,24,.15)", border:`1px solid ${C.gold}`, color:C.gold, fontSize:11, padding:"2px 9px", borderRadius:20, fontFamily:FB, fontWeight:700 }}>CASH/CHECK</span>}
                  {m.membershipStatus === "expired" && <span style={{ background:"rgba(184,50,50,.15)", border:`1px solid ${C.danger}`, color:C.danger, fontSize:11, padding:"2px 9px", borderRadius:20, fontFamily:FB, fontWeight:700 }}>DUES OVERDUE</span>}
                  {already && <span style={{ color:C.warn, fontSize:12, fontFamily:FB }}>Already checked in — tap to log duplicate</span>}
                </div>
              </div>
              <div style={{ fontSize:30, marginLeft:12, flexShrink:0 }}>{already ? "⚠️" : "✓"}</div>
            </button>
          );
        })}

        {!query && (
          <div style={{ textAlign:"center", color:C.gray, padding:"20px 0", fontFamily:FB }}>
            <div style={{ fontSize:42, marginBottom:8 }}>⌨️</div>
            <div style={{ fontSize:17 }}>Use the keyboard below to search</div>
            <div style={{ fontSize:14, marginTop:4 }}>{members.length} members in this list</div>
          </div>
        )}
      </div>

      {/* On-screen keyboard — pinned to bottom */}
      <TouchKeyboard value={query} onChange={setQuery} onClear={() => setQuery("")} />

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

// ─── Admin Screen ─────────────────────────────────────────────────────────────
function AdminScreen({ boardMembers, setBoardMembers, onBack }) {
  const PIN = "1962";
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [tab, setTab] = useState("upload");
  const [attendance, setAttendance] = useState(() => loadLS(SK.attendance) || []);
  const [fType, setFType] = useState("all");
  const [fDate, setFDate] = useState("");
  const [fName, setFName] = useState("");
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [bStatus, setBStatus] = useState("");

  const tryLogin = useCallback(() => {
    if (pin === PIN) { setAuthed(true); setPinError(false); }
    else { setPinError(true); setPin(""); setTimeout(() => setPinError(false), 1000); }
  }, [pin]);

  // Auto-submit when 4 digits entered
  useEffect(() => { if (pin.length === 4) tryLogin(); }, [pin]);

  const doUpload = (file) => {
    if (!file) return;
    parseFile(file, rows => {
      const ud = getToday();
      const list = parseBoardRows(rows, ud);
      if (!list.length) { setToast({ msg:"No members found — check file format", type:"danger" }); return; }
      setBoardMembers(list); saveLS(SK.board, list); setBStatus(`✅ ${list.length} board members loaded on ${ud}`);
      setToast({ msg:`${list.length} members imported!`, type:"success" });
    });
  };

  const filtered = useMemo(() => attendance.filter(r => {
    if (fType !== "all" && r.meetingType !== fType) return false;
    if (fDate && !r.meetingDate.includes(fDate)) return false;
    if (fName && !r.fullName.toLowerCase().includes(fName.toLowerCase())) return false;
    return true;
  }), [attendance, fType, fDate, fName]);

  const IS = { background:C.card2, border:`2px solid ${C.border}`, color:C.white,
    borderRadius:10, padding:"11px 14px", fontSize:15, fontFamily:FB, width:"100%", outline:"none" };

  const TabBtn = ({ t, label }) => (
    <button onClick={() => setTab(t)} style={{ flex:1, padding:"13px 0", fontFamily:FC,
      fontWeight:700, fontSize:19, cursor:"pointer", borderRadius:10, border:"none",
      background: tab===t ? C.gold : C.card2, color: tab===t ? C.bg : C.gray,
      touchAction:"manipulation" }}>
      {label}
    </button>
  );

  const doExportBoardMembers = () => {
    exportCSV(boardMembers.map(m => ({ "First Name":m.firstName,"Last Name":m.lastName,"Full Name":fullName(m),"Upload Batch Date":m.uploadBatchDate })),
      `board_members_${getToday().replace(/\//g,"-")}.csv`);
  };

  // PIN login screen
  if (!authed) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column" }}>
      <Header title="Admin Login" onBack={onBack} />
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
        <div style={{ background:C.card, border:`2px solid ${pinError ? C.danger : C.border}`,
          borderRadius:C.radius, padding:36, maxWidth:360, width:"100%", textAlign:"center",
          fontFamily:FB, transition:"border-color .2s" }}>
          <div style={{ fontSize:48, marginBottom:10 }}>🔐</div>
          <div style={{ fontFamily:FC, fontSize:26, color:C.gold, fontWeight:800, marginBottom:20 }}>Admin PIN</div>

          {/* PIN dots display */}
          <div style={{ display:"flex", gap:12, justifyContent:"center", marginBottom:28 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width:22, height:22, borderRadius:"50%",
                background: i < pin.length ? (pinError ? C.danger : C.gold) : "transparent",
                border:`3px solid ${pinError ? C.danger : i < pin.length ? C.gold : C.border}`,
                transition:"background .15s",
              }} />
            ))}
          </div>

          {pinError && <div style={{ color:C.danger, fontFamily:FB, fontSize:15, marginBottom:16 }}>Incorrect PIN — try again</div>}

          {/* Numeric PIN pad */}
          <PinPad value={pin} onChange={setPin} />

          <button onClick={tryLogin} style={{ marginTop:20, width:"100%", padding:"16px",
            background:C.gold, border:"none", borderRadius:10, fontFamily:FC,
            fontWeight:800, fontSize:22, cursor:"pointer", color:C.bg, touchAction:"manipulation" }}>
            Unlock
          </button>
        </div>
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );

  // Admin panel
  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column" }}>
      <Header title="Admin Panel" onBack={onBack} />
      <div style={{ padding:"14px 14px 0" }}>
        <div style={{ display:"flex", gap:8 }}>
          <TabBtn t="upload" label="📂 Upload Lists" />
          <TabBtn t="records" label="📋 Attendance Records" />
        </div>
      </div>
      <div style={{ flex:1, padding:14, overflowY:"auto", display:"flex", flexDirection:"column", gap:16 }}>

        {tab === "upload" && (
          <>
            <div style={{ background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius, padding:22 }}>
              <div style={{ fontFamily:FC, fontWeight:800, fontSize:22, color:C.gold, marginBottom:4 }}>Board Meeting Member List</div>
              <div style={{ color:C.gray, fontSize:14, marginBottom:12, fontFamily:FB }}>
                {boardMembers.length ? `${boardMembers.length} members currently loaded` : "No members loaded"}
              </div>
              {bStatus && <div style={{ color:C.success, fontSize:14, marginBottom:12, fontFamily:FB }}>{bStatus}</div>}
              <label style={{ display:"block", background:C.card2, border:`2px dashed ${C.border}`,
                borderRadius:10, padding:"22px", textAlign:"center", cursor:"pointer" }}>
                <div style={{ fontSize:36, marginBottom:6 }}>📁</div>
                <div style={{ color:C.white, fontWeight:600, fontSize:16, fontFamily:FB }}>Tap to Upload CSV or Excel</div>
                <div style={{ color:C.gray, fontSize:13, marginTop:4, fontFamily:FB }}>Accepts .csv, .xlsx, .xls</div>
                <input type="file" accept=".csv,.xlsx,.xls" style={{ display:"none" }}
                  onChange={e => { doUpload(e.target.files[0]); e.target.value=""; }} />
              </label>
              {boardMembers.length > 0 && (
                <button onClick={doExportBoardMembers} style={{ marginTop:14, width:"100%",
                  padding:"12px", background:C.card2, border:`2px solid ${C.border}`, color:C.white,
                  borderRadius:10, fontFamily:FB, fontSize:15, cursor:"pointer", fontWeight:600, touchAction:"manipulation" }}>
                  ⬇️ Export Board Member List to CSV
                </button>
              )}
            </div>

            <div style={{ background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius, padding:22 }}>
              <div style={{ fontFamily:FC, fontWeight:800, fontSize:22, color:C.gold, marginBottom:4 }}>General Membership List</div>
              <div style={{ color:C.gray, fontSize:14, fontFamily:FB }}>
                Loaded automatically from the member database. No upload needed.
              </div>
            </div>

            <div style={{ background:C.card, border:`2px solid ${C.danger}`, borderRadius:C.radius, padding:22 }}>
              <div style={{ fontFamily:FC, fontWeight:800, fontSize:20, color:C.danger, marginBottom:14 }}>⚠️ Danger Zone</div>
              <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                <button onClick={() => setConfirm({ msg:"Clear ALL attendance records? This cannot be undone.",
                  onYes:() => { setAttendance([]); saveLS(SK.attendance,[]); setConfirm(null); setToast({msg:"Attendance cleared",type:"success"}); }})}
                  style={{ flex:1, minWidth:150, padding:"14px 10px", background:"rgba(184,50,50,.15)",
                    border:`2px solid ${C.danger}`, color:C.danger, borderRadius:10, fontFamily:FB, fontSize:14, cursor:"pointer", fontWeight:600, touchAction:"manipulation" }}>
                  Clear Attendance Records
                </button>
                <button onClick={() => setConfirm({ msg:"Reset ALL data (members + attendance)? Cannot be undone.",
                  onYes:() => {
                    [SK.board,SK.general,SK.attendance].forEach(k => localStorage.removeItem(k));
                    setBoardMembers([]); setGeneralMembers([]); setAttendance([]);
                    setConfirm(null); setToast({msg:"All data reset",type:"success"});
                  }})}
                  style={{ flex:1, minWidth:150, padding:"14px 10px", background:"rgba(184,50,50,.3)",
                    border:`2px solid ${C.danger}`, color:C.danger, borderRadius:10, fontFamily:FB, fontSize:14, cursor:"pointer", fontWeight:600, touchAction:"manipulation" }}>
                  Reset ALL Local Data
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "records" && (
          <>
            <div style={{ background:C.card, border:`2px solid ${C.border}`, borderRadius:C.radius, padding:20 }}>
              <div style={{ fontFamily:FC, fontWeight:800, fontSize:20, color:C.gold, marginBottom:14 }}>Filter Records</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <select value={fType} onChange={e => setFType(e.target.value)} style={IS}>
                  <option value="all">All Meeting Types</option>
                  <option value="board">Board Meeting</option>
                  <option value="general">General Membership</option>
                </select>
                <input placeholder="Filter by date (e.g. 04/13/2026)" value={fDate}
                  onChange={e => setFDate(e.target.value)} style={IS} />
                <input placeholder="Search by member name…" value={fName}
                  onChange={e => setFName(e.target.value)} style={IS} />
              </div>
            </div>

            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
              <div style={{ color:C.gray, fontSize:15, fontFamily:FB }}>{filtered.length} record(s)</div>
              <button onClick={() => exportCSV(filtered.map(r => ({
                "First Name":r.firstName, "Last Name":r.lastName, "Full Name":r.fullName,
                "Meeting Type": r.meetingType==="board" ? "Board Meeting" : "General Membership",
                "Meeting Date":r.meetingDate, "Check-In Timestamp":r.checkInTimestamp,
                "Duplicate Flag": r.duplicateFlag ? "Yes" : "No",
              })), `attendance_${getToday().replace(/\//g,"-")}.csv`)}
                style={{ padding:"12px 22px", background:C.gold, border:"none", borderRadius:10,
                  fontFamily:FB, fontWeight:700, fontSize:15, cursor:"pointer", color:C.bg, touchAction:"manipulation" }}>
                ⬇️ Export to CSV
              </button>
            </div>

            {filtered.length === 0
              ? <div style={{ textAlign:"center", color:C.gray, padding:40, fontSize:17, fontFamily:FB }}>No records found</div>
              : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {[...filtered].reverse().map(r => (
                    <div key={r.id} style={{
                      background: r.duplicateFlag ? "rgba(212,130,26,.08)" : C.card,
                      border:`2px solid ${r.duplicateFlag ? C.warn : C.border}`,
                      borderRadius:10, padding:"13px 18px",
                      display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                      <div>
                        <div style={{ fontFamily:FC, fontWeight:700, fontSize:21, color:C.white }}>{r.fullName}</div>
                        <div style={{ color:C.gray, fontSize:13, marginTop:2, fontFamily:FB }}>
                          {r.meetingType==="board" ? "Board Meeting" : "General Membership"} · {r.meetingDate}
                        </div>
                        <div style={{ color:"#3a5070", fontSize:12, fontFamily:FB }}>{r.checkInTimestamp}</div>
                      </div>
                      {r.duplicateFlag && (
                        <div style={{ background:C.warn, color:"#000", borderRadius:20,
                          padding:"4px 12px", fontSize:12, fontWeight:700, fontFamily:FB }}>DUPLICATE</div>
                      )}
                    </div>
                  ))}
                </div>
              )
            }
          </>
        )}
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      {confirm && <ConfirmDialog msg={confirm.msg} onYes={confirm.onYes} onNo={() => setConfirm(null)} />}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("home");
  const [boardMembers, setBoardMembers] = useState(() => loadLS(SK.board) || []);
  const [generalMembers, setGeneralMembers] = useState(() => loadLS(SK.general) || []);
  const [generalApiState, setGeneralApiState] = useState("idle");

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function load() {
      setGeneralApiState("loading");
      try {
        const res = await fetch("/attendance/members");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "loading") {
          setGeneralApiState("server-loading");
          timer = setTimeout(load, 6000);
          return;
        }
        setGeneralMembers(data.members);
        saveLS(SK.general, data.members);
        setGeneralApiState("ready");
      } catch {
        if (cancelled) return;
        const cached = loadLS(SK.general);
        if (cached?.length) {
          setGeneralMembers(cached);
          setGeneralApiState("ready");
        } else {
          setGeneralApiState("error");
        }
      }
    }

    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  if (screen === "board")
    return <AttendanceScreen mode="board" members={boardMembers} onBack={() => setScreen("home")} />;
  if (screen === "general")
    return <AttendanceScreen mode="general" members={generalMembers} onBack={() => setScreen("home")} />;
  if (screen === "admin")
    return <AdminScreen
      boardMembers={boardMembers} setBoardMembers={setBoardMembers}
      onBack={() => setScreen("home")} />;
  if (screen === "drawing")
    return <DrawingScreen onBack={() => setScreen("home")} />;

  return <HomeScreen
    boardCount={boardMembers.length}
    generalCount={generalMembers.length}
    generalApiState={generalApiState}
    onNav={setScreen} />;
}
