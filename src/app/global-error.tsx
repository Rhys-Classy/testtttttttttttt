'use client';

/** Last-resort boundary (the root layout itself failed). Styled inline: the stylesheet may not have loaded. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-AU">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#0f1216', color: '#d3d8e0', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 380, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#8b94a3', fontSize: 14 }}>Nothing was changed. Please try again.</p>
          {error.digest ? <p style={{ color: '#8b94a3', fontSize: 12, fontFamily: 'monospace' }}>Reference {error.digest}</p> : null}
          <button onClick={reset} style={{ marginTop: 16, height: 44, padding: '0 16px', borderRadius: 12, border: 0, background: '#8e97ef', color: '#0f1216', fontWeight: 600 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
