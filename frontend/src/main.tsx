import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css'; // Import the old CSS

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
