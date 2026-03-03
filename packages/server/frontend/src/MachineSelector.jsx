import { useTheme } from './theme';

export default function MachineSelector({ machines, currentMachine, onSelect }) {
  const T = useTheme();

  if (!machines || machines.length <= 1) return null;

  return (
    <div style={{ marginBottom: '1rem', padding: '0 0.75rem' }}>
      <label style={{
        display: 'block',
        color: T.textSecondary,
        fontSize: '0.8rem',
        marginBottom: '0.5rem'
      }}>
        选择开发机
      </label>
      <select
        value={currentMachine || ''}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          width: '100%',
          padding: '0.5rem',
          background: T.bgBase,
          border: `1px solid ${T.border}`,
          borderRadius: T.radiusSm,
          color: T.textPrimary,
          fontSize: '0.875rem',
          cursor: 'pointer'
        }}
      >
        <option value="">所有开发机</option>
        {machines.map(m => (
          <option key={m.machineId} value={m.machineId}>
            {m.machineId} ({m.sessionCount} sessions)
          </option>
        ))}
      </select>
    </div>
  );
}
