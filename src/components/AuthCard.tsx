import fs from 'node:fs';
import path from 'node:path';

const mark = (() => { try { return fs.readFileSync(path.join(process.cwd(), 'public', 'mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '').replace(/<title>.*?<\/title>/, ''); } catch { return ''; } })();

const CSS = `
:root{--bg:#f1f1f4;--surface:#fff;--surface2:#f7f7fa;--ink:#1f1c3b;--muted:#6b6985;--line:#ececf2;--primary:#2b2849;--primaryInk:#fff;--sel:#7b5cf5;--danger:#c9352f;--a1:#b8a5fa}
@media (prefers-color-scheme:dark){:root{--bg:#14122a;--surface:#1f1d3a;--surface2:#28254a;--ink:#f1f0fb;--muted:#a9a7c2;--line:#302d52;--primary:#b8a5fa;--primaryInk:#1f1c3b;--sel:#b8a5fa;--danger:#ff8f8f}}
body{background:var(--bg);color:var(--ink)}
.auth{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.authcard{width:100%;max-width:420px;background:var(--surface);border-radius:28px;padding:32px 28px;box-sizing:border-box;display:flex;flex-direction:column;gap:18px;box-shadow:0 10px 40px rgba(0,0,0,.06)}
.authmark{width:56px;height:56px;border-radius:18px;background:#2b2849;display:flex;align-items:center;justify-content:center}
.authmark svg{width:28px;height:32px}
.authcard h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em}
.authcard p{margin:0;font-size:14px;color:var(--muted);line-height:1.5}
.afld{display:flex;flex-direction:column;gap:6px}
.afld span{font-size:13px;font-weight:700;color:var(--muted)}
.afld input{box-sizing:border-box;width:100%;min-height:48px;padding:0 14px;border:1px solid color-mix(in srgb,var(--ink) 20%,transparent);border-radius:12px;background:var(--surface);color:var(--ink);font:500 16px 'Plus Jakarta Sans',sans-serif}
.afld input:focus{outline:2px solid var(--sel);outline-offset:1px}
.abtn{min-height:48px;border:0;border-radius:999px;background:var(--primary);color:var(--primaryInk);font:700 15px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
.abtn:hover{box-shadow:inset 0 0 0 999px color-mix(in srgb,var(--primaryInk) 14%,transparent)}
.aerr{padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger);font-size:14px;font-weight:600}
.alink{font-size:13px;color:var(--muted);text-align:center}
.alink a{color:var(--ink);font-weight:600}
`;

export default function AuthCard({ title, sub, error, children }: { title: string; sub?: string; error?: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <style>{CSS}</style>
      <div className="authcard">
        <span className="authmark" dangerouslySetInnerHTML={{ __html: mark }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>{title}</h1>
          {sub ? <p>{sub}</p> : null}
        </div>
        {error ? <div className="aerr" role="alert">{error}</div> : null}
        {children}
      </div>
    </main>
  );
}
