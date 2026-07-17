import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0b0b0f',
        color: '#fafafa',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>▲</div>
        <h1>Hello from Snowflake</h1>
        <p style={{ opacity: 0.6 }}>
          Deployed with <code>snowd deploy --prod</code>
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
