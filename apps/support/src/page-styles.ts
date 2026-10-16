export const SUPPORT_STYLES = `
:root { color-scheme: light dark; --background: #f5f8fc; --foreground: #171717; --brand-blue: #1664b7; --brand-text: #1664b7; --surface: #fff; --muted: #526174; --border: #dbe4ef; --notice: #edf5ff; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--foreground); font-family: "Noto Sans JP", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif; line-height: 1.8; }
a { color: var(--brand-text); text-underline-offset: .25em; overflow-wrap: anywhere; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--brand-text); outline-offset: 5px; }
.shell { max-width: 1000px; margin: auto; padding: 32px 24px; }
.shell-confirmation { max-width: 528px; }
.shell-confirmation .brand, .shell-confirmation .card { padding: 24px 20px; }
.shell-confirmation .brand p { font-size: 18px; }
.shell-confirmation button { width: 100%; }
.brand { border: 1px solid #ffffff60; border-radius: 16px; padding: 24px 32px; background: linear-gradient(110deg, #1664b7, #0369a1); color: #fff; box-shadow: 0 6px 18px #0f17291a; }
.brand a { color: #fff; font-size: 12px; font-weight: 700; letter-spacing: .16em; text-decoration: none; }
.brand p { margin: 8px 0 0; font-weight: 700; font-size: clamp(18px, 3vw, 26px); line-height: 1.5; }
main { padding: 36px 0 16px; }
.page-heading { margin: 0 0 24px; }
.eyebrow { color: var(--brand-text); font-size: 13px; font-weight: 700; margin: 0 0 8px; }
h1 { font-size: clamp(24px, 4vw, 32px); line-height: 1.5; margin: 0 0 12px; }
h2 { font-size: 18px; margin: 28px 0 8px; }
p { margin: 0 0 16px; }
.badge { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: 3px 12px; color: var(--muted); font-size: 12px; background: var(--surface); }
.card { padding: 32px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: 0 8px 30px #0f172908; }
.card > :first-child { margin-top: 0; }
.card > :last-child { margin-bottom: 0; }
.lead { font-size: 17px; }
.steps { list-style: none; counter-reset: step; padding: 0; margin: 20px 0 28px; display: grid; gap: 20px; }
.steps li { counter-increment: step; position: relative; padding-left: 52px; }
.steps li::before { content: counter(step); position: absolute; left: 0; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: var(--notice); color: var(--brand-text); font-weight: 700; }
.steps span { display: block; color: var(--muted); font-size: 14px; }
.notice { background: var(--notice); border-radius: 12px; padding: 20px; margin-top: 24px; }
.notice h2 { font-size: 16px; margin: 0 0 6px; }
.notice p { margin: 0; font-size: 14px; }
.links, footer nav { display: flex; gap: 12px 24px; flex-wrap: wrap; margin-top: 24px; }
button { border: 0; border-radius: 12px; background: #1664b7; color: white; font: inherit; font-weight: 700; min-height: 48px; padding: 12px 24px; cursor: pointer; }
button:hover:enabled { background: #125394; }
button:disabled { cursor: default; background: var(--border); color: var(--muted); }
.status { padding: 18px 20px; margin-top: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--notice); overflow-wrap: anywhere; }
.status[data-state="success"] { border-color: #15803d; color: #166534; background: #f0fdf4; }
.status[data-state="error"] { border-color: #b45309; color: #92400e; background: #fffbeb; }
.contact { font-size: 18px; }
footer { padding: 8px 0; color: var(--muted); font-size: 13px; }
footer nav { margin: 0 0 16px; }
footer a { display: inline-block; padding: 10px 0; }
.skip-link { position: absolute; left: 24px; top: -100px; background: var(--surface); padding: 12px; z-index: 1; }
.skip-link:focus { top: 8px; }
@media (max-width: 600px) { .shell { padding: 16px; } .brand, .card { padding: 24px 20px; } main { padding-top: 28px; } button { width: 100%; } }
@media (prefers-color-scheme: dark) { :root { --background: #0a0a0a; --foreground: #ededed; --brand-text: #93c5fd; --surface: #0f172a; --muted: #b6c3d4; --border: #334155; --notice: #172b46; } .brand { background: linear-gradient(110deg, #1d4ed8, #075985); border-color: #ffffff1a; } .status[data-state="success"] { background: #102c20; color: #bbf7d0; } .status[data-state="error"] { background: #352509; color: #fde68a; } }
@media (forced-colors: active) { :focus-visible { outline-color: Highlight; } button { border: 1px solid ButtonText; } }
`
