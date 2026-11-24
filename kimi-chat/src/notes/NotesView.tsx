import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen, Check, CircleAlert, Copy, Eye, FilePlus2, GraduationCap, Layers, ListChecks, Loader2,
  MessageSquare, NotebookPen, PenLine, Search, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { Note, NoteAction, notesApi } from "../api";
import "./notes.css";

type SaveState = "saved" | "saving" | "unsaved" | "error";

const ACTIONS: { key: NoteAction; label: string; icon: React.ReactNode }[] = [
  { key: "summarize", label: "Summarize", icon: <ListChecks size={14} /> },
  { key: "explain", label: "Explain simply", icon: <GraduationCap size={14} /> },
  { key: "key_terms", label: "Key terms", icon: <BookOpen size={14} /> },
  { key: "flashcards", label: "Flashcards", icon: <Layers size={14} /> },
  { key: "quiz", label: "Quiz me", icon: <Sparkles size={14} /> },
  { key: "improve", label: "Tidy up", icon: <Wand2 size={14} /> },
];

const ACTION_TITLES: Record<NoteAction, string> = {
  summarize: "Summary",
  explain: "Simple explanation",
  key_terms: "Key terms",
  flashcards: "Flashcards",
  quiz: "Quiz",
  improve: "Tidied version",
};

function relativeTime(ms: number) {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const snippet = (body: string) =>
  body.replace(/[#*_>`~-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "No content yet";

const NotesView: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [assist, setAssist] = useState<{
    action: NoteAction; status: "loading" | "done" | "error"; result: string; usedSelection: boolean; range: { start: number; end: number };
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Map<string, { title: string; body: string }>>(new Map());
  const saveTimer = useRef<number | undefined>(undefined);
  const assistAbort = useRef<AbortController | null>(null);

  const selected = notes.find((n) => n.id === selectedId) || null;

  // ---------- Loading ----------
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const list = await notesApi.list();
      setNotes(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- Saving ----------
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const entries = Array.from(pending.current.entries());
    if (!entries.length) return;
    pending.current.clear();
    setSaveState("saving");
    try {
      await Promise.all(entries.map(([id, data]) => notesApi.update(id, data)));
      setSaveState(pending.current.size ? "unsaved" : "saved");
    } catch {
      // Put the changes back so a retry sends them again.
      entries.forEach(([id, data]) => {
        if (!pending.current.has(id)) pending.current.set(id, data);
      });
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("unsaved");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 700);
  }, [flush]);

  // Save on unmount and before the tab closes.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      flush();
    };
  }, [flush]);

  const edit = (changes: Partial<Pick<Note, "title" | "body">>) => {
    if (!selected) return;
    const next = { ...selected, ...changes, updatedAt: Date.now() };
    setNotes((prev) => [next, ...prev.filter((n) => n.id !== next.id)]);
    pending.current.set(next.id, { title: next.title, body: next.body });
    scheduleSave();
  };

  // ---------- Note actions ----------
  const selectNote = (id: string) => {
    if (id === selectedId) return;
    flush();
    setSelectedId(id);
    setConfirmDelete(false);
    setAssist(null);
    setSelection({ start: 0, end: 0 });
  };

  const newNote = async (init?: { title?: string; body?: string }) => {
    await flush();
    try {
      const note = await notesApi.create({ title: init?.title ?? "", body: init?.body ?? "" });
      setNotes((prev) => [note, ...prev]);
      setSelectedId(note.id);
      setMode("write");
      setAssist(null);
      setQuery("");
      window.setTimeout(() => titleRef.current?.focus(), 30);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  const removeNote = async () => {
    if (!selected) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const id = selected.id;
    pending.current.delete(id);
    try {
      await notesApi.remove(id);
      const rest = notes.filter((n) => n.id !== id);
      setNotes(rest);
      setSelectedId(rest[0]?.id ?? null);
      setConfirmDelete(false);
      setAssist(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  // ---------- AI helpers ----------
  const trackSelection = () => {
    const ta = bodyRef.current;
    if (ta) setSelection({ start: ta.selectionStart, end: ta.selectionEnd });
  };
  const hasSelection = mode === "write" && selection.end > selection.start;

  const runAssist = async (action: NoteAction) => {
    if (!selected) return;
    const usedSelection = hasSelection;
    const text = usedSelection ? selected.body.slice(selection.start, selection.end) : selected.body;
    if (!text.trim()) {
      setAssist({ action, status: "error", result: "Write something in this note first.", usedSelection, range: selection });
      return;
    }
    assistAbort.current?.abort();
    const controller = new AbortController();
    assistAbort.current = controller;
    setAssist({ action, status: "loading", result: "", usedSelection, range: { ...selection } });
    try {
      const result = await notesApi.assist(text, action, controller.signal);
      setAssist((a) => (a && a.action === action ? { ...a, status: "done", result } : a));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setAssist((a) => (a ? { ...a, status: "error", result: (e as Error).message } : a));
    }
  };

  const insertResult = (how: "below" | "replace") => {
    if (!selected || !assist || assist.status !== "done") return;
    const body = selected.body;
    const heading = `### ${ACTION_TITLES[assist.action]}\n\n`;
    let next: string;
    let caret: number;
    if (how === "replace") {
      if (assist.usedSelection) {
        next = body.slice(0, assist.range.start) + assist.result + body.slice(assist.range.end);
        caret = assist.range.start + assist.result.length;
      } else {
        next = assist.result;
        caret = next.length;
      }
    } else {
      const at = assist.usedSelection ? assist.range.end : body.length;
      const block = `\n\n${heading}${assist.result}\n`;
      next = body.slice(0, at).replace(/\s+$/, "") + block + body.slice(at).replace(/^\s+/, assist.usedSelection ? "\n" : "");
      caret = at + block.length;
    }
    edit({ body: next });
    setAssist(null);
    setMode("write");
    window.setTimeout(() => {
      const ta = bodyRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    }, 30);
  };

  const copyResult = () => {
    if (!assist) return;
    navigator.clipboard.writeText(assist.result).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // ---------- Keyboard ----------
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flush();
    }
  };

  // ---------- Derived ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  }, [notes, query]);

  const words = selected ? (selected.body.trim().match(/\S+/g)?.length ?? 0) : 0;

  const saveLabel =
    saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved changes" : saveState === "error" ? "Couldn't save" : "Saved";

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="nt-state">
        <Loader2 size={22} className="nt-spin" />
        <p>Loading your notes…</p>
      </div>
    );
  }

  if (loadError && !notes.length) {
    return (
      <div className="nt-state">
        <CircleAlert size={24} />
        <h3>Couldn't load your notes</h3>
        <p>{loadError}</p>
        <button type="button" className="nt-primary" onClick={load}>Try again</button>
      </div>
    );
  }

  return (
    <div className="nt-wrap">
    <div className="nt">
      <aside className="nt-list" aria-label="Your notes">
        <div className="nt-list-top">
          <label className="nt-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
          </label>
          <button type="button" className="nt-new" onClick={() => newNote()} aria-label="New note" title="New note">
            <FilePlus2 size={16} />
          </button>
        </div>
        {notes.length === 0 ? (
          <div className="nt-list-empty">
            <p>No notes yet.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="nt-list-empty">
            <p>No notes match "{query}".</p>
          </div>
        ) : (
          <ul>
            {filtered.map((n) => (
              <li key={n.id}>
                <button type="button" className={`nt-item${n.id === selectedId ? " is-active" : ""}`} onClick={() => selectNote(n.id)}>
                  <span className="nt-item-title">
                    {n.source === "chat" && <MessageSquare size={12} aria-label="Saved from chat" />}
                    {n.title || "Untitled note"}
                  </span>
                  <span className="nt-item-snippet">{snippet(n.body)}</span>
                  <span className="nt-item-time">{relativeTime(n.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {!selected ? (
        <section className="nt-empty">
          <NotebookPen size={30} strokeWidth={1.6} />
          <h3>Start your first note</h3>
          <p>Write lecture notes, paste a passage, or save answers from chat. Kimi can summarize them, explain them simply, or turn them into flashcards.</p>
          <button type="button" className="nt-primary" onClick={() => newNote()}>
            <FilePlus2 size={16} /> New note
          </button>
        </section>
      ) : (
        <section className="nt-editor" onKeyDown={onEditorKeyDown}>
          <header className="nt-editor-top">
            <div className="nt-editor-tools">
              <span className={`nt-save is-${saveState}`} role="status">
                {saveState === "saving" && <Loader2 size={12} className="nt-spin" />}
                {saveState === "saved" && <Check size={12} />}
                {saveState === "error" && <CircleAlert size={12} />}
                {saveLabel}
                {saveState === "error" && (
                  <button type="button" onClick={flush}>Retry</button>
                )}
              </span>
              <div className="nt-seg" role="tablist" aria-label="Editor mode">
                <button type="button" role="tab" aria-selected={mode === "write"} className={mode === "write" ? "is-on" : ""} onClick={() => setMode("write")}>
                  <PenLine size={13} /> Write
                </button>
                <button type="button" role="tab" aria-selected={mode === "preview"} className={mode === "preview" ? "is-on" : ""} onClick={() => setMode("preview")}>
                  <Eye size={13} /> Preview
                </button>
              </div>
              <button
                type="button"
                className={`nt-delete${confirmDelete ? " is-confirm" : ""}`}
                onClick={removeNote}
                onBlur={() => setConfirmDelete(false)}
                aria-label={confirmDelete ? "Confirm delete note" : "Delete note"}
                title="Delete note"
              >
                <Trash2 size={15} />
                {confirmDelete && <span>Delete?</span>}
              </button>
            </div>
            <input
              ref={titleRef}
              className="nt-title"
              value={selected.title}
              onChange={(e) => edit({ title: e.target.value })}
              placeholder="Untitled note"
              aria-label="Note title"
            />
          </header>

          <div className="nt-ai-bar">
            <span className="nt-ai-label">
              <Sparkles size={13} /> {hasSelection ? "Use selection:" : "Use note:"}
            </span>
            <div className="nt-ai-actions">
              {ACTIONS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onMouseDown={(e) => e.preventDefault() /* keep the text selection */}
                  onClick={() => runAssist(a.key)}
                  disabled={assist?.status === "loading"}
                  className={assist?.action === a.key ? "is-current" : ""}
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="nt-body">
            {mode === "write" ? (
              <textarea
                ref={bodyRef}
                className="nt-textarea"
                value={selected.body}
                onChange={(e) => {
                  edit({ body: e.target.value });
                  trackSelection();
                }}
                onSelect={trackSelection}
                onKeyUp={trackSelection}
                onMouseUp={trackSelection}
                placeholder={"Start typing…\n\nMarkdown works here: # Heading, - bullet, **bold**, `code`.\nHighlight any part and pick an action above to summarize or explain just that bit."}
                aria-label="Note text"
              />
            ) : (
              <div className="nt-preview">
                {selected.body.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.body}</ReactMarkdown>
                ) : (
                  <p className="nt-muted">Nothing to preview yet.</p>
                )}
              </div>
            )}

            {assist && (
              <div className={`nt-assist is-${assist.status}`} role="region" aria-label={ACTION_TITLES[assist.action]}>
                <div className="nt-assist-head">
                  <span>
                    <Sparkles size={13} /> {ACTION_TITLES[assist.action]}
                    <em>{assist.usedSelection ? "of your selection" : "of this note"}</em>
                  </span>
                  <button type="button" onClick={() => { assistAbort.current?.abort(); setAssist(null); }} aria-label="Close">
                    <X size={15} />
                  </button>
                </div>
                <div className="nt-assist-body">
                  {assist.status === "loading" ? (
                    <div className="nt-assist-loading">
                      <span /><span /><span />
                    </div>
                  ) : assist.status === "error" ? (
                    <p className="nt-assist-error">{assist.result}</p>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{assist.result}</ReactMarkdown>
                  )}
                </div>
                {assist.status === "done" && (
                  <div className="nt-assist-actions">
                    <button type="button" className="nt-primary small" onClick={() => insertResult("below")}>
                      {assist.usedSelection ? "Insert after selection" : "Add to note"}
                    </button>
                    {assist.action === "improve" && (
                      <button type="button" className="nt-ghost" onClick={() => insertResult("replace")}>
                        {assist.usedSelection ? "Replace selection" : "Replace note"}
                      </button>
                    )}
                    <button type="button" className="nt-ghost" onClick={copyResult}>
                      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className="nt-foot">
            <span>{words} {words === 1 ? "word" : "words"}</span>
            <span>Edited {relativeTime(selected.updatedAt)}</span>
            <span className="nt-foot-hint">Ctrl+S saves now · notes save automatically</span>
          </footer>
        </section>
      )}
    </div>
    </div>
  );
};

export default NotesView;
