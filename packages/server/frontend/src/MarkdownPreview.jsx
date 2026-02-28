import { useTheme } from './theme';

export default function MarkdownPreview({ path, content, onClose }) {
  const T = useTheme();

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: T.bgBase,
    }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 16px',
        borderBottom: `1px solid ${T.border}`,
        background: T.bgPanel, flexShrink: 0,
      }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: '0.78rem',
          color: T.textMuted, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {path}
        </span>
        <button
          onClick={onClose}
          style={{
            background: T.bgCard, border: `1px solid ${T.border}`,
            color: T.textMuted, borderRadius: T.radiusSm,
            cursor: 'pointer', padding: '3px 10px', fontSize: '0.75rem',
            fontFamily: T.fontSans, transition: 'all 0.15s',
          }}
        >
          关闭
        </button>
      </div>

      {/* 内容区 */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '1.5rem 2rem',
      }}>
        <pre style={{
          fontFamily: T.fontMono, fontSize: '0.82rem',
          lineHeight: 1.6, color: T.textPrimary,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          margin: 0,
        }}>
          {content}
        </pre>
      </div>
    </div>
  );
}
