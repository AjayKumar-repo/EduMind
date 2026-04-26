import React from 'react';

const LoadingIndicator: React.FC = () => (
  <div className="loading-message fade-in">
    <div className="loading-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>
);

export default LoadingIndicator;
