import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({ machineId, sessionId, ws }) {
  const containerRef = useRef(null);
  const wsRef = useRef(ws);
  useEffect(() => { wsRef.current = ws; }, [ws]);

  useEffect(() => {
    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78'
      },
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", monospace'
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    // 键盘输入 → ws
    const inputDispose = term.onData((data) => {
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

    // ws 数据 → terminal
    function onMessage(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pty_data' && msg.sessionId === sessionId && msg.data) {
          const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
          term.write(bytes);
        }
      } catch {}
    }
    wsRef.current?.addEventListener('message', onMessage);

    // resize
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const currentWs = wsRef.current;
        if (currentWs?.readyState === WebSocket.OPEN) {
          currentWs.send(JSON.stringify({
            type: 'terminal_resize',
            machineId,
            sessionId,
            cols: term.cols,
            rows: term.rows
          }));
        }
      } catch {}
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      inputDispose.dispose();
      wsRef.current?.removeEventListener('message', onMessage);
      ro.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ flex:1, height:'100%', padding:'4px', background:'#0d1117', overflow:'hidden' }}
    />
  );
}
