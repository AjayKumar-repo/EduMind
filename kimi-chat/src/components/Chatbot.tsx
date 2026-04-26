import React, { useState } from "react";


function Chatbot() {
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
  const [input, setInput] = useState("");

  const sendMessage = async () => {
    if (!input.trim()) return;

    setMessages([...messages, { sender: "user", text: input }]);
    setInput("");

    try {
      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });

      const data = await res.json();
      setMessages((prev) => [...prev, { sender: "bot", text: data.response }]);
    } catch {
      setMessages((prev) => [...prev, { sender: "bot", text: "Error talking to server." }]);
    }
  };

  return (
    <div className="chat-container">
      <h1>Kimi Chatbot 🤖</h1>
      <div className="chat-box">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.sender}`}>
            <strong>{msg.sender === "user" ? "You" : "Kimi"}:</strong> {msg.text}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

export default Chatbot;
