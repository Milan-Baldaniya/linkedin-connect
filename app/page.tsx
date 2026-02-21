'use client';

import { useState } from 'react';

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [cookie, setCookie] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  const startConnect = async () => {
    setStatus('starting');
    setCookie(null);
    setLogs([]);
    addLog('Requesting new session...');

    try {
      const res = await fetch('/api/linkedin/connect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start connection');

      const data = await res.json();
      setSessionId(data.sessionId);
      setStatus('waiting');
      addLog(`Session created: ${data.sessionId}`);
      addLog('Browser launched. Please log in manually.');

      // Start polling
      pollStatus(data.sessionId);
    } catch (err: any) {
      setStatus('error');
      addLog(`Error: ${err.message}`);
    }
  };

  const pollStatus = async (sid: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/linkedin/status?sessionId=${sid}`);
        const data = await res.json();

        if (data.status === 'success' || data.status === 'connected') {
          clearInterval(interval);
          setStatus('success');
          // setCookie(data.cookie); // Cookie is no longer returned
          setCookie('Stored securely in database');
          addLog('Login successful! Account connected and stored.');
        } else if (data.status === 'waiting') {
          // keep waiting
        } else {
          clearInterval(interval);
          setStatus('error');
          addLog(`Error: ${data.message || 'Unknown error'}`);
        }
      } catch (err) {
        // ignore poll errors
      }
    }, 2000);
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start max-w-2xl w-full">
        <h1 className="text-2xl font-bold">LinkedIn Connect Tester</h1>

        <div className="flex gap-4 items-center">
          <button
            onClick={startConnect}
            disabled={status === 'waiting' || status === 'starting'}
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 disabled:opacity-50"
          >
            {status === 'waiting' ? 'Waiting for Login...' : 'Start Connection'}
          </button>

          <div className="text-sm font-mono">
            Status: <span className="font-bold">{status.toUpperCase()}</span>
          </div>
        </div>

        {cookie && (
          <div className="w-full p-4 bg-green-100 dark:bg-green-900 rounded-md break-all">
            <h3 className="font-bold mb-2">li_at Cookie:</h3>
            <code className="text-xs">{cookie}</code>
          </div>
        )}

        <div className="w-full p-4 bg-gray-100 dark:bg-gray-800 rounded-md h-64 overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? <span className="text-gray-400">Logs will appear here...</span> : logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </main>
    </div>
  );
}
