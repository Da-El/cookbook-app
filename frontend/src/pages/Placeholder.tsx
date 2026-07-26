export function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1 className="display" style={{ fontSize: 'var(--text-display-lg)' }}>
        {title}
      </h1>
      <p style={{ color: 'var(--muted-1)' }}>Coming soon.</p>
    </div>
  );
}
