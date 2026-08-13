export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="spinner-row muted" role="status">
      <span className="spinner" aria-hidden />
      {label}
    </p>
  );
}
