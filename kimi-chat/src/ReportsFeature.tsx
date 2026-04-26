import React, { useState, useEffect, FC, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Line, Radar, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ScriptableContext,
  RadialLinearScale,
} from 'chart.js';
import LoadingIndicator from './LoadingIndicator';

// Register Chart.js components
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler, RadialLinearScale
);

// --- Type Definitions ---
type AssessmentResult = {
  learning_style: string;
  description: string;
};

type ScoreDetail = {
  score: number;
  total: number;
};

type PerformanceResult = {
  testId: string;
  scores: { [key: string]: ScoreDetail };
  timestamp: number;
};

type CategoryScores = {
    [category: string]: {
      score: number;
      total: number;
    };
};

interface ReportsFeatureProps {
    assessmentResult: AssessmentResult | null;
}

// --- API Service for this Module ---
const API_BASE_URL = "http://127.0.0.1:8000/api/reports";

const reportsApiService = {
  calculateKnowledgePoints: async (history: PerformanceResult[]) => {
    const response = await fetch(`${API_BASE_URL}/knowledge-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
    });
    if (!response.ok) throw new Error("Failed to calculate knowledge points");
    return response.json();
  },
  getForgettingCurveData: async (history: PerformanceResult[]) => {
    const response = await fetch(`${API_BASE_URL}/forgetting-curve-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
    });
    if (!response.ok) throw new Error("Failed to get forgetting curve data");
    return response.json();
  },
};

// --- HELPER DATA & FUNCTIONS ---
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

const categoryColors: { [key: string]: string } = {
    "Cognitive Memory":     '#60a5fa',
    "Logical Reasoning":    '#4ade80',
    "Critical Thinking":    '#f87171',
    "Creative Application": '#facc15',
};

const categoryDefinitions: { [key: string]: string } = {
    "Cognitive Memory": "This skill measures your ability to recall specific facts, definitions, and details presented in the material.",
    "Logical Reasoning": "This skill assesses how well you follow arguments, understand cause-and-effect, and draw conclusions from the text.",
    "Critical Thinking": "This skill evaluates your ability to analyze, question, and judge the strengths and weaknesses of the information provided.",
    "Creative Application": "This skill tests your capacity to use the concepts from the material to solve new, unfamiliar problems.",
};

const personalizedTips: { [style: string]: { [category: string]: string } } = {
    pictorial: { "Cognitive Memory": "Try creating mind maps or flashcards with diagrams to visually link key facts." },
    kinesthetic: { "Creative Application": "Set up a small project or experiment to physically apply the concepts you've learned." },
    vocal: { "Logical Reasoning": "Talk through the arguments out loud, either to yourself or a friend, to better understand the flow." },
    memorizer: { "Cognitive Memory": "Use mnemonic devices (like acronyms or rhymes) and spaced repetition to solidify details." }
};


// --- ADVANCED MODAL COMPONENT ---
const DetailedPerformanceModal: FC<{
    overallScores: CategoryScores;
    history: PerformanceResult[];
    onClose: () => void;
    assessmentResult: AssessmentResult | null;
}> = ({ overallScores, history, onClose, assessmentResult }) => {
    const [activeTab, setActiveTab] = useState('trends');
    const [showChartHelp, setShowChartHelp] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'ascending' | 'descending' }>({ key: null, direction: 'ascending' });
    const [selectedTestIndex, setSelectedTestIndex] = useState(history.length -1);

    const categoryTrajectoryData = useMemo(() => {
        const labels = history.map((_, i) => `Test ${i + 1}`);
        const datasets = Object.keys(overallScores).map(category => {
            const data = history.map(result => {
                const scoreDetail = result.scores[category];
                if (!scoreDetail || scoreDetail.total === 0) return 0;
                return (scoreDetail.score / scoreDetail.total) * 100;
            });
            return {
                label: category, data, borderColor: categoryColors[category],
                backgroundColor: categoryColors[category] + '33', tension: 0.1
            };
        });
        return { labels, datasets };
    }, [history, overallScores]);

    const { weakestCategoryInfo, strongestCategoryName, mostImprovedCategory, comparativeAnalysis, consistencyScores } = useMemo(() => {
        let weakestCat = '', strongestCat = '', mostImprovedCat = '';
        let lowestScore = 101, highestScore = -1, maxImprovement = -200;
        let bestScoreInWeakest = -1, worstScoreInWeakest = 101;
        const consistency: { [key: string]: string } = {};

        for (const category in overallScores) {
            const { score, total } = overallScores[category];
            if (total > 0) {
                const avg = (score / total) * 100;
                if (avg < lowestScore) { lowestScore = avg; weakestCat = category; }
                if (avg > highestScore) { highestScore = avg; strongestCat = category; }

                const categoryScores = history.map(h => h.scores[category] ? (h.scores[category].score / h.scores[category].total) * 100 : 0).filter(s => s !== null);
                if (categoryScores.length > 1) {
                    const mean = categoryScores.reduce((a, b) => a + b) / categoryScores.length;
                    const stdDev = Math.sqrt(categoryScores.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / categoryScores.length);
                    if (stdDev < 15) consistency[category] = 'Very Consistent';
                    else if (stdDev < 25) consistency[category] = 'Consistent';
                    else consistency[category] = 'Inconsistent';

                    const firstScore = categoryScores[0];
                    const lastScore = categoryScores[categoryScores.length-1];
                    const improvement = lastScore - firstScore;
                    if(improvement > maxImprovement) {
                        maxImprovement = improvement;
                        mostImprovedCat = category;
                    }
                } else {
                    consistency[category] = 'N/A';
                }
            }
        }
        
        if (weakestCat) {
            history.forEach(result => {
                const catScoreDetail = result.scores[weakestCat];
                if (catScoreDetail && catScoreDetail.total > 0) {
                    const scorePercent = (catScoreDetail.score / catScoreDetail.total) * 100;
                    if (scorePercent > bestScoreInWeakest) bestScoreInWeakest = scorePercent;
                    if (scorePercent < worstScoreInWeakest) worstScoreInWeakest = scorePercent;
                }
            });
        }

        const lastTest = history[history.length - 1];
        const comparison = Object.keys(overallScores).map(cat => {
            const avg = overallScores[cat].total > 0 ? (overallScores[cat].score / overallScores[cat].total) * 100 : 0;
            const last = lastTest?.scores[cat] && lastTest.scores[cat].total > 0 ? (lastTest.scores[cat].score / lastTest.scores[cat].total) * 100 : 0;
            return { category: cat, diff: last - avg };
        });
        
        const avgScoreForFeedback = Math.round((lowestScore / 100) * 4);
        const feedback = categoryFeedback[weakestCat]?.[avgScoreForFeedback];

        const pTip = assessmentResult?.learning_style && weakestCat ? personalizedTips[assessmentResult.learning_style]?.[weakestCat] : null;

        return {
            weakestCategoryInfo: { name: weakestCat, avgScore: lowestScore, feedback, bestPerf: bestScoreInWeakest, worstPerf: worstScoreInWeakest, personalizedTip: pTip },
            strongestCategoryName: strongestCat,
            mostImprovedCategory: mostImprovedCat || 'N/A',
            comparativeAnalysis: comparison,
            consistencyScores: consistency
        };
    }, [overallScores, history, assessmentResult]);
    
    const temporalData = useMemo(() => {
        const dayScores: { [key: string]: { total: number, count: number } } = { Sun: {total:0, count:0}, Mon: {total:0, count:0}, Tue: {total:0, count:0}, Wed: {total:0, count:0}, Thu: {total:0, count:0}, Fri: {total:0, count:0}, Sat: {total:0, count:0} };
        const timeScores: { [key: string]: { total: number, count: number } } = { Morning: {total:0, count:0}, Afternoon: {total:0, count:0}, Evening: {total:0, count:0} };
        
        history.forEach(test => {
            const date = new Date(test.timestamp);
            const day = date.toLocaleString('en-US', { weekday: 'short' });
            const hour = date.getHours();
            
            let timeOfDay = 'Evening';
            if (hour >= 5 && hour < 12) timeOfDay = 'Morning';
            else if (hour >= 12 && hour < 18) timeOfDay = 'Afternoon';
            
            const totalScore = Object.values(test.scores).reduce((sum, s) => sum + s.score, 0);
            const totalQs = Object.values(test.scores).reduce((sum, s) => sum + s.total, 0);
            const perc = totalQs > 0 ? (totalScore / totalQs) * 100 : 0;
            
            dayScores[day].total += perc;
            dayScores[day].count += 1;
            timeScores[timeOfDay].total += perc;
            timeScores[timeOfDay].count += 1;
        });
        
        const dayLabels = Object.keys(dayScores);
        const dayData = dayLabels.map(day => dayScores[day].count > 0 ? dayScores[day].total / dayScores[day].count : 0);
        
        const timeLabels = ['Morning', 'Afternoon', 'Evening'];
        const timeData = timeLabels.map(time => timeScores[time].count > 0 ? timeScores[time].total / timeScores[time].count : 0);
        
        return { dayChart: { labels: dayLabels, datasets: [{ label: 'Avg Score', data: dayData, backgroundColor: '#a78bfa' }] }, timeChart: { labels: timeLabels, datasets: [{ label: 'Avg Score', data: timeData, backgroundColor: '#fb923c' }] } };
    }, [history]);


    const sortedHistory = useMemo(() => {
        let sortableItems = [...history];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                const scoreA = a.scores[sortConfig.key!] ? (a.scores[sortConfig.key!].score / a.scores[sortConfig.key!].total) : -1;
                const scoreB = b.scores[sortConfig.key!] ? (b.scores[sortConfig.key!].score / b.scores[sortConfig.key!].total) : -1;
                if (scoreA < scoreB) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (scoreA > scoreB) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [history, sortConfig]);

    const requestSort = (key: string) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getScoreColor = (score: number) => {
        if (score < 40) return '#fee2e2'; // red
        if (score < 70) return '#fef3c7'; // yellow
        return '#dcfce7'; // green
    };

    const selectedTestData = useMemo(() => {
        if (!history[selectedTestIndex]) return null;
        const test = history[selectedTestIndex];
        const totalScore = Object.values(test.scores).reduce((sum, s) => sum + s.score, 0);
        const totalQs = Object.values(test.scores).reduce((sum, s) => sum + s.total, 0);
        const overall = totalQs > 0 ? (totalScore / totalQs) * 100 : 0;
        
        const barData = {
            labels: Object.keys(categoryColors),
            datasets: [{
                label: `Test ${selectedTestIndex + 1} Scores`,
                data: Object.keys(categoryColors).map(cat => test.scores[cat] ? (test.scores[cat].score / test.scores[cat].total) * 100 : 0),
                backgroundColor: Object.values(categoryColors),
            }]
        };
        
        return { overall, barData };
    }, [history, selectedTestIndex]);


    return createPortal(
        <div className="reports-modal-overlay">
            <div className="reports-modal-content">
                <button className="reports-modal-close-btn" onClick={onClose}>&times;</button>
                <div className="test-history-header">
                    <h1>Comprehensive Performance Analysis</h1>
                </div>
                <div className="modal-tabs">
                    <button className={`modal-tab ${activeTab === 'trends' ? 'active' : ''}`} onClick={() => setActiveTab('trends')}>Performance Trends</button>
                    <button className={`modal-tab ${activeTab === 'breakdown' ? 'active' : ''}`} onClick={() => setActiveTab('breakdown')}>Test-by-Test Breakdown</button>
                    <button className={`modal-tab ${activeTab === 'single_test' ? 'active' : ''}`} onClick={() => setActiveTab('single_test')}>Single Test Analysis</button>
                    <button className={`modal-tab ${activeTab === 'temporal' ? 'active' : ''}`} onClick={() => setActiveTab('temporal')}>Temporal Insights</button>
                    <button className={`modal-tab ${activeTab === 'guide' ? 'active' : ''}`} onClick={() => setActiveTab('guide')}>Category Guide</button>
                </div>

                {activeTab === 'trends' && (
                    <div className="modal-tab-content">
                        <div className="performance-summary-card">
                            <h4>Key Takeaways</h4>
                            <p>
                                Your performance analysis shows that your greatest strength is in <strong>{strongestCategoryName || '...'}</strong>.
                                The most significant opportunity for improvement is in <strong>{weakestCategoryInfo.name || '...'}</strong>.
                                Use the targeted plan below to focus your studying.
                            </p>
                        </div>
                        <div className="deep-dive-grid">
                            <div className="deep-dive-chart-card">
                                <h4>Performance Trajectory by Category</h4>
                                <p className="subtitle">Track your progress for each skill across all tests.</p>
                                <div className="chart-wrapper" style={{height: '300px'}}>
                                    <Line data={categoryTrajectoryData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, title: {display: true, text: 'Score (%)' } } } }} />
                                </div>
                                <div className="chart-help-container">
                                    <button className="chart-help-toggle" onClick={() => setShowChartHelp(!showChartHelp)}>
                                        {showChartHelp ? 'Hide' : 'How to read this chart'}
                                    </button>
                                    {showChartHelp && (
                                        <div className="chart-help-text">
                                            Each colored line represents a skill. Look for upward trends over time, which signal improvement. Consistent low scores in one color highlight an area needing more attention.
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="deep-dive-review-card">
                                <h4>Targeted Review Plan</h4>
                                <p className="subtitle">Focus on your weakest area to improve faster.</p>
                                {weakestCategoryInfo.name ? (
                                    <>
                                        <div className="weakest-category-header">
                                            <span className="weakest-label">Weakest Category</span>
                                            <h5 style={{color: categoryColors[weakestCategoryInfo.name]}}>{weakestCategoryInfo.name}</h5>
                                            <span className="weakest-score">{weakestCategoryInfo.avgScore.toFixed(0)}% Avg.</span>
                                        </div>
                                        <div className="weakest-category-stats">
                                            <span>Best Score: {weakestCategoryInfo.bestPerf.toFixed(0)}%</span>
                                            <span>Worst Score: {weakestCategoryInfo.worstPerf.toFixed(0)}%</span>
                                        </div>
                                        <div className="test-feedback-tips">
                                           <h5>Actionable Tips:</h5>
                                           {weakestCategoryInfo.personalizedTip && (
                                                <p className="personalized-tip">
                                                    <strong>For You ({assessmentResult?.learning_style}):</strong> {weakestCategoryInfo.personalizedTip}
                                                </p>
                                           )}
                                           <ul>
                                               {weakestCategoryInfo.feedback?.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                                           </ul>
                                       </div>
                                    </>
                                ) : <p>Complete more tests to get a review plan.</p>}
                            </div>
                        </div>
                    </div>
                )}
                
                {activeTab === 'breakdown' && (
                    <div className="modal-tab-content">
                        <div className="breakdown-grid">
                            <div className="breakdown-highlights-card">
                                <h4>Performance Highlights</h4>
                                <div className="highlights-grid">
                                    <div className="highlight-item">
                                        <span className="highlight-label">Most Improved Category</span>
                                        <span className="highlight-value" style={{color: categoryColors[mostImprovedCategory]}}>{mostImprovedCategory}</span>
                                    </div>
                                    {Object.entries(consistencyScores).map(([category, consistency]) => (
                                         <div className="highlight-item" key={category}>
                                            <span className="highlight-label">{category} Consistency</span>
                                            <span className="highlight-value">{consistency}</span>
                                        </div>
                                    ))}
                                    {comparativeAnalysis.map(({category, diff}) => (
                                        <div className="highlight-item" key={category}>
                                            <span className="highlight-label">{category} (Last Test vs Avg)</span>
                                            <span className={`highlight-value ${diff >= 0 ? 'positive' : 'negative'}`}>
                                                {diff >= 0 ? '+' : ''}{diff.toFixed(0)}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="breakdown-table-card">
                                <h4>Detailed Score Table</h4>
                                <div className="performance-table-container">
                                    <table className="performance-table">
                                        <thead>
                                            <tr>
                                                <th>Test #</th>
                                                {Object.keys(categoryColors).map(cat => (
                                                    <th key={cat} onClick={() => requestSort(cat)} className="sortable-header">
                                                        {cat} {sortConfig.key === cat ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : null}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedHistory.map((result, index) => (
                                                <tr key={result.testId}>
                                                    <td>{history.findIndex(h => h.testId === result.testId) + 1}</td>
                                                    {Object.keys(categoryColors).map(cat => {
                                                        const scoreDetail = result.scores[cat];
                                                        const score = scoreDetail && scoreDetail.total > 0 ? (scoreDetail.score / scoreDetail.total) * 100 : 0;
                                                        return <td key={cat} style={{background: getScoreColor(score)}}>{score.toFixed(0)}%</td>
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'single_test' && (
                    <div className="modal-tab-content">
                        <div className="single-test-header">
                            <label htmlFor="test-select">Select a test to analyze:</label>
                            <select id="test-select" value={selectedTestIndex} onChange={e => setSelectedTestIndex(Number(e.target.value))}>
                                {history.map((_, index) => <option key={index} value={index}>Test {index + 1}</option>)}
                            </select>
                            <h4>Overall Score: {selectedTestData?.overall.toFixed(0)}%</h4>
                        </div>
                        <div className="deep-dive-grid">
                            <div className="deep-dive-chart-card">
                                <h5>Category Scores for Test {selectedTestIndex + 1}</h5>
                                <div className="chart-wrapper" style={{height: '300px'}}>
                                    <Bar data={selectedTestData!.barData} options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100 } } }} />
                                </div>
                            </div>
                            <div className="deep-dive-review-card">
                                <h5>This Test vs. Your Average</h5>
                                {comparativeAnalysis.map(({ category, diff }) => {
                                    const testScore = selectedTestData?.barData.datasets[0].data[Object.keys(categoryColors).indexOf(category)] || 0;
                                    const avgScore = testScore - diff;
                                    return (
                                        <div className="highlight-item" key={category}>
                                            <span className="highlight-label">{category}</span>
                                            <div className="comparison-bar">
                                                <span>Test: {testScore.toFixed(0)}%</span>
                                                <span className={`highlight-value ${diff >= 0 ? 'positive' : 'negative'}`}>
                                                    ({diff >= 0 ? '+' : ''}{diff.toFixed(0)}% vs avg)
                                                </span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
                
                {activeTab === 'temporal' && (
                     <div className="modal-tab-content">
                        <div className="deep-dive-grid">
                            <div className="deep-dive-chart-card">
                                <h4>Average Score by Day of Week</h4>
                                <div className="chart-wrapper" style={{height: '300px'}}>
                                    <Bar data={temporalData.dayChart} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }} />
                                </div>
                            </div>
                             <div className="deep-dive-chart-card">
                                <h4>Average Score by Time of Day</h4>
                                <div className="chart-wrapper" style={{height: '300px'}}>
                                    <Bar data={temporalData.timeChart} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'guide' && (
                    <div className="modal-tab-content">
                         <div className="category-definitions-card standalone">
                            <h4>Understanding the Categories</h4>
                            <p className="subtitle">Learn what each skill category measures to better understand your results.</p>
                            <div className="category-definitions-grid">
                                {Object.entries(categoryDefinitions).map(([name, def]) => (
                                    <div key={name} className="category-def-item">
                                        <h6 style={{color: categoryColors[name]}}>{name}</h6>
                                        <p>{def}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};


// --- Main Reports Component ---
const ReportsFeature: FC<ReportsFeatureProps> = ({ assessmentResult }) => {
    // ... (This section is unchanged)
    const [knowledgeData, setKnowledgeData] = useState<any>(null);
    const [curveData, setCurveData] = useState<any>(null);
    const [performanceHistory, setPerformanceHistory] = useState<PerformanceResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isDetailedViewOpen, setIsDetailedViewOpen] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const savedHistory = window.localStorage.getItem('performanceHistory');
                const history: PerformanceResult[] = savedHistory ? JSON.parse(savedHistory) : [];
                setPerformanceHistory(history);

                if (history.length > 0) {
                    const [pointsData, forgettingData] = await Promise.all([
                        reportsApiService.calculateKnowledgePoints(history),
                        reportsApiService.getForgettingCurveData(history),
                    ]);
                    setKnowledgeData(pointsData);
                    setCurveData(forgettingData);
                } else {
                    setKnowledgeData(null);
                    setCurveData(null);
                }
            } catch (err) {
                console.error("Failed to fetch report data:", err);
                setError(err instanceof Error ? err.message : "An unknown error occurred.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, []);

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

    const LearnerBadge = () => {
        if (!assessmentResult) {
            return (
                <div className="report-card learner-badge-card placeholder">
                    <div className="badge-icon">?</div>
                    <div className="badge-text">
                        <h4>Unknown Learning Style</h4>
                        <p>Complete the assessment to discover your learning style!</p>
                    </div>
                </div>
            );
        }
        const { learning_style } = assessmentResult;
        const icons: { [key: string]: string } = { 'pictorial': '👁️', 'vocal': '👂', 'memorizer': '🧠', 'kinesthetic': '🖐️' };
        const displayName: { [key: string]: string } = { 'pictorial': 'Pictorial', 'vocal': 'Vocal', 'memorizer': 'Memorizer', 'kinesthetic': 'Kinesthetic' };
        return (
            <div className="report-card learner-badge-card">
                <div className="badge-icon">{icons[learning_style] || '🧠'}</div>
                <div className="badge-text">
                    <h4>{displayName[learning_style]} Learner</h4>
                    <p>You learn best through {learning_style.toLowerCase()} methods.</p>
                </div>
            </div>
        );
    };

    const KnowledgePoints = () => {
        if (!knowledgeData) {
            return (
                 <div className="report-card knowledge-points-card placeholder">
                    <h4>Knowledge Points</h4>
                    <p>Take tests to start earning points and see your progress here.</p>
                </div>
            );
        }
        const { points, tier, nextTierPoints, currentTierMin } = knowledgeData;
        const progress = nextTierPoints === Infinity ? 100 : ((points - currentTierMin) / (nextTierPoints - currentTierMin)) * 100;
        return (
            <div className="report-card knowledge-points-card">
                <h4>Knowledge Points</h4>
                <div className="brain-container">
                    <svg className="brain-svg" viewBox="0 0 100 100">
                        <defs>
                            <clipPath id="brain-clip">
                                <path d="M50,2 C27,2 12,18 12,35 C12,52 20,65 30,75 C35,80 40,90 40,98 L60,98 C60,90 65,80 70,75 C80,65 88,52 88,35 C88,18 73,2 50,2 Z" />
                            </clipPath>
                             <linearGradient id="brain-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
                                <stop offset="0%" style={{stopColor: 'var(--primary-color)', stopOpacity: 1}} />
                                <stop offset="100%" style={{stopColor: 'var(--success-color)', stopOpacity: 1}} />
                            </linearGradient>
                        </defs>
                        <rect x="0" y="0" width="100" height="100" fill="#e0e7ff" clipPath="url(#brain-clip)" />
                        <rect x="0" y={100 - progress} width="100" height={progress} fill="url(#brain-gradient)" clipPath="url(#brain-clip)" />
                        <path d="M50,2 C27,2 12,18 12,35 C12,52 20,65 30,75 C35,80 40,90 40,98 L60,98 C60,90 65,80 70,75 C80,65 88,52 88,35 C88,18 73,2 50,2 Z" stroke="var(--primary-color)" strokeWidth="1.5" fill="none" />
                    </svg>
                    <div className="brain-text">{points} KP</div>
                </div>
                <div className="tier-info">
                    <span className="tier-badge">{tier}</span>
                    {nextTierPoints !== Infinity && <p>{nextTierPoints - points} points to next tier</p>}
                </div>
            </div>
        );
    };

    const ForgettingCurve = () => {
        if (!curveData) {
            return (
                <div className="report-card forgetting-curve-card placeholder">
                     <h4>Memory Retention</h4>
                     <p>Your personalized forgetting curve will appear here after you complete a test.</p>
                </div>
            )
        }
        const chartData = {
            labels: curveData.curveData.map((d: any) => `Day ${d.x}`),
            datasets: [{
                label: `Retention (%)`, data: curveData.curveData.map((d: any) => d.y), fill: true,
                backgroundColor: 'rgba(72, 149, 239, 0.2)',
                borderColor: (context: ScriptableContext<"line">) => {
                    const chart = context.chart; const {ctx, chartArea} = chart;
                    if (!chartArea) return undefined;
                    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                    gradient.addColorStop(0, 'rgba(67, 97, 238, 1)');
                    gradient.addColorStop(0.5, 'rgba(72, 149, 239, 1)');
                    gradient.addColorStop(1, 'rgba(76, 201, 240, 1)');
                    return gradient;
                },
                tension: 0.4, pointBackgroundColor: 'rgba(72, 149, 239, 1)', borderWidth: 3,
            }]
        };
        const chartOptions = { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
                tooltip: { enabled: true, backgroundColor: 'rgba(33, 37, 41, 0.85)', titleColor: '#fff', bodyColor: '#fff', titleFont: { size: 14, weight: 'bold' as const }, bodyFont: { size: 12 }, padding: 12, cornerRadius: 8, displayColors: false,
                    callbacks: {
                        title: (context: any) => `After ${context[0].label}`,
                        label: (context: any) => `  Estimated Retention: ${context.parsed.y.toFixed(1)}%`,
                    }
                }
            },
            scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: 'Memory Retention (%)' }, grid: { color: '#eef0ff' } },
                x: { title: { display: true, text: 'Time Since Last Review (Days)' }, grid: { display: false } }
            }
        };
        return (
            <div className="report-card forgetting-curve-card">
                <h4>Memory Retention Curve</h4>
                <p className="subtitle">Based on knowledge from: {curveData.topic}</p>
                 <div className="chart-container">
                    <Line options={chartOptions as any} data={chartData} />
                 </div>
                 <p className="retention-summary">
                    Your estimated current retention is <strong>{curveData.currentRetention.toFixed(2)}%</strong>.
                    Consider reviewing it soon to boost your memory!
                 </p>
            </div>
        );
    };

    const AdvancedPerformanceDashboard = () => {
        const PerformanceTrendChart = ({ history }: { history: PerformanceResult[] }) => {
            const data = {
                labels: history.map((_, index) => `Test ${index + 1}`),
                datasets: [{
                    label: 'Overall Score (%)', data: history.map(result => {
                        const totalCorrect = Object.values(result.scores).reduce((sum, s) => sum + s.score, 0);
                        const totalQuestions = Object.values(result.scores).reduce((sum, s) => sum + s.total, 0);
                        return totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
                    }),
                    fill: false, borderColor: 'var(--primary-color)', tension: 0.3,
                }]
            };
            const options = { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } };
            return <div className="chart-wrapper"><Line data={data} options={options} /></div>;
        };
        const SkillsRadarChart = ({ performance }: { performance: CategoryScores }) => {
            const labels = Object.keys(performance);
            const data = {
                labels,
                datasets: [{
                    label: 'Average Score (%)', data: labels.map(cat => {
                        const { score, total } = performance[cat];
                        return total > 0 ? (score / total) * 100 : 0;
                    }),
                    backgroundColor: 'rgba(67, 97, 238, 0.2)', borderColor: 'rgba(67, 97, 238, 1)', borderWidth: 2,
                }]
            };
            const options = { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 100, pointLabels: { font: { size: 12 } } } }, plugins: { legend: { display: false } } };
            return <div className="chart-wrapper"><Radar data={data} options={options} /></div>;
        };
        return (
            <div className="report-card">
                <h4 style={{ marginBottom: '5px' }}>Advanced Performance Analytics</h4>
                <p className="subtitle" style={{marginBottom: '20px'}}>A summary of your skills and progress over time.</p>
                <div className="advanced-analytics-grid">
                    <div className="analytics-card">
                        <h5>Performance Over Time</h5>
                        <p className="subtitle">Your scores across all completed tests.</p>
                        <PerformanceTrendChart history={performanceHistory} />
                    </div>
                    <div className="analytics-card">
                        <h5>Cognitive Skills Profile</h5>
                        <p className="subtitle">Your overall proficiency by category.</p>
                        <SkillsRadarChart performance={overallPerformance} />
                    </div>
                </div>
                <div className="view-more-container">
                    <button className="view-more-btn" onClick={() => setIsDetailedViewOpen(true)}>
                        Click to view detailed breakdown
                    </button>
                </div>
            </div>
        );
    };

    if (isLoading) return <div className="loading-message" style={{justifyContent: 'center', height: '100%'}}><LoadingIndicator /> Loading Reports...</div>;
    if (error) return <div className="error-message">Error: {error}</div>;

    return (
        <>
            {isDetailedViewOpen && (
                <DetailedPerformanceModal
                    overallScores={overallPerformance}
                    history={performanceHistory}
                    onClose={() => setIsDetailedViewOpen(false)}
                    assessmentResult={assessmentResult}
                />
            )}
            <style>{`
                /* ... (All other styles remain the same) ... */
                .reports-container { display: flex; flex-direction: column; gap: 20px; height: 100%; overflow-y: auto; padding-right: 10px; }
                .report-card { background-color: #ffffff; border: 1px solid #eef0ff; border-radius: 12px; padding: 20px; box-shadow: 0 4px 15px rgba(67, 97, 238, 0.05); }
                .report-card.placeholder { text-align: center; color: var(--text-light); display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 150px; }
                .reports-top-section { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
                .learner-badge-card { display: flex; align-items: center; gap: 20px; }
                .badge-icon { font-size: 3em; }
                .badge-text h4 { margin: 0 0 5px 0; color: var(--primary-color); }
                .badge-text p { margin: 0; font-size: 0.9em; }
                .knowledge-points-card { display: flex; flex-direction: column; align-items: center; text-align: center; justify-content: center; }
                .knowledge-points-card h4 { margin: 0 0 15px 0; }
                .brain-container { position: relative; width: 100px; height: 100px; margin-bottom: 15px; }
                .brain-svg { width: 100%; height: 100%; }
                .brain-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 1.1em; font-weight: 700; color: var(--primary-color); }
                .tier-info .tier-badge { background-color: var(--primary-color); color: white; padding: 5px 15px; border-radius: 20px; font-weight: 600; font-size: 0.9em; }
                .tier-info p { font-size: 0.8em; margin-top: 8px; color: var(--text-light); }
                .forgetting-curve-card { display: flex; flex-direction: column; }
                .forgetting-curve-card h4 { margin: 0 0 5px 0; }
                .forgetting-curve-card .subtitle, .analytics-card .subtitle, .report-card .subtitle { margin: 0 0 15px 0; font-size: 0.9em; color: var(--text-light); }
                .chart-container { flex: 1; position: relative; min-height: 250px; }
                .retention-summary { text-align: center; font-size: 0.9em; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eef0ff; }
                .advanced-analytics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; align-items: stretch; }
                .analytics-card { background-color: #f8f9ff; padding: 20px; border-radius: 12px; display: flex; flex-direction: column; }
                .analytics-card h5 { margin: 0 0 5px 0; color: var(--text-color); }
                .chart-wrapper { position: relative; height: 250px; flex-grow: 1; }
                .view-more-container { margin-top: 20px; text-align: center; }
                .view-more-btn { background-color: var(--primary-color); color: white; border: none; padding: 10px 25px; border-radius: 20px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
                .view-more-btn:hover { background-color: var(--secondary-color); transform: translateY(-2px); }
                
                /* --- MODAL STYLES --- */
                .reports-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.6); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); animation: fadeIn 0.3s ease; }
                .reports-modal-content { background-color: #F9FAFB; width: 90%; max-width: 1200px; height: 90vh; border-radius: 16px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); padding: 2rem 3rem; box-sizing: border-box; display: flex; flex-direction: column; position: relative; overflow-y: auto; gap: 1.5rem; }
                .reports-modal-close-btn { position: absolute; top: 1rem; right: 1.5rem; background: none; border: none; font-size: 2.5rem; line-height: 1; color: #9CA3AF; cursor: pointer; z-index: 10; transition: color 0.2s ease; }
                .reports-modal-close-btn:hover { color: #1F2937; }
                .modal-tabs { display: flex; gap: 1rem; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
                .modal-tab { padding: 0.75rem 1.5rem; border: none; background: none; cursor: pointer; font-size: 1rem; font-weight: 500; color: #6B7280; border-bottom: 3px solid transparent; }
                .modal-tab.active { color: var(--primary-color); font-weight: 600; border-bottom-color: var(--primary-color); }
                .modal-tab-content { animation: fadeIn 0.4s ease; padding-top: 1rem; }
                .performance-summary-card { background-color: #eef2ff; border-left: 5px solid var(--primary-color); border-radius: 8px; padding: 1rem 1.5rem; }
                .performance-summary-card h4 { margin: 0 0 0.5rem 0; color: var(--primary-color); }
                .performance-summary-card p { margin: 0; color: #374151; }
                .deep-dive-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; }
                .deep-dive-chart-card, .deep-dive-review-card, .category-definitions-card { background: white; border-radius: 12px; padding: 20px; border: 1px solid #e5e7eb; }
                .deep-dive-review-card { display: flex; flex-direction: column; }
                .weakest-category-header { text-align: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 1rem; margin-bottom: 1rem; }
                .weakest-label { font-size: 0.8rem; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px;}
                .weakest-category-header h5 { margin: 5px 0; font-size: 1.5rem; }
                .weakest-score { font-size: 1rem; font-weight: 600; color: #4B5563;}
                .weakest-category-stats { display: flex; justify-content: space-around; font-size: 0.9rem; color: #4B5563; margin-bottom: 1rem;}
                .chart-help-container { margin-top: 1rem; text-align: center;}
                .chart-help-toggle { background: none; border: none; color: var(--primary-color); cursor: pointer; font-size: 0.9em; font-weight: 500;}
                .chart-help-text { background-color: #f8f9ff; padding: 0.75rem; border-radius: 8px; margin-top: 0.5rem; font-size: 0.85em; color: #4B5563; text-align: left;}
                .category-definitions-card.standalone { margin-top: 0; }
                .category-definitions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
                .category-def-item h6 { margin: 0 0 0.25rem 0; font-size: 1em; }
                .category-def-item p { margin: 0; font-size: 0.85em; color: #4B5563; }
                .test-history-header { text-align: center; margin-bottom: 1rem; flex-shrink: 0; }
                .test-history-header h1 { font-size: 1.75rem; font-weight: 800; color: #1F2937; margin-bottom: 0; }
                .test-history-header p { font-size: 1rem; color: #4B5563; margin-top: 0.25rem; }
                .test-feedback-tips { margin-top: auto; padding-top: 1rem; border-top: 1px solid #F3F4F6; }
                .test-feedback-tips h5 { font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.875rem; }
                .test-feedback-tips ul { list-style-type: '✓'; list-style-position: outside; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.875rem; color: #4B5563; margin: 0; }
                .test-feedback-tips ul li::marker { color: var(--primary-color); }
                .personalized-tip { font-size: 0.9em; background-color: #eef2ff; border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem;}
                .breakdown-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 1.5rem; }
                .breakdown-highlights-card, .breakdown-table-card { background: white; border-radius: 12px; padding: 20px; border: 1px solid #e5e7eb; }
                .highlights-grid { display: flex; flex-direction: column; gap: 1rem; }
                .highlight-item { background-color: #f8f9ff; padding: 0.75rem; border-radius: 8px; }
                .highlight-label { display: block; font-size: 0.8rem; color: #6B7280; margin-bottom: 0.25rem; }
                .highlight-value { font-size: 1.2rem; font-weight: 600; }
                .highlight-value.positive { color: #16a34a; }
                .highlight-value.negative { color: #ef4444; }
                .performance-table-container { max-height: 450px; overflow-y: auto; }
                .performance-table { width: 100%; border-collapse: collapse; }
                .performance-table th, .performance-table td { padding: 0.75rem; text-align: center; border-bottom: 1px solid #e5e7eb; }
                .performance-table th.sortable-header { cursor: pointer; user-select: none; }
                .performance-table th.sortable-header:hover { background-color: #f8f9ff; }
                .performance-table th { font-size: 0.8rem; color: #6B7280; }
                .performance-table td { font-weight: 500; }
                .single-test-header { display: flex; align-items: center; gap: 1.5rem; margin-bottom: 1.5rem; background: white; padding: 1rem; border-radius: 12px; border: 1px solid #e5e7eb; }
                .single-test-header label { font-weight: 500; }
                .single-test-header select { font-size: 1rem; padding: 0.5rem; border-radius: 8px; border: 1px solid #d1d5db; }
                .single-test-header h4 { margin: 0; margin-left: auto; }
                .comparison-bar { display: flex; justify-content: space-between; align-items: center; }
            `}</style>
            <div className="reports-container">
                <div className="reports-top-section">
                    <LearnerBadge />
                    <KnowledgePoints />
                </div>
                <ForgettingCurve />
                {performanceHistory.length > 0 ? (
                    <AdvancedPerformanceDashboard />
                ) : (
                    <div className="report-card placeholder">
                        <h4>Advanced Performance Analytics</h4>
                        <p>Complete a test to see your trend analysis and skills profile here.</p>
                    </div>
                )}
            </div>
        </>
    );
};

export default ReportsFeature;