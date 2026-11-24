import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Copy, FileText, NotebookPen, RotateCcw, Sparkles, Square, SquarePen } from "lucide-react";
import { notesApi, resetChat, streamChat } from "../api";
import "./chat.css";

export type ChatMessage = {
  id: string;
  sender: "user" | "bot";
  text: string;
  streaming?: boolean;
  error?: boolean;
};

export const newMessageId = () => Math.random().toString(36).slice(2, 10);

type Props = {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeDocuments: string[];
  learningStyle?: string | null;
};

const CodeBlock: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className, children }) => {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || "")?.[1];
  const code = String(children ?? "").replace(/\n$/, "");
  const isBlock = Boolean(language) || code.includes("\n");

  if (!isBlock) return <code className="ch-inline-code">{children}</code>;

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="ch-code">
      <div className="ch-code-bar">
        <span>{language || "text"}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
};

const markdownComponents = {
  code: CodeBlock as any,
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="ch-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

const Markdown: React.FC<{ text: string }> = React.memo(({ text }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
    {text}
  </ReactMarkdown>
));

const MessageActions: React.FC<{ text: string; question?: string; onRetry?: () => void }> = ({ text, question, onRetry }) => {
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  const saveToNotes = async () => {
    if (saveState === "saving" || saveState === "saved") return;
    setSaveState("saving");
    try {
      const title = (question || "Saved from chat").replace(/\s+/g, " ").trim().slice(0, 80);
      await notesApi.create({ title, body: text, source: "chat" });
      setSaveState("saved");
    } catch {
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), 2500);
    }
  };
  const saveLabel =
    saveState === "saved" ? "Saved to Notes" : saveState === "error" ? "Couldn't save. Try again" : "Save to Notes";
  return (
    <div className="ch-actions">
      <button type="button" onClick={copy} aria-label="Copy answer" title="Copy">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button
        type="button"
        onClick={saveToNotes}
        aria-label={saveLabel}
        title={saveLabel}
        className={saveState === "saved" ? "is-done" : saveState === "error" ? "is-error" : ""}
      >
        {saveState === "saved" ? <Check size={15} /> : <NotebookPen size={15} />}
        {(saveState === "saved" || saveState === "error") && <span>{saveLabel}</span>}
      </button>
      {onRetry && (
        <button type="button" onClick={onRetry} aria-label="Retry" title="Retry">
          <RotateCcw size={15} />
        </button>
      )}
    </div>
  );
};

const ChatView: React.FC<Props> = ({ messages, setMessages, activeDocuments, learningStyle }) => {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  // Follow the answer as it streams, unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Grow the composer with its content, up to a limit.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || isStreaming) return;

      const botId = newMessageId();
      stickToBottom.current = true;
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), sender: "user", text },
        { id: botId, sender: "bot", text: "", streaming: true },
      ]);
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === botId ? fn(m) : m)));

      try {
        await streamChat(
          { message: text, active_documents: activeDocuments, learning_style: learningStyle },
          (chunk) => patch((m) => ({ ...m, text: m.text + chunk })),
          controller.signal,
        );
        patch((m) => ({ ...m, streaming: false }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          patch((m) => ({ ...m, streaming: false, text: m.text || "_Stopped._" }));
        } else {
          patch((m) => ({ ...m, streaming: false, error: true, text: (error as Error).message }));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        textareaRef.current?.focus();
      }
    },
    [activeDocuments, isStreaming, learningStyle, setMessages],
  );

  const send = () => {
    const text = input;
    setInput("");
    ask(text);
  };

  const retry = (botIndex: number) => {
    const question = [...messages.slice(0, botIndex)].reverse().find((m) => m.sender === "user");
    if (!question) return;
    // Drop the old question/answer pair, then ask again.
    setMessages((prev) => prev.slice(0, botIndex - 1));
    ask(question.text);
  };

  const newChat = async () => {
    abortRef.current?.abort();
    setMessages([]);
    await resetChat();
    textareaRef.current?.focus();
  };

  const docLabel =
    activeDocuments.length === 0
      ? "General knowledge"
      : activeDocuments.length === 1
        ? activeDocuments[0]
        : `${activeDocuments.length} sources`;

  const suggestions = activeDocuments.length
    ? [
        "Summarize the key ideas in plain language",
        "Quiz me with 3 questions on this material",
        "Explain the hardest concept with an analogy",
      ]
    : [
        "Make me a 30-minute study plan for tonight",
        "Explain spaced repetition and how to use it",
        "How do I take better lecture notes?",
      ];

  const lastBotIndex = messages.map((m) => m.sender).lastIndexOf("bot");

  return (
    <div className="ch">
      <div className="ch-scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="ch-empty">
            <div className="ch-mark" aria-hidden="true">
              <Sparkles size={22} />
            </div>
            <h2>What are we learning today?</h2>
            <p>
              Ask anything. {activeDocuments.length > 0
                ? "Answers draw on your selected sources and cite the page."
                : "Add a PDF in Sources to get answers grounded in your own material."}
            </p>
            <div className="ch-suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ch-thread">
            {messages.map((m, i) =>
              m.sender === "user" ? (
                <div key={m.id} className="ch-user">
                  <div className="ch-user-bubble">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className={`ch-bot${m.error ? " is-error" : ""}`}>
                  <div className="ch-avatar" aria-hidden="true">
                    <Sparkles size={15} />
                  </div>
                  <div className="ch-bot-body">
                    {m.streaming && !m.text ? (
                      <div className="ch-thinking" aria-label="Kimi is thinking">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      <div className={`ch-prose${m.streaming ? " is-streaming" : ""}`}>
                        <Markdown text={m.text} />
                      </div>
                    )}
                    {!m.streaming && m.text && !m.error && (
                      <MessageActions
                        text={m.text}
                        question={messages[i - 1]?.sender === "user" ? messages[i - 1].text : undefined}
                        onRetry={i === lastBotIndex && i > 0 && messages[i - 1]?.sender === "user" ? () => retry(i) : undefined}
                      />
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="ch-composer-wrap">
        <form
          className="ch-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            placeholder="Ask Kimi about your material…"
            aria-label="Message"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="ch-composer-bar">
            <span className="ch-source" title={activeDocuments.join(", ") || "No sources selected"}>
              <FileText size={14} />
              <span>{docLabel}</span>
            </span>
            <div className="ch-composer-buttons">
              {messages.length > 0 && (
                <button type="button" className="ch-ghost" onClick={newChat} title="New chat" aria-label="New chat">
                  <SquarePen size={16} />
                </button>
              )}
              {isStreaming ? (
                <button type="button" className="ch-send is-stop" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button type="submit" className="ch-send" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp size={17} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="ch-footnote">Kimi can make mistakes. Check important facts against your sources.</p>
      </div>
    </div>
  );
};

export default ChatView;
