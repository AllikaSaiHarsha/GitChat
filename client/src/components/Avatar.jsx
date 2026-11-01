const PALETTE = ['#1f6feb', '#2f81f7', '#8957e5', '#a371f7', '#da3633', '#db6d28'];

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

// Initial avatar with a name-stable color from Purlway's muted palette.
export default function Avatar({ name = '?', size = 32, own = false }) {
  const label = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.45)),
        background: own ? 'var(--accent)' : colorFor(name)
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}
