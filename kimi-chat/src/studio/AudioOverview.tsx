import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Headphones, Loader2, Pause, Play, RefreshCw, SkipBack, SkipForward, X } from "lucide-react";
import { AudioScript, docsKey, generateAudioScript, store } from "../api";
import "./studio.css";

type Props = { documents: string[]; onClose: () => void };

const SPEEDS = [0.8, 1, 1.2, 1.4];
const FEMALE = /(zira|aria|jenny|samantha|susan|hazel|libby|sonia|female|catherine|karen|moira|tessa|victoria|emma|ava|allison)/i;
const MALE = /(david|guy|mark|george|ryan|daniel|alex|fred|male|james|thomas|christopher|eric|brian|tom)/i;

function pickVoices(): { maya: SpeechSynthesisVoice | null; leo: SpeechSynthesisVoice | null } {
  const all = window.speechSynthesis?.getVoices() ?? [];
  const english = all.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = english.length ? english : all;
  // Prefer the higher-quality "Natural"/"Online" voices when the browser offers them.
  const rank = (v: SpeechSynthesisVoice) => (/natural|online|neural|premium|enhanced/i.test(v.name) ? 0 : 1);
  const sorted = [...pool].sort((a, b) => rank(a) - rank(b));
  const maya = sorted.find((v) => FEMALE.test(v.name)) ?? sorted[0] ?? null;
  const leo = sorted.find((v) => MALE.test(v.name) && v !== maya) ?? sorted.find((v) => v !== maya) ?? maya;
  return { maya, leo };
}

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const AudioOverview: React.FC<Props> = ({ documents, onClose }) => {
  const cacheKey = docsKey("audioOverview", documents);
  const [script, setScript] = useState<AudioScript | null>(() => store.get<AudioScript>(cacheKey));
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [voices, setVoices] = useState(pickVoices);
  const playingRef = useRef(false);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  // Voices load asynchronously in Chromium.
  useEffect(() => {
    if (!supported) return;
    const update = () => setVoices(pickVoices());
    window.speechSynthesis.addEventListener("voiceschanged", update);
    update();
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, [supported]);

  // Reload the cached script when the selected sources change.
  useEffect(() => {
    window.speechSynthesis?.cancel();
    playingRef.current = false;
    setPlaying(false);
    setIndex(0);
    setScript(store.get<AudioScript>(cacheKey));
  }, [cacheKey]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const wordCounts = useMemo(() => script?.segments.map((s) => s.text.split(/\s+/).length) ?? [], [script]);
  const totalSeconds = useMemo(() => wordCounts.reduce((a, b) => a + b, 0) / 2.6 / speed, [wordCounts, speed]);
  const elapsedSeconds = useMemo(() => wordCounts.slice(0, index).reduce((a, b) => a + b, 0) / 2.6 / speed, [wordCounts, index, speed]);

  const speak = useCallback(
    (i: number) => {
      if (!script || !supported) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      if (i >= script.segments.length) {
        playingRef.current = false;
        setPlaying(false);
        setIndex(0);
        return;
      }
      setIndex(i);
      const segment = script.segments[i];
      const utterance = new SpeechSynthesisUtterance(segment.text);
      const voice = segment.speaker === "Maya" ? voices.maya : voices.leo;
      if (voice) utterance.voice = voice;
      utterance.rate = speed;
      // Keep the two hosts distinct even if only one voice is installed.
      utterance.pitch = segment.speaker === "Maya" ? 1.08 : voices.leo === voices.maya ? 0.82 : 0.96;
      utterance.onend = () => {
        if (playingRef.current) speak(i + 1);
      };
      utterance.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") {
          playingRef.current = false;
          setPlaying(false);
        }
      };
      synth.speak(utterance);
    },
    [script, speed, supported, voices],
  );

  // Keep the spoken line in view.
  useEffect(() => {
    const el = transcriptRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [index]);

  const play = () => {
    playingRef.current = true;
    setPlaying(true);
    speak(index);
  };
  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    window.speechSynthesis.cancel();
  };
  const jump = (i: number) => {
    if (!script) return;
    const next = Math.max(0, Math.min(script.segments.length - 1, i));
    if (playingRef.current) speak(next);
    else setIndex(next);
  };
  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
  };
  // Apply a new speed to the line being read.
  useEffect(() => {
    if (playingRef.current) speak(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  const generate = async () => {
    pause();
    setStatus("loading");
    setError("");
    try {
      const result = await generateAudioScript(documents);
      setScript(result);
      setIndex(0);
      store.set(cacheKey, result);
      setStatus("idle");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  };

  const downloadTranscript = () => {
    if (!script) return;
    const body = `${script.title}\n\n${script.segments.map((s) => `${s.speaker}: ${s.text}`).join("\n\n")}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${script.title.replace(/[^\w\- ]+/g, "").trim() || "audio-overview"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const progress = script ? (index / Math.max(1, script.segments.length - 1)) * 100 : 0;

  return (
    <section className="st-panel" aria-label="Audio overview">
      <header className="st-panel-head">
        <div className="st-panel-title">
          <Headphones size={17} />
          <h3>Audio overview</h3>
        </div>
        <button type="button" className="st-icon-btn" onClick={() => { pause(); onClose(); }} aria-label="Close audio overview">
          <X size={16} />
        </button>
      </header>

      {!supported && <p className="st-error">This browser can't speak text aloud. Try Chrome or Edge.</p>}

      {documents.length === 0 ? (
        <p className="st-hint">Select at least one source on the left, then generate a two-host audio walkthrough of it.</p>
      ) : status === "loading" ? (
        <div className="st-loading">
          <Loader2 size={20} className="st-spin" />
          <div>
            <strong>Writing the episode…</strong>
            <span>Maya and Leo are reading {documents.length === 1 ? documents[0] : `${documents.length} sources`}. This takes about 30 seconds.</span>
          </div>
        </div>
      ) : !script ? (
        <div className="st-start">
          <p>A 3–4 minute conversation between two hosts that walks through the key ideas of your sources and ends with a recap.</p>
          <button type="button" className="st-primary" onClick={generate}>
            <Headphones size={16} /> Generate audio overview
          </button>
          {status === "error" && <p className="st-error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="au-player">
            <p className="au-title">{script.title}</p>
            <div className="au-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
              <span style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            <div className="au-times">
              <span>{formatTime(elapsedSeconds)}</span>
              <span>~{formatTime(totalSeconds)}</span>
            </div>
            <div className="au-controls">
              <button type="button" className="st-icon-btn" onClick={changeSpeed} aria-label="Playback speed" title="Playback speed">
                <span className="au-speed">{speed}×</span>
              </button>
              <button type="button" className="st-icon-btn" onClick={() => jump(index - 1)} aria-label="Previous line">
                <SkipBack size={18} />
              </button>
              <button type="button" className="au-play" onClick={playing ? pause : play} aria-label={playing ? "Pause" : "Play"} disabled={!supported}>
                {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
              <button type="button" className="st-icon-btn" onClick={() => jump(index + 1)} aria-label="Next line">
                <SkipForward size={18} />
              </button>
              <button type="button" className="st-icon-btn" onClick={downloadTranscript} aria-label="Download transcript" title="Download transcript">
                <Download size={17} />
              </button>
            </div>
          </div>

          <ol className="au-transcript" ref={transcriptRef}>
            {script.segments.map((s, i) => (
              <li key={i} data-i={i} className={`${i === index ? "is-current" : ""} ${s.speaker === "Leo" ? "is-leo" : "is-maya"}`}>
                <button type="button" onClick={() => jump(i)}>
                  <span className="au-speaker">{s.speaker}</span>
                  <span className="au-line">{s.text}</span>
                </button>
              </li>
            ))}
          </ol>

          <button type="button" className="st-secondary" onClick={generate}>
            <RefreshCw size={14} /> Regenerate
          </button>
        </>
      )}
    </section>
  );
};

export default AudioOverview;
