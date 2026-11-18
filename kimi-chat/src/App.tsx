import React, { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from 'react-markdown';
import {
  BarChart3, Brain, ChevronRight, ClipboardCheck, Ear, Eye, FileText, Hand, Headphones,
  MessageSquare, Network, NotebookPen, Plus, Sparkles, X,
} from "lucide-react";
import TestFeature from './TestFeature';
import ReportsFeature from './ReportsFeature';
import LoadingIndicator from './LoadingIndicator';
import LoginPage from './LoginPage'; // Import the new Login page
import ChatView, { ChatMessage, newMessageId } from './chat/ChatView';
import AudioOverview from './studio/AudioOverview';
import MindMap from './studio/MindMap';

// Types
type Message = ChatMessage;

type Question = {
  question: string;
  options: {
    type: string;
    text: string;
  }[];
};

type AssessmentResult = {
  learning_style: string;
  description: string;
};

type Document = {
  name: string;
  active: boolean;
};

// API Service
const API_BASE_URL = "http://127.0.0.1:8000";


const apiService = {
  chat: async (message: string, activeDocuments: string[], signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/chat/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, active_documents: activeDocuments }),
      signal
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Chat request failed (${response.status})`);
    }
    return response.json();
  },

  getQuestions: async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/assessment/questions`, { signal });
    if (!response.ok) throw new Error("Failed to fetch questions");
    return response.json();
  },

  evaluateAssessment: async (answers: string[], signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/assessment/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
      signal
    });
    if (!response.ok) throw new Error("Assessment evaluation failed");
    return response.json();
  },

  getDocuments: async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/documents`, { signal });
    if (!response.ok) throw new Error("Failed to fetch documents");
    return response.json();
  },

  uploadDocument: async (file: File, signal?: AbortSignal) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE_URL}/upload-document/`, {
      method: "POST",
      body: formData,
      signal
    });
    if (!response.ok) throw new Error("File upload failed");
    return response.json();
  },
  deleteDocument: async (docName: string, signal?: AbortSignal) => {
  const response = await fetch(`${API_BASE_URL}/delete-document/${encodeURIComponent(docName)}`, {
    method: "DELETE",
    signal
  });
  if (!response.ok) throw new Error("Delete request failed");
  return response.json();
},
  generateTest: async (documentChunks: string[], signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/generate-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_chunks: documentChunks }),
      signal,
    });
    if (!response.ok) throw new Error("Failed to generate test");
    return response.json();
  },
  getDailyQuote: async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/quote/daily`, { signal });
    if (!response.ok) throw new Error("Failed to fetch daily quote");
    return response.json();
  },
  // Summarization goes through the backend so the OpenRouter key never reaches the browser.
  summarizeText: async (text: string, signal?: AbortSignal): Promise<string> => {
    const response = await fetch(`${API_BASE_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Summarize request failed: ${errorData.detail || response.statusText}`);
    }
    const data = await response.json();
    return data.summary;
  },
};

// Components
const DocumentItem: React.FC<{
  document: Document;
  onToggle: (docName: string) => void;
  onDelete: (docName: string) => void;
}> = ({ document, onToggle, onDelete }) => (
  <div className="document-item">
    <label className="document-checkbox">
      <input
        type="checkbox"
        checked={document.active}
        onChange={() => onToggle(document.name)}
      />
      <span className="checkmark"></span>
      <FileText size={15} className="document-file-icon" aria-hidden="true" />
      <span className="document-name" title={document.name}>{document.name}</span>
    </label>
    <button
      type="button"
      className="delete-icon"
      onClick={() => onDelete(document.name)}
      aria-label={`Delete ${document.name}`}
      title="Delete source"
    >
      <X size={14} />
    </button>
  </div>
);

const App: React.FC = () => {
  // State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isTakingCompulsoryAssessment, setIsTakingCompulsoryAssessment] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const notesTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentView, setCurrentView] = useState<"chat" | "assessment" | "upload" | "documents" | "test" | "reports" | "mindmap">("chat");
  const [studioPanel, setStudioPanel] = useState<"audio" | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);

  // Load assessment result from localStorage on initial render
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(() => {
    const saved = localStorage.getItem('assessmentResult');
    return saved ? JSON.parse(saved) : null;
  });

  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  // New state for Notes Panel and Daily Quote
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [highlightedText, setHighlightedText] = useState("");
  const [summaryResult, setSummaryResult] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [dailyQuote, setDailyQuote] = useState<string | null>(null);

  // CORRECTED: Moved useMemo to the top level of the component
  const cleanedQuote = useMemo(() => {
    if (!dailyQuote) return null;
    return dailyQuote.replace(/^<s[> ]*/, '').trim();
  }, [dailyQuote]);

  // Effects
  useEffect(() => {
    if (!isAuthenticated) return; // Don't fetch data if not logged in

    const controller = new AbortController();

    const fetchInitialData = async () => {
      // Fetch documents
      try {
        setIsLoading(true);
        const data = await apiService.getDocuments(controller.signal);
        setDocuments(data.documents.map((name: string) => ({ name, active: true })));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error("Error fetching documents:", error);
      } finally {
        setIsLoading(false);
      }

      // Fetch daily quote
      try {
        const today = new Date().toDateString();
        const lastFetchInfo = localStorage.getItem('dailyQuoteInfo');
        if (lastFetchInfo) {
          const { date, quote } = JSON.parse(lastFetchInfo);
          if (date === today) {
            setDailyQuote(quote);
            return; // Already have today's quote
          }
        }
        // Fetch a new quote if it's a new day or no quote is stored
        const data = await apiService.getDailyQuote(controller.signal);
        setDailyQuote(data.quote);
        localStorage.setItem('dailyQuoteInfo', JSON.stringify({ date: today, quote: data.quote }));
      } catch (error) {
         if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error("Error fetching daily quote:", error);
          setDailyQuote("The best way to predict the future is to create it."); // Provide a fallback quote
        }
      }
    };

    fetchInitialData();

    return () => {
      controller.abort();
    };
  }, [isAuthenticated]); // Re-run when user logs in

  // Handlers
  const handleLogin = () => {
    setIsAuthenticated(true); // Authenticate first to move past the login screen.
    const storedResult = localStorage.getItem('assessmentResult');
    if (storedResult) {
        setAssessmentResult(JSON.parse(storedResult));
        setIsTakingCompulsoryAssessment(false); // User has a result, no need for compulsory assessment.
        setCurrentView("chat"); // Go to chat.
    } else {
        // Force compulsory assessment for first-time login.
        setIsTakingCompulsoryAssessment(true); // This will trigger the full-screen assessment view.
        startAssessment();
    }
  };

  const getLearnerIcon = (style: string) => {
    switch (style.toLowerCase()) {
        case 'pictorial': return <Eye size={15} />;
        case 'vocal': return <Ear size={15} />;
        case 'kinesthetic': return <Hand size={15} />;
        case 'memorizer': return <Brain size={15} />;
        default: return null;
    }
  };

  const handleDocumentToggle = (docName: string) => {
    setDocuments(prevDocs =>
      prevDocs.map(doc =>
        doc.name === docName ? { ...doc, active: !doc.active } : doc
      )
    );
  };
  const handleDocumentDelete = async (docName: string) => {
  try {
    const controller = new AbortController();
    await apiService.deleteDocument(docName, controller.signal);
    setDocuments(prevDocs => prevDocs.filter(doc => doc.name !== docName));
  } catch (error) {
    console.error("Error deleting document:", error);
  }
};

  const botNote = (text: string, error = false): Message => ({ id: newMessageId(), sender: "bot", text, error });

  const startAssessment = async () => {
    setIsLoading(true);
    // Don't clear previous results, in case user backs out
    setSelectedAnswers([]);
    setCurrentQuestionIndex(0);

    try {
      const controller = new AbortController();
      const data = await apiService.getQuestions(controller.signal);
      setQuestions(data.questions);
      setCurrentView("assessment");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error("Error fetching questions:", error);
        setMessages(prev => [...prev, botNote("Could not load the assessment questions. Is the backend running?", true)]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerSelection = (answerType: string) => {
    setSelectedAnswers(prev => {
      const newAnswers = [...prev];
      newAnswers[currentQuestionIndex] = answerType;
      return newAnswers;
    });
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      submitAssessment();
    }
  };

  const submitAssessment = async () => {
    setIsLoading(true);
    try {
      const controller = new AbortController();
      const data = await apiService.evaluateAssessment(selectedAnswers, controller.signal);
      setAssessmentResult(data);
      // Save result to local storage for persistence
      localStorage.setItem('assessmentResult', JSON.stringify(data));
      
      // If this was a compulsory assessment, unlock the main app now.
      if (isTakingCompulsoryAssessment) {
          setIsTakingCompulsoryAssessment(false);
      }

      setMessages(prev => [
        ...prev,
        botNote(`Your learning style is **${data.learning_style}**. ${data.description} I'll shape my explanations around that.`),
      ]);
      setCurrentView("chat");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error("Error submitting assessment:", error);
        setMessages(prev => [...prev, botNote("Could not submit the assessment. Please try again.", true)]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setUploadMessage("No file selected.");
      return;
    }

    if (file.type !== "application/pdf") {
      setUploadMessage("Only PDF files are allowed.");
      return;
    }

    setUploadMessage("Uploading and updating knowledge base...");
    setIsLoading(true);

    try {
      const controller = new AbortController();
      await apiService.uploadDocument(file, controller.signal);
      setUploadMessage("File uploaded successfully!");
      const data = await apiService.getDocuments();
      setDocuments(data.documents.map((name: string) => ({ name, active: true })));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error("Upload error:", error);
        setUploadMessage("Error uploading file to server.");
      }
    } finally {
      setIsLoading(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  // --- New Handlers for Notes Panel ---
  const handleHighlight = () => {
    const textarea = notesTextAreaRef.current;
    if (textarea) {
        const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();
        if (selectedText) {
            setHighlightedText(selectedText);
        }
    }
  };

  const handleSummarize = async () => {
    if (!highlightedText) return;
    setIsSummarizing(true);
    setSummaryResult("");
    try {
        const controller = new AbortController();
        const summary = await apiService.summarizeText(highlightedText, controller.signal);
        setSummaryResult(summary);
    } catch (error) {
        console.error("Error summarizing text:", error);
        setSummaryResult(`Error: ${error instanceof Error ? error.message : "Failed to get summary."}`);
    } finally {
        setIsSummarizing(false);
    }
  };

  const handleSaveNotes = () => {
    // Implement save functionality here (e.g., save to localStorage or an API)
    console.log("Saving notes:", notesText);
    alert("Notes saved to console!");
  };

  const openNotesPanel = () => {
    setHighlightedText("");
    setSummaryResult("");
    setIsNotesPanelOpen(true);
  };


  // Render Functions
  const renderChatbot = () => (
    <ChatView
      messages={messages}
      setMessages={setMessages}
      activeDocuments={activeDocsForTest}
      learningStyle={assessmentResult?.learning_style}
    />
  );

  const renderAssessment = () => (
    <div className="assessment-container">
      {isLoading ? (
        <div className="loading-message">
          <LoadingIndicator />
          <p>Loading questions...</p>
        </div>
      ) : questions.length > 0 ? (
        <div className="assessment-quiz-section">
           { !localStorage.getItem('assessmentResult') && (
                <div style={{textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#eef2ff', borderRadius: '8px'}}>
                    <p style={{margin: 0, fontWeight: 500, color: 'var(--primary-color)'}}>Welcome! Please complete this one-time assessment to personalize your learning experience.</p>
                </div>
            )}
          <p className="assessment-question">
            {currentQuestionIndex + 1}. {questions[currentQuestionIndex]?.question}
          </p>
          <div className="assessment-options">
            {questions[currentQuestionIndex]?.options.map((option, optIdx) => (
              <div
                key={optIdx}
                className={`assessment-option ${
                  selectedAnswers[currentQuestionIndex] === option.type ? 'selected' : ''
                }`}
                onClick={() => handleAnswerSelection(option.type)}
              >
                {option.text}
              </div>
            ))}
          </div>
          <div className="assessment-navigation">
            <button
              onClick={() => setCurrentQuestionIndex(prev => prev - 1)}
              disabled={currentQuestionIndex === 0 || isLoading}
            >
              Previous
            </button>
            <button
              onClick={goToNextQuestion}
              disabled={selectedAnswers[currentQuestionIndex] === undefined || isLoading}
            >
              {currentQuestionIndex === questions.length - 1
                ? "Submit Assessment"
                : "Next Question"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#2C3E50' }}>
          <p>No assessment questions available. Please try again later.</p>
        </div>
      )}
    </div>
  );

  const renderDocuments = () => (
    <div className="documents-container">
      <div className="documents-panel-header">
        <h3>Sources</h3>
        <div className="documents-actions">
          <label htmlFor="pdf-upload" className="upload-button-label small-button">
            <Plus size={14} strokeWidth={2.5} /> Add
          </label>
          <input
            type="file"
            id="pdf-upload"
            accept=".pdf"
            onChange={handleFileUpload}
            disabled={isLoading}
            style={{ display: 'none' }}
          />

        </div>
      </div>
      {documents.length === 0 && !isLoading ? (
        <div className="placeholder-content">
          <div className="icon"><FileText size={30} strokeWidth={1.6} /></div>
          <p>Your sources will appear here.</p>
          <p className="small-text">
            Click Add to upload a PDF. Kimi, tests, mind maps and audio overviews all use the sources you tick.
          </p>
        </div>
      ) : (
        <div className="document-list">
          {documents.map(doc => (
            <DocumentItem
              key={doc.name}
              document={doc}
              onToggle={handleDocumentToggle}
              onDelete={handleDocumentDelete}
            />
          ))}
        </div>
      )}
    </div>
  );

  const studioTools = [
    { key: "audio", icon: <Headphones size={18} />, title: "Audio overview", hint: "Two hosts talk through your sources", onClick: () => setStudioPanel("audio"), active: studioPanel === "audio" },
    { key: "mindmap", icon: <Network size={18} />, title: "Mind map", hint: "See how the key ideas connect", onClick: () => setCurrentView("mindmap"), active: currentView === "mindmap" },
    { key: "notes", icon: <NotebookPen size={18} />, title: "Notes", hint: "Write, highlight and summarize", onClick: openNotesPanel, active: isNotesPanelOpen },
    { key: "reports", icon: <BarChart3 size={18} />, title: "Reports", hint: "Your progress and memory curve", onClick: () => setCurrentView("reports"), active: currentView === "reports" },
  ];

  const renderStudio = () => {
    if (studioPanel === "audio") {
      return <AudioOverview documents={activeDocsForTest} onClose={() => setStudioPanel(null)} />;
    }
    return (
        <div className="studio-container">
          <div className="studio-header">
            <div className="upper">Studio</div>
          </div>
          <ul className="studio-tools">
            {studioTools.map(tool => (
              <li key={tool.key}>
                <button type="button" className={`studio-tool${tool.active ? " is-active" : ""}`} onClick={tool.onClick}>
                  <span className={`studio-tool-icon tool-${tool.key}`}>{tool.icon}</span>
                  <span className="studio-tool-text">
                    <span className="studio-tool-title">{tool.title}</span>
                    <span className="studio-tool-hint">{tool.hint}</span>
                  </span>
                  <ChevronRight size={16} className="studio-tool-chevron" />
                </button>
              </li>
            ))}
          </ul>
          <div className="studio-footer">
            {cleanedQuote ? (
              <div className="daily-quote-container">
                <p className="quote-text">"{cleanedQuote}"</p>
                <p className="quote-label">Quote of the Day</p>
              </div>
            ) : (
              <p className="small-text">
                Studio output will be saved here. After adding sources, click to add
                Audio Overview, Study Guide, Mind Map, and more!
              </p>
            )}
          </div>
        </div>
    );
  }

  const renderNotesPanel = () => (
    <div className="notes-panel-overlay">
        <div className="notes-panel">
            <div className="notes-panel-header">
                <h3>My Notes</h3>
                <button className="notes-close-btn" onClick={() => setIsNotesPanelOpen(false)}>✕</button>
            </div>
            <div className="notes-panel-content">
                <textarea
                    ref={notesTextAreaRef}
                    className="notes-textarea"
                    value={notesText}
                    onChange={(e) => setNotesText(e.target.value)}
                    onSelect={handleHighlight}
                    placeholder="Type your notes here... Then highlight text to summarize."
                />
                 {highlightedText && (
                    <div className="highlight-summary-section">
                        <p className="highlighted-text-info">
                            Selected: <strong>"{highlightedText}"</strong>
                        </p>
                        <button
                            className="notes-panel-btn summarize"
                            onClick={handleSummarize}
                            disabled={isSummarizing}
                        >
                            {isSummarizing ? "Summarizing..." : "Summarize"}
                        </button>
                    </div>
                 )}
                {summaryResult && (
                    <div className="summary-result-box">
                       <ReactMarkdown>{summaryResult}</ReactMarkdown>
                    </div>
                )}
            </div>
            <div className="notes-panel-actions">
                <button className="notes-panel-btn save" onClick={handleSaveNotes}>Save Notes</button>
            </div>
        </div>
    </div>
  );

  const activeDocsForTest = useMemo(() =>
    documents.filter(doc => doc.active).map(doc => doc.name),
    [documents]
  );

  const renderMainContent = () => {
    switch (currentView) {
      case 'assessment':
        return renderAssessment();
      case 'documents':
         // Fallback to chat view if user tries to access documents view during compulsory assessment
        return localStorage.getItem('assessmentResult') ? renderDocuments() : renderAssessment();
      case 'test':
        return <TestFeature activeDocuments={activeDocsForTest} />;
      case 'reports':
        return <ReportsFeature assessmentResult={assessmentResult} />;
      case 'mindmap':
        return <MindMap documents={activeDocsForTest} />;
      default:
        return renderChatbot();
    }
  };

  const viewTitles: Record<string, string> = {
    chat: "Chat", assessment: "Learning style", documents: "Sources", test: "Practice test",
    reports: "Reports", mindmap: "Mind map", upload: "Upload",
  };

  // JSX
  return (
    <>
      <style>{`
        /* --- FONT UPDATE: Import Montserrat from Google Fonts --- */
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

        :root {
          --primary-color: #4361ee;
          --secondary-color: #3f37c9;
          --accent-color: #4895ef;
          --light-color: #f8f9fa;
          --dark-color: #212529;
          --success-color: #4cc9f0;
          --warning-color: #f8961e;
          --danger-color: #f72585;
          --text-color: #2b2d42;
          --text-light: #8d99ae;
          --bg-gradient: linear-gradient(135deg, #4361ee 0%, #3f37c9 100%);
        }

        body {
          margin: 0;
          /* --- FONT UPDATE: Set Montserrat as the primary font --- */
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background-color: #f5f7ff;
          color: var(--text-color);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 0;
          box-sizing: border-box;
        }

        .main-app-container {
          width: 100vw;
          height: 100vh;
          max-width: none;
          min-width: auto;
          display: flex;
          flex-direction: column;
          background: #ffffff;
          border-radius: 0;
          box-shadow: none;
          overflow: hidden;
          transition: all 0.3s ease;
        }

        .main-app-container:hover {
          box-shadow: 0 15px 50px rgba(67, 97, 238, 0.2);
        }

        .top-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px 30px;
          background: var(--bg-gradient);
          color: white;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
          flex-shrink: 0;
          position: relative;
          z-index: 10;
        }

        .top-nav .app-logo {
          font-weight: 700;
          font-size: 1.6em;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .learner-icon {
            font-size: 0.8em;
            background-color: rgba(255, 255, 255, 0.2);
            padding: 4px 6px;
            border-radius: 8px;
            line-height: 1;
        }

        .nav-buttons {
          display: flex;
          gap: 15px;
        }

        .nav-buttons button {
          padding: 10px 20px;
          background: rgba(255, 255, 255, 0.1);
          border: 2px solid rgba(255, 255, 255, 0.2);
          color: white;
          font-weight: 600;
          border-radius: 25px;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: inherit; /* Ensure buttons use the new font */
        }

        .nav-buttons button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .nav-buttons button:hover:not(:disabled),
        .nav-buttons button.active {
          background-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        }

        .main-content-grid {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 2fr 1fr;
          gap: 20px;
          padding: 20px;
          background-color: #f5f7ff;
          min-height: 0;
          overflow: hidden;
          transition: opacity 0.3s ease-in-out;
        }

        .panel {
          background-color: #ffffff;
          border-radius: 16px;
          box-shadow: 0 5px 20px rgba(67, 97, 238, 0.08);
          display: flex;
          flex-direction: column;
          padding: 20px;
          transition: all 0.3s ease;
          overflow-y: auto;
          min-height: 0;
        }

        .panel:nth-child(2) { /* Target middle panel specifically */
          grid-column: 2;
          padding: 25px;
        }

        .panel:hover {
          box-shadow: 0 8px 30px rgba(67, 97, 238, 0.1);
        }

        .panel-header {
          font-size: 1.4em;
          font-weight: 600;
          color: var(--primary-color);
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid rgba(67, 97, 238, 0.1);
          flex-shrink: 0;
        }

        .panel-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow-y: auto;
        }

        .chat-content-container {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }

        .chat-box {
          flex: 1;
          background: linear-gradient(to bottom, #f8f9ff, #eef0ff);
          padding: 20px;
          overflow-y: auto;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 15px;
          scroll-behavior: smooth;
          min-height: 0;
        }

        /* Custom scrollbar */
        .chat-box::-webkit-scrollbar,
        .document-list::-webkit-scrollbar,
        .test-question-scroll-area::-webkit-scrollbar,
        .test-feature-container::-webkit-scrollbar,
        .reports-container::-webkit-scrollbar,
        .panel::-webkit-scrollbar {
          width: 8px;
        }

        .chat-box::-webkit-scrollbar-track,
        .document-list::-webkit-scrollbar-track,
        .test-question-scroll-area::-webkit-scrollbar-track,
        .test-feature-container::-webkit-scrollbar-track,
        .reports-container::-webkit-scrollbar-track,
        .panel::-webkit-scrollbar-track {
          background: rgba(67, 97, 238, 0.05);
          border-radius: 10px;
        }

        .chat-box::-webkit-scrollbar-thumb,
        .document-list::-webkit-scrollbar-thumb,
        .test-question-scroll-area::-webkit-scrollbar-thumb,
        .test-feature-container::-webkit-scrollbar-thumb,
        .reports-container::-webkit-scrollbar-thumb,
        .panel::-webkit-scrollbar-thumb {
          background: rgba(67, 97, 238, 0.2);
          border-radius: 10px;
        }

        .chat-box::-webkit-scrollbar-thumb:hover,
        .document-list::-webkit-scrollbar-thumb:hover,
        .test-question-scroll-area::-webkit-scrollbar-thumb:hover,
        .test-feature-container::-webkit-scrollbar-thumb:hover,
        .reports-container::-webkit-scrollbar-thumb:hover,
        .panel::-webkit-scrollbar-thumb:hover {
          background: rgba(67, 97, 238, 0.3);
        }

        .chat-input-area {
          display: flex;
          gap: 10px;
          margin-top: 20px;
          align-items: center;
          flex-shrink: 0;
        }

        .chat-input-field {
          flex-grow: 1;
          padding: 14px 20px;
          border-radius: 25px;
          border: 2px solid rgba(67, 97, 238, 0.2);
          font-size: 1em;
          outline: none;
          transition: all 0.3s ease;
          background: #ffffff;
          color: var(--text-color);
          font-family: inherit;
        }

        .chat-input-field:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.2);
        }

        .send-button {
          background: var(--primary-color);
          color: white;
          border: none;
          padding: 14px 25px;
          border-radius: 25px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
          box-shadow: 0 4px 10px rgba(67, 97, 238, 0.3);
          font-family: inherit;
        }

        .send-button:hover {
          background: var(--secondary-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(67, 97, 238, 0.4);
        }

        .send-button:disabled {
          background: var(--text-light);
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .chat-message {
          display: flex;
          flex-direction: column;
          padding: 25px 20px;
          border-radius: 18px;
          max-width: 95%;
          word-wrap: break-word;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.05);
          transition: all 0.4s ease-out;
          animation-duration: 0.4s;
          animation-fill-mode: both;
        }

        .chat-message.user {
          background-color: #e0e7ff;
          color: var(--text-color);
          margin-left: auto;
          align-items: flex-end;
          text-align: right;
          border-bottom-right-radius: 5px;
          animation-name: slideInRight;
        }

        .chat-message.bot {
          background-color: #f0f9ff;
          color: var(--text-color);
          margin-right: auto;
          align-items: flex-start;
          text-align: left;
          border-bottom-left-radius: 5px;
          animation-name: slideInLeft;
        }

        .chat-message-sender {
          font-weight: 700;
          margin-bottom: 5px;
          letter-spacing: 0.5px;
        }

        .chat-message.user .chat-message-sender {
          color: var(--primary-color);
        }

        .chat-message.bot .chat-message-sender {
          color: var(--accent-color);
        }

        /* --- Document/Source Panel Styles --- */
        .documents-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }

        .documents-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(67, 97, 238, 0.1);
          flex-shrink: 0;
        }

        .documents-actions {
          display: flex;
          gap: 10px;
        }

        .documents-actions .small-button {
          font-size: 0.9em;
          padding: 8px 15px;
          border-radius: 20px;
          border: none;
          cursor: pointer;
          transition: all 0.3s ease;
          background-color: rgba(67, 97, 238, 0.1);
          color: var(--primary-color);
          font-weight: 500;
        }

        .documents-actions .small-button:hover {
          background-color: rgba(67, 97, 238, 0.2);
          transform: translateY(-1px);
        }

        .document-list {
          flex: 1;
          overflow-y: auto;
          padding-right: 5px;
          min-height: 0;
        }

        .document-item {
          margin-bottom: 8px;
        }

        .document-checkbox {
          display: flex;
          align-items: center;
          padding: 12px;
          background-color: #f8f9ff;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .document-checkbox:hover {
          background-color: #eef0ff;
          transform: translateY(-1px);
        }

        .document-checkbox input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }

        .document-item {
          position: relative;
          margin-bottom: 8px;
        }

        .delete-icon {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 16px;
          font-weight: bold;
          color: #2660d376;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        .document-item:hover .delete-icon {
          opacity: 1;
        }


        .checkmark {
          position: relative;
          height: 18px;
          width: 18px;
          background-color: white;
          border: 2px solid rgba(67, 97, 238, 0.3);
          border-radius: 4px;
          margin-right: 12px;
          transition: all 0.2s ease;
        }

        .document-checkbox input:checked ~ .checkmark {
          background-color: var(--primary-color);
          border-color: var(--primary-color);
        }

        .checkmark:after {
          content: "";
          position: absolute;
          display: none;
          left: 5px;
          top: 1px;
          width: 4px;
          height: 10px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }

        .document-checkbox input:checked ~ .checkmark:after {
          display: block;
        }

        .document-name {
          flex-grow: 1;
          font-size: 0.95em;
        }

        .upload-button-label {
          background-color: var(--primary-color);
          color: white;
          padding: 12px 20px;
          border-radius: 25px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.3);
        }

        .upload-button-label:hover {
          background-color: var(--secondary-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(67, 97, 238, 0.4);
        }

        .upload-button-label:disabled {
          background: var(--text-light);
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .plus-icon {
          font-size: 1.2em;
          line-height: 1;
        }

        .upload-status-message {
          margin-top: 15px;
          font-style: italic;
          color: var(--text-light);
          animation: fadeIn 0.5s ease-out;
        }

        /* --- Studio Panel Styles --- */
        .studio-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }

        .studio-header {
          font-size: 1.4em;
          font-weight: 600;
          color: var(--primary-color);
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid rgba(67, 97, 238, 0.1);
          flex-shrink: 0;
        }
        .upper {
        font-weight : 600;
        font-size: 1.4em;
        }

        .studio-output-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
          margin-bottom: 25px;
        }

        .studio-output-item {
          text-align: center;
          padding: 25px 15px;
          background-color: #f8f9ff;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.05);
        }

        .studio-output-item:hover {
          background-color: #eef0ff;
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 6px 18px rgba(67, 97, 238, 0.1);
        }

        .studio-output-item .output-icon {
          font-size: 2.5em;
          margin-bottom: 5px;
          transition: transform 0.3s ease;
          color: var(--primary-color);
        }

        .studio-output-item:hover .output-icon {
          transform: scale(1.1);
        }

        .studio-output-item p {
          margin: 0;
          font-size: 0.95em;
          font-weight: 600;
          color: var(--text-color);
        }

        .studio-footer {
          margin-top: auto;
          text-align: center;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .daily-quote-container {
            padding: 20px;
            background-color: #f8f9ff;
            border-radius: 12px;
            border-left: 5px solid var(--accent-color);
            width: 100%;
            box-sizing: border-box;
        }

        .quote-text {
            font-style: italic;
            color: var(--text-color);
            margin: 0;
            font-size: 1.05em;
        }

        .quote-label {
            font-size: 0.8em;
            font-weight: 600;
            color: var(--text-light);
            margin: 8px 0 0 0;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* --- Assessment Styles --- */
        .assessment-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .assessment-quiz-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .assessment-question {
          font-size: 1.2em;
          font-weight: 600;
          margin-bottom: 20px;
          color: var(--text-color);
        }

        .assessment-options {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 30px;
          flex: 1;
          overflow-y: auto;
        }

        .assessment-option {
          padding: 15px 20px;
          background-color: #f8f9ff;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
        }

        .assessment-option:hover {
          background-color: #eef0ff;
          transform: translateY(-2px);
        }

        .assessment-option.selected {
          background-color: #e0e7ff;
          border-color: var(--primary-color);
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.1);
        }

        .assessment-navigation {
          display: flex;
          justify-content: space-between;
          margin-top: auto;
          flex-shrink: 0;
        }

        .assessment-navigation button {
          padding: 12px 25px;
          border-radius: 25px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .assessment-navigation button:first-child {
          background-color: #f8f9ff;
          color: var(--text-color);
          border: none;
        }

        .assessment-navigation button:last-child {
          background-color: var(--primary-color);
          color: white;
          border: none;
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.3);
        }

        .assessment-navigation button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none !important;
        }

        .assessment-navigation button:first-child:hover:not(:disabled) {
          background-color: #eef0ff;
          transform: translateY(-2px);
        }

        .assessment-navigation button:last-child:hover:not(:disabled) {
          background-color: var(--secondary-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(67, 97, 238, 0.4);
        }

        .assessment-result {
          text-align: center;
          padding: 20px;
        }

        .assessment-result h3 {
          color: var(--primary-color);
          margin-bottom: 10px;
        }
        
        /* --- Compulsory Assessment Full-Screen Style --- */
        .compulsory-assessment-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: #f5f7ff;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            box-sizing: border-box;
            animation: fadeIn 0.5s ease-out;
        }
        .compulsory-assessment-overlay .assessment-container {
           width: 100%;
           max-width: 800px;
           height: auto;
           max-height: 90vh;
           background-color: #ffffff;
           border-radius: 16px;
           box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
           padding: 2rem 3rem;
           box-sizing: border-box;
        }
        
        /* --- New Notes Panel Styles --- */
        .notes-panel-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            backdrop-filter: blur(5px);
            animation: fadeIn 0.3s ease;
        }
        .notes-panel {
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            width: 90%;
            max-width: 600px;
            height: 70vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: slideInUp 0.4s ease;
        }
        .notes-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 25px;
            border-bottom: 1px solid #e0e0e0;
            flex-shrink: 0;
        }
        .notes-panel-header h3 {
            margin: 0;
            color: var(--primary-color);
        }
        .notes-close-btn {
            background: none;
            border: none;
            font-size: 24px;
            color: var(--text-light);
            cursor: pointer;
            transition: color 0.2s ease;
        }
        .notes-close-btn:hover {
            color: var(--danger-color);
        }
        .notes-panel-content {
            flex: 1;
            padding: 25px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .notes-textarea {
            width: 100%;
            height: 40%;
            min-height: 150px;
            border: 2px solid #e0e7ff;
            border-radius: 12px;
            padding: 15px;
            font-family: inherit;
            font-size: 1em;
            resize: vertical;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }
        .notes-textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.2);
        }
        .highlight-summary-section {
            margin-top: 20px;
            padding: 15px;
            background-color: #f8f9ff;
            border-radius: 12px;
        }
        .highlighted-text-info {
            font-size: 0.9em;
            color: var(--text-color);
            margin: 0 0 10px 0;
            word-break: break-word;
        }
        .summary-result-box {
            margin-top: 15px;
            padding: 15px;
            background: linear-gradient(to bottom, #f8f9ff, #eef0ff);
            border-left: 4px solid var(--accent-color);
            border-radius: 8px;
            font-size: 0.95em;
            line-height: 1.6;
            color: var(--text-color);
        }
        .notes-panel-actions {
            padding: 15px 25px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            flex-shrink: 0;
        }
        .notes-panel-btn {
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            border: none;
        }
        .notes-panel-btn.save {
            background-color: var(--success-color);
            color: white;
        }
        .notes-panel-btn.summarize {
            background-color: var(--accent-color);
            color: white;
        }
        .notes-panel-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .notes-panel-btn:hover:not(:disabled) {
            transform: translateY(-2px);
        }
        @keyframes slideInUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }


        /* --- Animations & other general styles --- */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        .loading-message {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 15px auto;
          color: var(--text-light);
        }

        .loading-dots {
          display: flex;
          gap: 5px;
        }
        .loading-dots span {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: var(--primary-color);
          animation: bounceDot 1.4s infinite ease-in-out;
        }
        .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
        .loading-dots span:nth-child(2) { animation-delay: -0.16s; }
        .loading-dots span:nth-child(3) { animation-delay: 0s; }
        @keyframes bounceDot {
          0%, 80%, 100% { transform: scale(1); }
          40% { transform: scale(1); }
        }

        /* Code block styling */
        .code-block-container {
          position: relative;
          margin: 20px 0;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 30px rgba(0, 50, 100, 0.3);
          background: #282a36; /* Dracula background */
          font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
        }

        .code-block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #1e1f29;
          color: #f8f8f2;
          padding: 12px 20px;
          font-size: 0.9em;
          font-weight: 600;
        }

        .code-block-content {
          padding: 15px;
          color: #f8f8f2;
          overflow-x: auto;
        }

        .code-block-content code {
          font-family: inherit;
          font-size: 0.95em;
        }

        .copy-button {
          background: #44475a;
          color: #f8f8f2;
          border: 1px solid #6272a4;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8em;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        .copy-button:hover {
          background: #6272a4;
        }

        .head {
          font-weight : 600;
          font-size : 1.4em;
        }

        /* --- NEW & UPDATED TEST FEATURE STYLES --- */
        .test-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: #F9FAFB;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          box-sizing: border-box;
          animation: fadeIn 0.3s ease;
        }

        .test-feature-container {
          background-color: #F9FAFB;
          width: 100%;
          height: 100%;
          font-family: 'Montserrat', sans-serif;
          display: flex;
          flex-direction: column;
          box-shadow: none;
          border-radius: 0;
          overflow-y: auto; /* Changed from hidden to auto */
          position: relative;
        }

        .test-exit-button {
            position: absolute;
            top: 1rem;
            right: 1.5rem;
            background: none;
            border: none;
            font-size: 2.5rem;
            line-height: 1;
            color: #9CA3AF;
            cursor: pointer;
            z-index: 10;
            transition: color 0.2s ease;
        }

        .test-exit-button:hover {
            color: #1F2937;
        }

        .test-idle-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          padding: 1rem;
          background-color: #F9FAFB;
        }
        .test-idle-header {
          font-size: 2rem;
          font-weight: 700;
          color: #1F2937;
          margin-bottom: 1rem;
        }
        .test-idle-p {
          font-size: 1rem;
          color: #4B5563;
          margin-bottom: 2rem;
          max-width: 28rem;
        }
        .test-generate-button {
          padding: 1rem 2rem;
          background-color: #2563EB;
          color: white;
          font-weight: 600;
          border-radius: 0.5rem;
          border: none;
          cursor: pointer;
          box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
          transition: all 0.3s ease-in-out;
          font-size: 1rem;
        }
        .test-generate-button:hover {
          background-color: #1D4ED8;
        }
        .test-generate-button:disabled {
          background-color: #93C5FD;
          cursor: not-allowed;
        }

        .test-taking-container {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 3rem;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          box-sizing: border-box;
          background-color: transparent;
          min-height: 100%;
        }

        /* --- START: NO-SCROLL PERFORMANCE VIEW FIXES --- */
        .test-results-container, .test-history-container {
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem 3rem;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            background-color: transparent;
            min-height: 100%;
        }

        .test-results-header, .test-history-header {
            text-align: center;
            margin-bottom: 1.5rem;
            flex-shrink: 0;
            width: 100%;
        }
        .test-results-header h1, .test-history-header h1 {
            font-size: 1.75rem;
            font-weight: 800;
            color: #1F2937;
            margin-bottom: 0;
        }
        .test-results-header p, .test-history-header p {
            font-size: 1rem;
            color: #4B5563;
            margin-top: 0.25rem;
        }

        .test-results-grid {
            flex-grow: 1;
            display: grid;
            grid-template-columns: 320px 1fr;
            gap: 1.5rem;
            width: 100%;
        }

        .test-results-analysis-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            grid-auto-rows: min-content;
            gap: 1.5rem;
        }

        .test-feedback-card {
            background-color: white;
            padding: 1rem;
            border-radius: 1rem;
            border: 1px solid #E5E7EB;
            display: flex;
            flex-direction: column;
        }

        .test-action-buttons-container {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            padding-bottom: 1rem;
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-shrink: 0;
            width: 100%;
        }

        /* History Dashboard Specifics */
        .test-history-kpi-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.5rem;
            margin-bottom: 1.5rem;
            width: 100%;
            box-sizing: border-box;
            flex-shrink: 0;
        }

        .dashboard-content-area {
            flex-grow: 1;
            display: grid;
            grid-template-columns: 320px 1fr;
            gap: 1.5rem;
            width: 100%;
        }

        .performance-breakdown-card {
            background-color: white;
            padding: 1rem;
            border-radius: 1rem;
            border: 1px solid #E5E7EB;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .performance-breakdown-card h3 {
          font-size: 1rem;
          font-weight: 700;
          color: #1F2937;
        }

        .category-cards-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            grid-auto-rows: min-content;
            gap: 1.5rem;
        }
        /* --- END: NO-SCROLL PERFORMANCE VIEW FIXES --- */


        .test-taking-header {
          margin-bottom: 1.5rem;
          flex-shrink: 0;
          width: 100%;
        }
        .test-question-scroll-area {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow: hidden;
          width: 100%;
        }

        .test-question-category {
          font-size: 0.875rem;
          font-weight: 600;
          color: #2563EB;
        }
        .test-question-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #1F2937;
          margin-top: 0.25rem;
        }
        .test-progress-bar-background {
          width: 100%;
          background-color: #E5E7EB;
          border-radius: 9999px;
          height: 0.625rem;
          margin-top: 1rem;
        }
        .test-progress-bar-foreground {
          background-color: #2563EB;
          height: 0.625rem;
          border-radius: 9999px;
          transition: width 0.5s ease-in-out;
        }
        .test-question-card {
          background-color: transparent;
          padding: 0;
          border: none;
          width: 100%;
        }
        .test-question-text {
          font-size: 1.5rem;
          color: #111827;
          margin-bottom: 2.5rem;
          font-weight: 600;
          line-height: 1.6;
        }

        .test-options-container {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.5rem;
        }

        .test-option-button {
          width: 100%;
          text-align: left;
          padding: 1.5rem;
          border-radius: 0.75rem;
          border: 2px solid #D1D5DB;
          background-color: #FFFFFF;
          transition: all 0.2s ease-in-out;
          cursor: pointer;
          font-family: inherit;
          font-size: 1rem;
          min-height: 5rem;
          display: flex;
          align-items: center;
          color: #1F2937;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
        }
        .test-option-button:hover, .test-option-button:focus {
          background-color: #F9FAFB;
          border-color: #3B82F6;
          transform: translateY(-2px);
          outline: none;
        }
        .test-option-button.selected {
          background-color: #DBEAFE;
          border-color: #3B82F6;
          box-shadow: 0 0 0 3px #BFDBFE;
        }
        .test-navigation-buttons {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 1.5rem;
          border-top: 1px solid #e5e7eb;
          flex-shrink: 0;
          margin-top: 2rem;
          width: 100%;
        }
        .test-nav-button {
          padding: 0.75rem 2rem;
          font-weight: 600;
          border-radius: 0.5rem;
          box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
          border: 1px solid #D1D5DB;
          background-color: white;
          color: #374151;
          cursor: pointer;
          font-family: inherit;
          font-size: 1rem;
        }
        .test-nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .test-nav-button.exit {
            background-color: transparent;
            color: #EF4444;
            border-color: #FCA5A5;
        }
        .test-nav-button.exit:hover {
            background-color: #FEF2F2;
        }
        .test-nav-button.primary {
          background-color: #2563EB;
          color: white;
          border-color: transparent;
        }
        .test-nav-button.primary:hover {
          background-color: #1D4ED8;
        }
        .test-nav-button.finish {
          background-color: #16A34A;
          color: white;
          border-color: transparent;
        }
        .test-nav-button.finish:hover {
          background-color: #15803D;
        }

        .test-tooltip {
          position: fixed;
          background-color: #111827;
          color: white;
          font-size: 0.75rem;
          border-radius: 0.25rem;
          padding: 0.25rem 0.5rem;
          pointer-events: none;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
          z-index: 1050;
          transform: translate(10px, 10px);
        }

        .test-results-chart-column {
          background-color: white;
          padding: 1rem;
          border-radius: 1rem;
          border: 1px solid #E5E7EB;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .test-results-chart-column h3 {
          font-size: 1rem;
          font-weight: 700;
          color: #1F2937;
        }
        .test-results-subtitle {
          font-size: 0.8rem;
          color: #6B7280;
          margin-bottom: 0.5rem;
          text-align: center;
        }
        .test-pie-chart-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
        }
        .test-pie-slice {
          transition: opacity 0.2s ease-in-out;
        }
        .test-pie-slice:hover {
          opacity: 0.8;
        }
        .test-legend-container {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .test-legend-item {
          display: flex;
          align-items: center;
        }
        .test-legend-dot {
          width: 0.75rem;
          height: 0.75rem;
          border-radius: 9999px;
          margin-right: 0.75rem;
        }
        .test-legend-label {
          font-size: 0.875rem;
          color: #4B5563;
          font-weight: 500;
        }
        .test-legend-score {
          margin-left: auto;
          font-weight: 600;
          color: #374151;
        }
        .cat-bg-blue { background-color: #60a5fa; }
        .cat-bg-green { background-color: #4ade80; }
        .cat-bg-red { background-color: #f87171; }
        .cat-bg-yellow { background-color: #facc15; }

        .test-feedback-score {
          font-size: 1.25rem;
          font-weight: 700;
          color: #2563EB;
          margin: 0.25rem 0;
        }
        .test-feedback-analysis {
          font-size: 0.875rem;
          color: #4B5563;
          margin-bottom: 0.75rem;
          line-height: 1.5;
        }
        .test-feedback-tips {
          margin-top: auto;
          padding-top: 0.75rem;
          border-top: 1px solid #F3F4F6;
        }
        .test-feedback-tips h5 {
          font-weight: 600;
          color: #374151;
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
        }
        .test-feedback-tips ul {
          list-style-type: disc;
          list-style-position: outside;
          padding-left: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.875rem;
          color: #4B5563;
          margin: 0;
        }

        .test-action-button {
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          border-radius: 0.5rem;
          transition: transform 0.2s ease-in-out, background-color 0.2s;
          border: none;
          cursor: pointer;
          font-size: 1rem;
        }
        .test-action-button.primary {
          background-color: #2563EB;
          color: white;
          box-shadow: 0 4px 10px -3px rgb(0 0 0 / 0.1), 0 2px 4px -4px rgb(0 0 0 / 0.1);
        }
        .test-action-button.primary:hover {
          background-color: #1D4ED8;
          transform: scale(1.05);
        }
        .test-action-button.secondary {
          background-color: #E5E7EB;
          color: #374151;
        }
        .test-action-button.secondary:hover {
          background-color: #D1D5DB;
        }

        .test-history-kpi-card {
            background-color: #FFFFFF;
            padding: 1rem;
            border-radius: 1rem;
            border: 1px solid #E5E7EB;
            text-align: center;
        }
        .test-history-kpi-card h4 {
            font-size: 0.875rem;
            font-weight: 600;
            color: #4B5563;
            margin-bottom: 0.25rem;
        }
        .test-history-kpi-value {
            font-size: 2rem;
            font-weight: 800;
            color: #1D4ED8;
            margin: 0;
        }
        .test-history-kpi-subtext {
            font-size: 0.8rem;
            color: #6B7280;
            margin-top: 0.25rem;
        }

      }

        /* ===== Shell refinements (chat + studio refresh) ===== */
        :root {
          --ink: #1f2233;
          --ink-soft: #4a4f6a;
          --muted: #6b7090;
          --line: #e4e6f2;
          --canvas: #f3f4fa;
        }
        body { background-color: var(--canvas); color: var(--ink); }
        ::selection { background: rgba(67, 97, 238, 0.2); color: inherit; }
        * { scrollbar-width: thin; scrollbar-color: #cdd2ea transparent; }
        *::-webkit-scrollbar { width: 8px; height: 8px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: #cdd2ea; border-radius: 8px; }
        *::-webkit-scrollbar-thumb:hover { background: #b3bae0; }
        :focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

        .main-app-container:hover { box-shadow: none; }
        .main-app-container .top-nav {
          padding: 12px 24px;
          background: linear-gradient(115deg, #3f37c9 0%, #4361ee 100%);
          box-shadow: 0 2px 12px rgba(31, 34, 51, 0.12);
        }
        .main-app-container .top-nav .app-logo {
          font-size: 1.25rem;
          letter-spacing: -0.01em;
          gap: 10px;
        }
        .app-logo-mark {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          border-radius: 9px;
          background: rgba(255, 255, 255, 0.18);
        }
        .main-app-container .learner-icon {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: capitalize;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.16);
        }
        .main-app-container .nav-buttons { gap: 4px; }
        .main-app-container .nav-buttons button {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 14px;
          font-size: 0.88rem;
          background: transparent;
          border: 0;
          border-radius: 10px;
          color: rgba(255, 255, 255, 0.86);
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        .main-app-container .nav-buttons button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
          transform: none;
          box-shadow: none;
        }
        .main-app-container .nav-buttons button.active {
          background: #fff;
          color: #3f37c9;
          transform: none;
          box-shadow: 0 2px 8px rgba(20, 18, 80, 0.2);
        }

        .main-app-container .main-content-grid {
          grid-template-columns: minmax(230px, 1fr) minmax(0, 2.3fr) minmax(250px, 1fr);
          gap: 16px;
          padding: 16px;
          background-color: var(--canvas);
        }
        .main-app-container .panel {
          border: 1px solid var(--line);
          border-radius: 18px;
          box-shadow: 0 1px 2px rgba(31, 34, 51, 0.04), 0 6px 20px rgba(31, 34, 51, 0.04);
          padding: 18px;
        }
        .main-app-container .panel:hover { box-shadow: 0 1px 2px rgba(31, 34, 51, 0.04), 0 6px 20px rgba(31, 34, 51, 0.04); }
        .main-app-container .panel:nth-child(2) { padding: 18px 22px 16px; }
        .main-app-container .panel-header {
          font-size: 1rem;
          font-weight: 700;
          color: var(--ink);
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--line);
        }

        /* Sources */
        .main-app-container .document-checkbox {
          gap: 10px;
          padding: 10px 36px 10px 12px;
          background: #f7f8fc;
          border: 1px solid transparent;
        }
        .main-app-container .document-checkbox:hover { background: #eff1fb; border-color: var(--line); transform: none; }
        .document-file-icon { flex-shrink: 0; color: var(--muted); }
        .main-app-container .document-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.86rem;
          color: var(--ink);
        }
        .main-app-container .delete-icon {
          display: grid;
          place-items: center;
          width: 26px;
          height: 26px;
          right: 6px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--muted);
          font-size: inherit;
        }
        .main-app-container .delete-icon:hover { background: #fde8e8; color: #b42318; }
        .main-app-container .delete-icon:focus-visible { opacity: 1; }
        .main-app-container .upload-button-label { display: inline-flex; align-items: center; gap: 5px; }

        /* Studio */
        .main-app-container .studio-header {
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--line);
        }
        .main-app-container .studio-header .upper,
        .main-app-container .documents-panel-header h3 {
          font-size: 1rem;
          font-weight: 700;
          color: var(--ink);
          letter-spacing: 0;
          margin: 0;
        }
        .studio-tools {
          list-style: none;
          margin: 4px 0 16px;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .studio-tool {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          text-align: left;
          font: inherit;
          padding: 10px;
          border: 1px solid transparent;
          border-radius: 14px;
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .studio-tool:hover { background: #f6f7fc; border-color: var(--line); }
        .studio-tool.is-active { background: #eef1ff; border-color: #d5dbfb; }
        .studio-tool-icon {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          width: 38px;
          height: 38px;
          border-radius: 11px;
        }
        .tool-audio { background: #eef1ff; color: #4361ee; }
        .tool-mindmap { background: #e6f6f3; color: #0f9d8a; }
        .tool-notes { background: #fdf3e3; color: #c26a05; }
        .tool-reports { background: #fbe9f2; color: #c0266d; }
        .studio-tool-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
        .studio-tool-title { font-size: 0.9rem; font-weight: 600; }
        .studio-tool-hint { font-size: 0.76rem; color: var(--muted); line-height: 1.35; }
        .studio-tool-chevron { color: #b3b8d4; flex-shrink: 0; transition: transform 0.15s ease, color 0.15s ease; }
        .studio-tool:hover .studio-tool-chevron { transform: translateX(2px); color: var(--muted); }

        .main-app-container .daily-quote-container {
          border-left: 0;
          background: #f7f8fc;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 16px 18px;
          text-align: left;
        }
        .main-app-container .quote-text {
          font-family: "Source Serif 4", Georgia, serif;
          font-size: 1rem;
          line-height: 1.5;
          color: var(--ink-soft);
        }
        .main-app-container .quote-label { font-size: 0.68rem; letter-spacing: 0.06em; color: var(--muted); }

        @media (max-width: 1100px) {
          .main-app-container .main-content-grid { grid-template-columns: minmax(200px, 0.9fr) minmax(0, 2fr) minmax(220px, 0.9fr); }
          .main-app-container .nav-buttons button { padding: 8px 10px; }
        }
      `}</style>

      {!isAuthenticated ? (
        <LoginPage onLogin={handleLogin} />
      ) : isTakingCompulsoryAssessment ? (
        <div className="compulsory-assessment-overlay">
            {renderAssessment()}
        </div>
      ) : (
        <div className="main-app-container">
          <div className="top-nav">
            <span className="app-logo">
              <span className="app-logo-mark" aria-hidden="true"><Sparkles size={16} /></span>
              EduMind
              {assessmentResult && (
                <span title={`Learning style: ${assessmentResult.learning_style}`} className="learner-icon">
                  {getLearnerIcon(assessmentResult.learning_style)}
                  <span>{assessmentResult.learning_style}</span>
                </span>
              )}
            </span>
            <div className="nav-buttons">
              <button onClick={() => setCurrentView('chat')} className={currentView === 'chat' ? 'active' : ''} disabled={currentView === 'assessment'}><MessageSquare size={15} /> Chat</button>
              <button onClick={startAssessment} className={currentView === 'assessment' ? 'active' : ''}><Brain size={15} /> Assessment</button>
              <button onClick={() => setCurrentView('documents')} className={currentView === 'documents' ? 'active' : ''} disabled={currentView === 'assessment'}><FileText size={15} /> Sources</button>
              <button onClick={() => setCurrentView('test')} className={currentView === 'test' ? 'active' : ''} disabled={currentView === 'assessment'}><ClipboardCheck size={15} /> Test</button>
            </div>
          </div>

          <div className="main-content-grid">
            <div className="panel">
              {renderDocuments()}
            </div>

            <div className="panel">
              <div className="panel-header">
              <div className="head">{viewTitles[currentView] ?? currentView}</div>
              </div>
              <div className="panel-content">
                {renderMainContent()}
              </div>
            </div>

            <div className="panel">
              {renderStudio()}
            </div>
          </div>
        </div>
      )}

      {isAuthenticated && !isTakingCompulsoryAssessment && isNotesPanelOpen && renderNotesPanel()}
    </>

  );
}

export default App;