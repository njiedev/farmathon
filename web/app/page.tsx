"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Camera, Check, CloudRain, Leaf, MapPin, Mic, MicOff, Settings2, Sprout, Sun, Thermometer, WifiOff, Wind, X } from "lucide-react";

type Profile = { farmName: string; location: string; crop: string; acres: number };
type Weather = { location: string; current: { temperatureF: number; humidity: number; windMph: number }; daily: Array<{ date: string; highF: number; lowF: number; precipitationChance: number }>; alerts: string[] };
type Diagnosis = { display_name: string; confidence: number; uncertain: boolean; guidance: string; scores: Array<{ display_name: string; confidence: number }>; model_scope: string };
type Message = { id: string; role: "user" | "assistant"; text: string; weather?: Weather; diagnosis?: Diagnosis; image?: string };

const defaultProfile: Profile = { farmName: "North Forty", location: "Champaign, Illinois", crop: "corn", acres: 320 };
const starter: Message[] = [{ id: "welcome", role: "assistant", text: "Morning. I’m watching the field conditions and your corn profile. Ask what needs attention, or send a leaf photo for a model check." }];

function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => { const stored = localStorage.getItem(key); if (stored) setValue(JSON.parse(stored) as T); }, [key]);
  const update = (next: T) => { setValue(next); localStorage.setItem(key, JSON.stringify(next)); };
  return [value, update];
}

export default function Home() {
  const [profile, setProfile] = useStoredState<Profile>("fieldhand-profile", defaultProfile);
  const [messages, setMessages] = useStoredState<Message[]>("fieldhand-messages", starter);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [online, setOnline] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const latestWeather = useMemo(() => [...messages].reverse().find((item) => item.weather)?.weather, [messages]);
  const latestDiagnosis = useMemo(() => [...messages].reverse().find((item) => item.diagnosis)?.diagnosis, [messages]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    addEventListener("online", update); addEventListener("offline", update);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, []);

  async function ask(text = input, diagnosis?: Diagnosis, image?: string) {
    if (!text.trim() || busy) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", text, ...(image ? { image } : {}) };
    const next = [...messages, userMessage]; setMessages(next); setInput(""); setBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: localStorage.getItem("fieldhand-session") ?? "demo-session", message: text, profile, ...(diagnosis ? { diagnosis } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Agent request failed");
      setMessages([...next, { id: crypto.randomUUID(), role: "assistant", text: data.message, ...(data.weather ? { weather: data.weather } : {}), ...(data.diagnosis ? { diagnosis: data.diagnosis } : {}) }]);
    } catch (error) {
      setMessages([...next, { id: crypto.randomUUID(), role: "assistant", text: online ? `I couldn’t reach the agent: ${error instanceof Error ? error.message : "Unknown error"}` : "You’re offline. Your last field results are still available in the right rail." }]);
    } finally { setBusy(false); }
  }

  async function upload(file?: File) {
    if (!file) return;
    const preview = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Image preview could not be read"));
      reader.readAsDataURL(file);
    });
    setBusy(true);
    try {
      const form = new FormData(); form.append("image", file);
      const response = await fetch("/api/diagnose", { method: "POST", body: form });
      const diagnosis = await response.json() as Diagnosis & { error?: string };
      if (!response.ok) throw new Error(diagnosis.error ?? "Diagnosis failed");
      await ask("Check this corn leaf and tell me what you see.", diagnosis, preview);
    } catch (error) {
      setMessages([...messages, { id: crypto.randomUUID(), role: "assistant", text: `I couldn’t inspect that image: ${error instanceof Error ? error.message : "Unknown error"}` }]);
      setBusy(false);
    }
  }

  function toggleVoice() {
    const SpeechRecognition = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; start(): void; stop(): void; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onend: () => void } }).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition(); recognition.lang = "en-US";
    recognition.onresult = (event) => setInput(event.results[0]?.[0].transcript ?? "");
    recognition.onend = () => setListening(false);
    setListening(true); recognition.start();
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Leaf size={20}/></span><span>Fieldhand</span></div>
      <nav><button className="nav-active"><Sprout size={18}/>Field desk</button><button onClick={() => setProfileOpen(true)}><Settings2 size={18}/>Farm profile</button></nav>
      <div className="farm-mini"><span className="status-dot"/><div><strong>{profile.farmName}</strong><small><MapPin size={12}/>{profile.location}</small></div></div>
    </aside>

    <section className="workspace">
      <header className="hero">
        <img src="/assets/corn-field-hero.png" alt="Farmer inspecting a corn field at golden hour"/>
        <div className="hero-shade"/><div className="hero-top"><div><span className="eyebrow">FIELD INTELLIGENCE</span><h1>A capable hand,<br/><em>already in the field.</em></h1></div><button className="profile-button" onClick={() => setProfileOpen(true)}><Settings2 size={17}/> Edit farm</button></div>
        <div className="hero-status"><span><MapPin size={15}/>{profile.location}</span><span><Sprout size={15}/>{profile.acres} acres · {profile.crop}</span>{!online && <span className="offline"><WifiOff size={15}/>Offline cache</span>}</div>
      </header>

      <div className="content-grid">
        <section className="conversation">
          <div className="section-heading"><div><span className="eyebrow dark">FIELD DESK</span><h2>What needs attention?</h2></div><span className="live"><i/>Session memory on</span></div>
          <div className="quick-actions"><button onClick={() => ask("What does the weather mean for my field today?")}><Sun size={16}/>Today’s field plan</button><button onClick={() => ask("Should I irrigate this week?")}><CloudRain size={16}/>Irrigation check</button><button onClick={() => fileRef.current?.click()}><Camera size={16}/>Inspect a leaf</button></div>
          <div className="messages">
            {messages.map((message) => <article key={message.id} className={`message ${message.role}`}>
              {message.image && <img className="message-image" src={message.image} alt="Uploaded corn leaf"/>}
              <p>{message.text}</p>
              {message.diagnosis && <div className={`diagnosis-inline ${message.diagnosis.uncertain ? "uncertain" : ""}`}><span>{message.diagnosis.uncertain ? <AlertTriangle size={16}/> : <Check size={16}/>} {message.diagnosis.display_name}</span><strong>{Math.round(message.diagnosis.confidence * 100)}%</strong></div>}
            </article>)}
            {busy && <article className="message assistant typing"><i/><i/><i/></article>}
          </div>
          <div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask about this field…" rows={1}/><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void upload(event.target.files?.[0])}/><button title="Upload leaf photo" onClick={() => fileRef.current?.click()}><Camera size={19}/></button><button title="Voice input" onClick={toggleVoice}>{listening ? <MicOff size={19}/> : <Mic size={19}/>}</button><button className="send" title="Send" disabled={!input.trim() || busy} onClick={() => void ask()}><ArrowUp size={19}/></button></div>
        </section>

        <aside className="insights">
          <div className="section-heading compact"><div><span className="eyebrow dark">LIVE CONTEXT</span><h2>Field signals</h2></div></div>
          {latestWeather ? <div className="weather-block"><div className="weather-now"><span><Sun size={24}/></span><div><strong>{Math.round(latestWeather.current.temperatureF)}°</strong><small>{latestWeather.location}</small></div></div><div className="conditions"><span><Wind size={15}/>{Math.round(latestWeather.current.windMph)} mph</span><span><CloudRain size={15}/>{latestWeather.current.humidity}% RH</span></div><div className="forecast">{latestWeather.daily.slice(0,5).map((day) => <div key={day.date}><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString("en", { weekday: "short" })}</small><Sun size={16}/><strong>{Math.round(day.highF)}°</strong><span>{day.precipitationChance}%</span></div>)}</div></div> : <button className="empty-signal" onClick={() => ask("What does the weather mean for my field today?")}><Thermometer size={22}/><span><strong>Check field conditions</strong><small>Live Open-Meteo forecast</small></span></button>}
          {(latestWeather?.alerts ?? []).map((alert) => <div className="alert" key={alert}><AlertTriangle size={18}/><div><strong>Heads up</strong><p>{alert}</p></div></div>)}
          {latestDiagnosis && <div className="diagnosis-card"><div className="card-label"><Leaf size={16}/>LATEST MODEL CHECK</div><div className="diagnosis-title"><div><strong>{latestDiagnosis.display_name}</strong><small>{latestDiagnosis.uncertain ? "Needs another photo" : "High-confidence screen"}</small></div><b>{Math.round(latestDiagnosis.confidence * 100)}%</b></div><div className="score-bars">{latestDiagnosis.scores.map((score) => <div key={score.display_name}><span>{score.display_name}</span><i><b style={{ width: `${score.confidence * 100}%` }}/></i></div>)}</div><p>{latestDiagnosis.model_scope}</p></div>}
          <div className="profile-summary"><div className="card-label"><Sprout size={16}/>FARM MEMORY</div><dl><div><dt>Crop</dt><dd>{profile.crop}</dd></div><div><dt>Field</dt><dd>{profile.acres} acres</dd></div><div><dt>Location</dt><dd>{profile.location}</dd></div></dl></div>
        </aside>
      </div>
    </section>

    {profileOpen && <div className="modal-backdrop" onMouseDown={() => setProfileOpen(false)}><section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setProfileOpen(false)}><X size={20}/></button><span className="eyebrow dark">FARM PROFILE</span><h2>Context that stays useful.</h2><label>Farm name<input value={profile.farmName} onChange={(event) => setProfile({ ...profile, farmName: event.target.value })}/></label><label>Location<input value={profile.location} onChange={(event) => setProfile({ ...profile, location: event.target.value })}/></label><div className="field-row"><label>Primary crop<input value={profile.crop} onChange={(event) => setProfile({ ...profile, crop: event.target.value })}/></label><label>Acres<input type="number" value={profile.acres} onChange={(event) => setProfile({ ...profile, acres: Number(event.target.value) })}/></label></div><button className="save-profile" onClick={() => setProfileOpen(false)}><Check size={18}/>Save context</button></section></div>}
  </main>;
}
