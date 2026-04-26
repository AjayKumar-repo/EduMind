import React, { useState, useMemo, FC, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

// --- TYPE DEFINITIONS ---
export type ViewState = 'idle' | 'takingTest' | 'results' | 'history';

interface Question {
  id: number;
  category: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
}

interface TestData {
  testId: string;
  questions: Question[];
}

type UserAnswers = {
  [key: number]: string;
};

export type CategoryScores = {
    [category: string]: {
      score: number;
      total: number;
    };
};

export type PerformanceResult = {
  testId: string;
  scores: CategoryScores;
  timestamp: number;
};


// --- API Service ---
const API_BASE_URL = "http://127.0.0.1:8000";

const apiService = {
  generateTest: async (documentChunks: string[], signal?: AbortSignal): Promise<TestData> => {
    const response = await fetch(`${API_BASE_URL}/generate-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_chunks: documentChunks }),
      signal,
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to generate test");
    }
    return response.json();
  },
  getDocumentText: async (documentName: string, signal?: AbortSignal): Promise<{content: string}> => {
    const response = await fetch(`${API_BASE_URL}/document-text/${encodeURIComponent(documentName)}`, {
        signal
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch content for document: ${documentName}`);
    }
    return response.json();
  }
};


// --- HELPER DATA FOR RESULTS VIEW ---
const categoryFeedback: { [key: string]: { [score: number]: { analysis: string; tips: string[] } } } = {
    "Cognitive Memory": {
        0: { analysis: "You seem to be struggling with recalling key facts. It's important to build this foundation.", tips: ["Re-read the source material, focusing on definitions.", "Use flashcards for key terms.", "Try to summarize sections in your own words."] },
        1: { analysis: "You're starting to remember some details, but there are gaps in your recall of specific information.", tips: ["Pay close attention to names, dates, and specific data.", "Create mnemonics to remember lists or sequences.", "Review the material shortly after reading it."] },
        2: { analysis: "You have a decent memory of the core concepts but miss some of the finer details.", tips: ["Challenge yourself to recall information without looking at the text.", "Explain the concepts to someone else to solidify them.", "Draw diagrams to connect key facts."] },
        3: { analysis: "You have a good grasp of the facts and figures presented in the material.", tips: ["Continue to review to ensure long-term retention.", "Try to connect these facts to broader themes.", "Look for patterns in the information presented."] },
        4: { analysis: "Excellent! Your recall of the details in the text is outstanding.", tips: ["Challenge yourself by looking for information that was implied but not stated.", "Consider how these facts might be used in a larger argument."] }
    },
    "Logical Reasoning": {
        0: { analysis: "You're finding it difficult to connect ideas and draw conclusions from the text.", tips: ["Focus on identifying 'cause and effect' relationships.", "Look for keywords like 'because', 'therefore', and 'as a result'.", "Break down complex sentences into smaller parts."] },
        1: { analysis: "You can follow simple arguments but struggle when the logic becomes more complex.", tips: ["Practice identifying the premises and conclusion of an argument.", "Map out the flow of an argument visually.", "Question the assumptions behind each statement."] },
        2: { analysis: "You can follow most lines of reasoning but can improve in spotting flawed logic or assumptions.", tips: ["Consider alternative conclusions that could be drawn from the evidence.", "Ask 'why' at each step of a logical progression.", "Look for inconsistencies in the text."] },
        3: { analysis: "You have strong logical reasoning skills and can effectively follow the author's arguments.", tips: ["Analyze the strength of the evidence used to support claims.", "Try to anticipate the next step in a logical sequence.", "Identify any unstated assumptions."] },
        4: { analysis: "Perfect! Your ability to understand and interpret logical connections is exceptional.", tips: ["Consider the broader implications of the arguments presented.", "Deconstruct complex arguments to identify their core structure."] }
    },
    "Critical Thinking": {
        0: { analysis: "You're having trouble analyzing and evaluating the claims made in the document.", tips: ["Start by identifying the author's main thesis or argument.", "Question the evidence presented: Is it strong or weak?", "Don't accept claims at face value; ask 'why should I believe this?'"] },
        1: { analysis: "You can identify the main points but find it challenging to evaluate their strengths and weaknesses.", tips: ["Compare and contrast different concepts within the text.", "Consider the author's potential biases.", "Look for what might be missing from the argument."] },
        2: { analysis: "You have a foundational understanding but can improve in evaluating nuanced arguments and evidence.", tips: ["Practice distinguishing between fact and opinion.", "Assess the credibility of the sources if they are mentioned.", "Think about the real-world implications of the arguments."] },
        3: { analysis: "You are a strong critical thinker, capable of analyzing and questioning the material effectively.", tips: ["Synthesize information from different parts of the text to form your own conclusion.", "Propose counter-arguments to the author's claims.", "Evaluate the overall effectiveness of the author's argument."] },
        4: { analysis: "Outstanding! You demonstrate a superior ability to analyze, evaluate, and critique the text.", tips: ["Extend the author's argument to new contexts.", "Identify the ideological or philosophical underpinnings of the text."] }
    },
    "Creative Application": {
        0: { analysis: "Applying the concepts from the text to new situations is a major challenge right now.", tips: ["First, ensure you understand the core principles in the text.", "Think of a simple, real-world example for each main concept.", "Don't be afraid to brainstorm multiple solutions to a problem."] },
        1: { analysis: "You can apply concepts to familiar scenarios but struggle with more abstract or novel problems.", tips: ["Try to rephrase the problem in your own words.", "Break the problem down into smaller, more manageable parts.", "Relate the new scenario back to a specific example from the text."] },
        2: { analysis: "You can apply principles to new scenarios but could be more flexible in your problem-solving.", tips: ["Consider multiple, different approaches to solving the problem.", "Think about the long-term consequences of your proposed solution.", "Collaborate with others to see different perspectives."] },
        3: { analysis: "You are skilled at applying information from the text to solve new and unfamiliar problems.", tips: ["Try to combine different principles from the text in innovative ways.", "Think about the potential limitations of your solution.", "How could your solution be improved or made more efficient?"] },
        4: { analysis: "Exceptional! Your ability to creatively apply knowledge to new contexts is top-tier.", tips: ["Design a new problem that could be solved using the text's principles.", "Consider how these principles might apply to a completely different field."] }
    }
};

const categoryColors: { [key: string]: { fill: string; bg: string; } } = {
    "Cognitive Memory":     { fill: '#60a5fa', bg: 'cat-bg-blue' },
    "Logical Reasoning":    { fill: '#4ade80', bg: 'cat-bg-green' },
    "Critical Thinking":    { fill: '#f87171', bg: 'cat-bg-red' },
    "Creative Application": { fill: '#facc15', bg: 'cat-bg-yellow' },
};

// --- Helper Functions ---
const getSlicePath = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
    const start = {
        x: cx + radius * Math.cos(startAngle * Math.PI / 180),
        y: cy + radius * Math.sin(startAngle * Math.PI / 180)
    };
    const end = {
        x: cx + radius * Math.cos(endAngle * Math.PI / 180),
        y: cy + radius * Math.sin(endAngle * Math.PI / 180)
    };
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    const d = [ "M", cx, cy, "L", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 1, end.x, end.y, "Z" ].join(" ");
    return d;
};


// --- UI COMPONENTS ---

const IdleView: FC<{ 
    onGenerate: () => void; 
    loading: boolean;
    hasHistory: boolean;
    onViewHistory: () => void;
}> = ({ onGenerate, loading, hasHistory, onViewHistory }) => (
    <div className="test-idle-container">
        <h1 className="test-idle-header">Test Your Knowledge</h1>
        <p className="test-idle-p">Select a single document from the 'Sources' panel and generate a test to assess your understanding.</p>
        <div className="test-action-buttons-container">
            <button
                onClick={onGenerate}
                disabled={loading}
                className="test-generate-button test-action-button primary"
            >
                {loading ? 'Generating...' : 'Generate New Test'}
            </button>
            {hasHistory && (
                <button onClick={onViewHistory} className="test-action-button secondary">
                    View Performance History
                </button>
            )}
        </div>
    </div>
);

const TakingTestView: FC<{
  testData: TestData;
  userAnswers: UserAnswers;
  onAnswerSelect: (questionId: number, answer: string) => void;
  onFinish: () => void;
  onExit: () => void;
}> = ({ testData, userAnswers, onAnswerSelect, onFinish, onExit }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const currentQuestion = testData.questions[currentIndex];
    const totalQuestions = testData.questions.length;

    useEffect(() => {
        optionRefs.current = optionRefs.current.slice(0, currentQuestion.options.length);
    }, [currentQuestion]);

    const handleNext = useCallback(() => {
        if (currentIndex < totalQuestions - 1) {
            setCurrentIndex(i => i + 1);
        } else {
            onFinish();
        }
    }, [currentIndex, totalQuestions, onFinish]);

    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            // --- FIX FOR AUTO-SELECTION BUG ---
            if (event.key === 'Enter') {
                if (userAnswers[currentQuestion.id]) {
                    event.preventDefault(); // Prevents the Enter key from triggering a click on the next question
                    handleNext();
                }
            }

            // --- FEATURE FOR ARROW KEY NAVIGATION ---
            const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
            if (arrowKeys.includes(event.key)) {
                event.preventDefault();
                
                const currentFocus = document.activeElement;
                let focusIndex = -1;

                if (currentFocus instanceof HTMLButtonElement) {
                    focusIndex = optionRefs.current.indexOf(currentFocus);
                }
                
                if (focusIndex === -1) {
                    optionRefs.current[0]?.focus();
                    return;
                }

                let nextIndex = focusIndex;
                switch (event.key) {
                    case "ArrowLeft":
                        nextIndex = focusIndex % 2 === 0 ? focusIndex : focusIndex - 1;
                        break;
                    case "ArrowRight":
                        nextIndex = focusIndex % 2 !== 0 ? focusIndex : focusIndex + 1;
                        break;
                    case "ArrowUp":
                        nextIndex = focusIndex < 2 ? focusIndex : focusIndex - 2;
                        break;
                    case "ArrowDown":
                        nextIndex = focusIndex > 1 ? focusIndex : focusIndex + 2;
                        break;
                }

                if (nextIndex >= 0 && nextIndex < optionRefs.current.length) {
                    optionRefs.current[nextIndex]?.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => {
            document.removeEventListener('keydown', handleKeyPress);
        };
    }, [userAnswers, currentQuestion, handleNext]);

    return (
        <div className="test-taking-container">
            <div className="test-taking-header">
                <p className="test-question-category">{currentQuestion.category}</p>
                <h2 className="test-question-title">
                    Question {currentIndex + 1} of {totalQuestions}
                </h2>
                <div className="test-progress-bar-background">
                    <div
                        className="test-progress-bar-foreground"
                        style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
                    ></div>
                </div>
            </div>

            <div className="test-question-scroll-area">
              <div className="test-question-card">
                  <p className="test-question-text">{currentQuestion.questionText}</p>
                  <div className="test-options-container">
                      {currentQuestion.options.map((option, index) => {
                          const isSelected = userAnswers[currentQuestion.id] === option;
                          return (
                              <button
                                  key={index}
                                  ref={(el) => { optionRefs.current[index] = el; }}
                                  onClick={() => onAnswerSelect(currentQuestion.id, option)}
                                  className={`test-option-button ${isSelected ? 'selected' : ''}`}
                              >
                                  {option}
                              </button>
                          );
                      })}
                  </div>
              </div>
            </div>

            <div className="test-navigation-buttons">
                <button onClick={onExit} className="test-nav-button exit">End Test</button>
                <div style={{display: 'flex', gap: '1rem'}}>
                    <button
                        onClick={() => setCurrentIndex(i => i - 1)}
                        disabled={currentIndex === 0}
                        className="test-nav-button"
                    >
                        Previous
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={!userAnswers[currentQuestion.id]}
                        className={`test-nav-button ${currentIndex === totalQuestions - 1 ? 'finish' : 'primary'}`}
                    >
                        {currentIndex === totalQuestions - 1 ? 'Finish & See Results' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ResultsView: FC<{
    result: PerformanceResult;
    onRetake: () => void;
    onViewHistory: () => void;
}> = ({ result, onRetake, onViewHistory }) => {
    const [tooltip, setTooltip] = useState<{ content: string; x: number; y: number } | null>(null);
    const categories = Object.keys(result.scores);
    
    const totalCorrect = categories.reduce((acc, cat) => acc + result.scores[cat].score, 0);
    const totalQuestions = categories.reduce((acc, cat) => acc + result.scores[cat].total, 0);
    let cumulativeAngle = -90;

    return (
        <div className="test-results-container">
            {tooltip && (
                <div className="test-tooltip" style={{ top: tooltip.y, left: tooltip.x }}>
                    {tooltip.content}
                </div>
            )}
            <div className="test-results-header">
                <h1>Performance Analysis</h1>
                <p>You got {totalCorrect} out of {totalQuestions} questions correct. Here's a breakdown of your performance.</p>
            </div>

            <div className="test-results-grid">
                <div className="test-results-chart-column">
                    <h3>Overall Performance</h3>
                    <p className="test-results-subtitle">Distribution of your correct answers.</p>
                    <div className="test-pie-chart-container">
                        <svg width="180" height="180" viewBox="0 0 120 120">
                            <g>
                                {totalCorrect > 0 ? categories.map(cat => {
                                    const { score, total } = result.scores[cat];
                                    if (score === 0) return null;
                                    const angle = (score / totalCorrect) * 360;
                                    const startAngle = cumulativeAngle;
                                    const endAngle = cumulativeAngle + angle;
                                    const pathData = getSlicePath(60, 60, 56, startAngle, endAngle);
                                    cumulativeAngle = endAngle;

                                    return (
                                        <path
                                            key={cat}
                                            d={pathData}
                                            fill={categoryColors[cat]?.fill || '#ccc'}
                                            stroke="white"
                                            strokeWidth="3"
                                            className="test-pie-slice"
                                            onMouseMove={(e) => setTooltip({ content: `${cat}: ${score}/${total}`, x: e.clientX + 15, y: e.clientY + 15 })}
                                            onMouseLeave={() => setTooltip(null)}
                                        />
                                    );
                                }) : <circle cx="60" cy="60" r="56" fill="#F3F4F6" />}
                            </g>
                            <circle cx="60" cy="60" r="38" fill="white" />
                        </svg>
                    </div>
                     <div className="test-legend-container">
                        {categories.map(cat => (
                            <div key={cat} className="test-legend-item">
                                <span className={`test-legend-dot ${categoryColors[cat]?.bg}`}></span>
                                <span className="test-legend-label">{cat}</span>
                                <span className="test-legend-score">{result.scores[cat].score}/{result.scores[cat].total}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="test-results-analysis-grid">
                    {categories.map(cat => {
                         const { score, total } = result.scores[cat];
                         const avgScore = total > 0 ? Math.round((score / total) * 4) : 0;
                         const feedback = categoryFeedback[cat]?.[avgScore];
                         if (!feedback || total === 0) return null;
                         return (
                            <div key={cat} className="test-feedback-card">
                                <div>
                                    <h4>{cat}</h4>
                                    <p className="test-feedback-score">{score}/{total}</p>
                                    <p className="test-feedback-analysis">{feedback.analysis}</p>
                                </div>
                                <div className="test-feedback-tips">
                                    <h5>Actionable Tips:</h5>
                                    <ul>
                                        {feedback.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                                    </ul>
                                </div>
                            </div>
                         );
                    })}
                </div>
            </div>
             <div className="test-action-buttons-container">
                <button onClick={onViewHistory} className="test-action-button secondary">
                  View Overall Performance
                </button>
                <button onClick={onRetake} className="test-action-button primary">
                    Take a New Test
                </button>
            </div>
        </div>
    );
};

const HistoryView: FC<{
    overallScores: CategoryScores;
    history: PerformanceResult[];
    onBack: () => void;
    onRetake: () => void;
}> = ({ overallScores, history, onBack, onRetake }) => {
    const [tooltip, setTooltip] = useState<{ content: string; x: number; y: number } | null>(null);
    const categories = Object.keys(overallScores);
    const totalCorrect = categories.reduce((acc, cat) => acc + overallScores[cat].score, 0);
    const totalQuestions = categories.reduce((acc, cat) => acc + overallScores[cat].total, 0);
    const overallAverage = totalQuestions > 0 ? ((totalCorrect / totalQuestions) * 100).toFixed(0) : 0;
    let cumulativeAngle = -90;
    
    return (
        <div className="test-history-container">
             {tooltip && (
                <div className="test-tooltip" style={{ top: tooltip.y, left: tooltip.x }}>
                    {tooltip.content}
                </div>
            )}
            <div className="test-history-header">
                <h1>Overall Performance Dashboard</h1>
                <p>A summary of your performance across all {history.length} tests taken.</p>
            </div>
            
            <div className="test-history-kpi-grid">
                <div className="test-history-kpi-card">
                    <h4>Overall Average</h4>
                    <p className="test-history-kpi-value">{overallAverage}%</p>
                    <p className="test-history-kpi-subtext">{totalCorrect} / {totalQuestions} Correct</p>
                </div>
                <div className="test-history-kpi-card">
                    <h4>Tests Completed</h4>
                    <p className="test-history-kpi-value">{history.length}</p>
                    <p className="test-history-kpi-subtext">Keep up the great work!</p>
                </div>
                <div className="test-history-kpi-card">
                    <h4>Best Category</h4>
                    <p className="test-history-kpi-value">
                        {categories.reduce((best, cat) => {
                            const bestScore = overallScores[best].total > 0 ? overallScores[best].score / overallScores[best].total : 0;
                            const currentScore = overallScores[cat].total > 0 ? overallScores[cat].score / overallScores[cat].total : 0;
                            return currentScore > bestScore ? cat : best;
                        }, categories[0] || 'N/A')}
                    </p>
                    <p className="test-history-kpi-subtext">Keep reviewing this area!</p>
                </div>
            </div>

            <div className="dashboard-content-area">
                <div className="performance-breakdown-card">
                    <h3>Performance Breakdown</h3>
                    <p className="test-results-subtitle">Distribution of your total correct answers.</p>
                    <div className="test-pie-chart-container">
                        <svg width="180" height="180" viewBox="0 0 120 120">
                            <g>
                                {totalCorrect > 0 ? categories.map(cat => {
                                    const { score } = overallScores[cat];
                                    if (score === 0) return null;
                                    const angle = (score / totalCorrect) * 360;
                                    const startAngle = cumulativeAngle;
                                    const endAngle = cumulativeAngle + angle;
                                    const pathData = getSlicePath(60, 60, 56, startAngle, endAngle);
                                    cumulativeAngle = endAngle;

                                    return (
                                        <path
                                            key={cat}
                                            d={pathData}
                                            fill={categoryColors[cat]?.fill || '#ccc'}
                                            stroke="white"
                                            strokeWidth="3"
                                            className="test-pie-slice"
                                            onMouseMove={(e) => setTooltip({ content: `${cat}: ${score}/${overallScores[cat].total}`, x: e.clientX + 15, y: e.clientY + 15 })}
                                            onMouseLeave={() => setTooltip(null)}
                                        />
                                    );
                                }) : <circle cx="60" cy="60" r="56" fill="#F3F4F6" />}
                            </g>
                            <circle cx="60" cy="60" r="38" fill="white" />
                        </svg>
                    </div>
                     <div className="test-legend-container">
                        {categories.map(cat => (
                            <div key={cat} className="test-legend-item">
                                <span className={`test-legend-dot ${categoryColors[cat]?.bg}`}></span>
                                <span className="test-legend-label">{cat}</span>
                                <span className="test-legend-score">{overallScores[cat].score}/{overallScores[cat].total}</span>
                            </div>
                        ))}
                    </div>
                </div>
                 <div className="category-cards-grid">
                     {categories.map(cat => {
                             const { score, total } = overallScores[cat];
                             if (total === 0) return null;
                             const avgScore = total > 0 ? Math.round((score / total) * 4) : 0;
                             const feedback = categoryFeedback[cat]?.[avgScore];
                             if (!feedback) return null;
                             return (
                                <div key={cat} className="test-feedback-card">
                                    <div>
                                        <h4>{cat}</h4>
                                        <p className="test-feedback-score">{score}/{total}</p>
                                        <p className="test-feedback-analysis">{feedback.analysis}</p>
                                    </div>
                                    <div className="test-feedback-tips">
                                        <h5>Actionable Tips:</h5>
                                        <ul>
                                            {feedback.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                                        </ul>
                                    </div>
                                </div>
                             );
                        })}
                </div>
            </div>
             <div className="test-action-buttons-container">
                <button onClick={onBack} className="test-action-button secondary">
                  Back to Dashboard
                </button>
                 <button onClick={onRetake} className="test-action-button primary">
                    Take a New Test
                </button>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

interface TestFeatureProps {
    activeDocuments: string[];
}

const TestFeature: FC<TestFeatureProps> = ({ activeDocuments }) => {
    const [currentView, setCurrentView] = useState<ViewState>('idle');
    const [isLoading, setIsLoading] = useState(false);
    const [testData, setTestData] = useState<TestData | null>(null);
    const [userAnswers, setUserAnswers] = useState<UserAnswers>({});
    
    // State is now initialized from localStorage and persisted with a useEffect hook.
    const [performanceHistory, setPerformanceHistory] = useState<PerformanceResult[]>(() => {
        try {
            const savedHistory = window.localStorage.getItem('performanceHistory');
            return savedHistory ? JSON.parse(savedHistory) : [];
        } catch (error) {
            console.error("Could not parse performance history from localStorage", error);
            return [];
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem('performanceHistory', JSON.stringify(performanceHistory));
        } catch (error) {
            console.error("Could not save performance history to localStorage", error);
        }
    }, [performanceHistory]);
    
    const overallPerformance = useMemo<CategoryScores>(() => {
        const combinedScores: CategoryScores = {
            "Cognitive Memory": { score: 0, total: 0 },
            "Logical Reasoning": { score: 0, total: 0 },
            "Critical Thinking": { score: 0, total: 0 },
            "Creative Application": { score: 0, total: 0 },
        };

        performanceHistory.forEach(result => {
            for (const category in result.scores) {
                if (combinedScores[category]) {
                    combinedScores[category].score += result.scores[category].score;
                    combinedScores[category].total += result.scores[category].total;
                }
            }
        });

        return combinedScores;
    }, [performanceHistory]);


    const handleGenerateTest = async () => {
        if (activeDocuments.length !== 1) {
            alert("Please select exactly one document from the 'Sources' panel to generate a test.");
            return;
        }
        const documentName = activeDocuments[0];

        setIsLoading(true);
        try {
            const { content } = await apiService.getDocumentText(documentName);
            const chunkSize = 18000;
            const overlap = 2000;
            const chunks = [];
            for (let i = 0; i < content.length; i += chunkSize - overlap) {
                chunks.push(content.substring(i, i + chunkSize));
            }
            const data = await apiService.generateTest(chunks);

            if (data.questions && data.questions.length > 0) {
                setTestData(data);
                setUserAnswers({});
                setCurrentView('takingTest');
            } else {
                throw new Error("Received an empty or invalid test from the server.");
            }
        } catch (error) {
            console.error("Failed to generate test:", error);
            alert(`Could not generate the test. Error: ${error instanceof Error ? error.message : String(error)}`);
            setCurrentView('idle');
        } finally {
            setIsLoading(false);
        }
    };
   
    const handleAnswerSelect = (questionId: number, answer: string) => {
        setUserAnswers(prev => ({ ...prev, [questionId]: answer }));
    };

    const handleFinishTest = () => {
        if (!testData) return;

        const scores: CategoryScores = {
            "Cognitive Memory": { score: 0, total: 0 },
            "Logical Reasoning": { score: 0, total: 0 },
            "Critical Thinking": { score: 0, total: 0 },
            "Creative Application": { score: 0, total: 0 },
        };
       
        testData.questions.forEach(q => {
            if (scores[q.category]) {
                scores[q.category].total += 1;
                if (userAnswers[q.id] === q.correctAnswer) {
                    scores[q.category].score += 1;
                }
            }
        });

        const newResult: PerformanceResult = { testId: testData.testId, scores, timestamp: Date.now() };
        setPerformanceHistory(prev => [...prev, newResult]);
        setCurrentView('results');
    };
   
    const handleExit = () => {
        setTestData(null);
        setUserAnswers({});
        setCurrentView('idle');
    }

    const latestResult = useMemo(() => {
        return performanceHistory.length > 0 ? performanceHistory[performanceHistory.length - 1] : null;
    }, [performanceHistory]);

    if (currentView === 'idle') {
        return (
             <div className="test-feature-container">
                <IdleView 
                    onGenerate={handleGenerateTest} 
                    loading={isLoading}
                    hasHistory={performanceHistory.length > 0}
                    onViewHistory={() => setCurrentView('history')}
                />
            </div>
        );
    }
    
    return createPortal(
        <div className="test-overlay">
            <div className="test-feature-container">
                <button className="test-exit-button" onClick={handleExit}>&times;</button>
                {currentView === 'takingTest' && testData && (
                    <TakingTestView
                        testData={testData}
                        userAnswers={userAnswers}
                        onAnswerSelect={handleAnswerSelect}
                        onFinish={handleFinishTest}
                        onExit={handleExit}
                    />
                )}
                {currentView === 'results' && latestResult && (
                    <ResultsView
                        result={latestResult}
                        onRetake={handleGenerateTest}
                        onViewHistory={() => setCurrentView('history')}
                    />
                )}
                {currentView === 'history' && (
                    <HistoryView
                        overallScores={overallPerformance}
                        history={performanceHistory}
                        onBack={() => setCurrentView('idle')}
                        onRetake={handleGenerateTest}
                    />
                )}
            </div>
        </div>,
        document.body
    );
};

export default TestFeature;