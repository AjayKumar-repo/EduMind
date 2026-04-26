import React, { useState } from 'react';
import { BrainCircuit } from 'lucide-react'; // Make sure to run: npm install lucide-react

interface LoginPageProps {
  onLogin: () => void; // Prop simplified to not require a userType string
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleLoginSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // In a real app, you'd validate credentials here.
    onLogin();
  };

  const handleRegisterSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match!");
      return;
    }
    setError('');
    console.log("Registration submitted");
    // After successful registration, log the user in.
    onLogin();
  };

  return (
    <>
      <style>{`
        .login-page-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          width: 100vw;
          background-color: #f3f4f6;
          font-family: 'Montserrat', sans-serif;
        }
        .login-card {
          width: 100%;
          max-width: 28rem;
          padding: 2.5rem 2rem;
          margin: 1rem;
          background-color: white;
          border-radius: 1rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
          animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .login-header {
          text-align: center;
        }
        .login-icon-wrapper {
          display: inline-flex;
          padding: 1rem;
          background-color: #eef2ff;
          border-radius: 9999px;
        }
        .login-icon {
          width: 2.5rem;
          height: 2.5rem;
          color: #4f46e5;
        }
        .login-title {
          margin-top: 1rem;
          font-size: 1.875rem;
          font-weight: 700;
          color: #111827;
        }
        .login-subtitle {
          margin-top: 0.5rem;
          font-size: 0.875rem;
          color: #4b5563;
        }
        .login-form {
          margin-top: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .login-input-group {
          border-radius: 0.375rem;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        .login-input {
          position: relative;
          display: block;
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #d1d5db;
          color: #111827;
          box-sizing: border-box;
          -webkit-appearance: none;
          -moz-appearance: none;
          appearance: none;
        }
        .login-input:focus {
          z-index: 10;
          outline: 2px solid transparent;
          outline-offset: 2px;
          border-color: #4f46e5;
          box-shadow: 0 0 0 2px #c7d2fe;
        }
        .login-input.rounded-t { border-top-left-radius: 0.375rem; border-top-right-radius: 0.375rem; margin-top: -1px; }
        .login-input.rounded-b { border-bottom-left-radius: 0.375rem; border-bottom-right-radius: 0.375rem; margin-top: -1px; }
        .login-error {
          text-align: center;
          font-size: 0.875rem;
          color: #dc2626;
        }
        .login-submit-btn {
          width: 100%;
          display: flex;
          justify-content: center;
          padding: 0.75rem 1rem;
          border: 1px solid transparent;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          font-weight: 500;
          color: white;
          background-color: #4f46e5;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .login-submit-btn:hover {
          background-color: #4338ca;
        }
        .login-toggle-text {
          text-align: center;
          font-size: 0.875rem;
          color: #4b5563;
          margin-top: 1.5rem;
        }
        .login-toggle-btn {
          font-weight: 500;
          color: #4f46e5;
          background: none;
          border: none;
          cursor: pointer;
        }
        .login-toggle-btn:hover {
          color: #4338ca;
        }
      `}</style>
      <div className="login-page-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-icon-wrapper">
              <BrainCircuit className="login-icon" />
            </div>
            <h1 className="login-title">Welcome to EduMind</h1>
            <p className="login-subtitle">
              {isRegistering ? 'Create your account to get started.' : 'Please sign in to continue.'}
            </p>
          </div>

          {isRegistering ? (
            <form className="login-form" onSubmit={handleRegisterSubmit}>
              <div className="login-input-group">
                <input id="full-name" name="name" type="text" required className="login-input rounded-t" placeholder="Full Name" />
                <input id="email-address-register" name="email" type="email" autoComplete="email" required className="login-input" placeholder="Email address" />
                <input id="password-register" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required className="login-input" placeholder="Password" />
                <input id="confirm-password-register" name="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required className="login-input rounded-b" placeholder="Confirm Password" />
              </div>
              {error && <p className="login-error">{error}</p>}
              <div>
                <button type="submit" className="login-submit-btn">
                  Create Account
                </button>
              </div>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleLoginSubmit}>
              <div className="login-input-group">
                <input id="email-address" name="email" type="email" autoComplete="email" required className="login-input rounded-t" placeholder="student@example.com" defaultValue="student@example.com" />
                <input id="password" name="password" type="password" autoComplete="current-password" required className="login-input rounded-b" placeholder="Password" defaultValue="password" />
              </div>
              <div>
                <button type="submit" className="login-submit-btn">
                  Sign in
                </button>
              </div>
            </form>
          )}

          <div className="login-toggle-text">
            <p>
              {isRegistering ? 'Already have an account?' : 'New user?'}
              {' '}
              <button onClick={() => { setIsRegistering(!isRegistering); setError(''); }} className="login-toggle-btn">
                {isRegistering ? 'Sign in' : 'Click to register'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default LoginPage;