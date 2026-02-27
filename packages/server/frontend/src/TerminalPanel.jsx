import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({ machineId, sessionId, ws, visible = true, style }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(ws);
  useEffect(() => { wsRef.current = ws; }, [ws]);

  // 只在首次挂载时创建 xterm
  useEffect(() => {
    if (termRef.current) return;
    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78'
      },
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", monospace'
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

    // 键盘输入 → ws
    term.onData((data) => {
      const currentWs = wsRef.current;
      if (currentWs?.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify({
          type: 'terminal_input',
          machineId,
          sessionId,
          data: btoa(String.fromCharCode(...new TextEncoder().encode(data)))
        }));
      }
    });

    // resize
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const currentWs = wsRef.current;
        if (currentWs?.readyState === WebSocket.OPEN) {
          currentWs.send(JSON.stringify({
            type: 'terminal_resize',
            machineId, sessionId,
            cols: term.cols, rows: term.rows
          }));
        }
      } catch {}
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => { ro.disconnect(); };
  }, []);

  // 监听 ws pty_data
  useEffect(() => {
    function onMessage(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pty_data' && msg.sessionId === sessionId && msg.data) {
          const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
          termRef.current?.write(bytes);
        }
      } catch {}
    }
    wsRef.current?.addEventListener('message', onMessage);
    return () => wsRef.current?.removeEventListener('message', onMessage);
  }, [sessionId]);

  // visible 变化时 fit + focus
  useEffect(() => {
    if (visible && fitRef.current) {
      setTimeout(() => { fitRef.current.fit(); termRef.current?.focus(); }, 50);
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1, height: '100%', padding: '4px',
        background: '#0d1117', overflow: 'hidden',
        display: visible ? 'block' : 'none',
        ...style,
      }}
    />
  );
}
