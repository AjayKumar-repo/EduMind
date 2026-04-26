import React, { useEffect, useState } from "react";

function Assessment() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/assessment/questions")
      .then((res) => res.json())
      .then((data) => setQuestions(data.questions || []));
  }, []);

  const submitAssessment = () => {
    fetch("http://127.0.0.1:8000/assessment/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    })
      .then((res) => res.json())
      .then((data) => setResult(data));
  };

  return (
    <div>
      <h1>📊 Learning Style Assessment</h1>
      {questions.map((q, idx) => (
        <div key={q.id}>
          <p>{q.question}</p>
          {q.options.map((opt: any) => (
            <label key={opt.type}>
              <input
                type="radio"
                name={`q-${q.id}`}
                value={opt.type}
                onChange={(e) => {
                  const updated = [...answers];
                  updated[idx] = e.target.value;
                  setAnswers(updated);
                }}
              />
              {opt.text}
            </label>
          ))}
        </div>
      ))}
      <button onClick={submitAssessment}>Submit</button>
      {result && (
        <div>
          <h2>Result: {result.learning_style}</h2>
          <p>{result.description}</p>
        </div>
      )}
    </div>
  );
}

export default Assessment;
