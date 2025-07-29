import React from 'react';
import ReactMarkdown from 'react-markdown';

type ChatMessageProps = {
  message: string;
};

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  return (
    <div className="chat-message">
      <ReactMarkdown>{message}</ReactMarkdown>
    </div>
  );
};

export default ChatMessage;
