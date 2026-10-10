export const STYLE = `
:root{--bg:#f6f4ef;--card:#fff;--box:#f1eee6;--line:#e4dfd3;--text:#17150f;--muted:#6f6a5c;--accent:#b4532a;--accent-text:#fff;
  color-scheme:light dark;font:16px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#100f0c;--card:#1a1814;--box:#24211b;--line:#332f26;--text:#f3f0e8;--muted:#a39d8d;--accent:#e07a4a;--accent-text:#100f0c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(60rem 30rem at 50% -10rem,color-mix(in srgb,var(--accent) 16%,transparent),transparent),var(--bg);color:var(--text)}
main{max-width:34rem;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:1.25rem}
.logo{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--accent);color:var(--accent-text)}
.pills,.tabs{display:flex;gap:4px;padding:4px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
.tabs{margin-bottom:12px}.tabs button{flex:1}
.pills button,.tabs button{border:0;background:none;color:var(--muted);padding:6px 14px;border-radius:999px;font:inherit;font-weight:600;cursor:pointer}
.pills button.on,.tabs button.on{background:var(--box);color:var(--text)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;box-shadow:0 12px 40px rgb(0 0 0 / .06)}
.card+.card,.tab>.card+div .card,#requests .card,#posts .card+.card{margin-top:12px}
h2{margin:0 0 10px;font-size:1.1rem}
.steps{margin:0 0 12px;padding-left:20px;font-size:.9rem;color:var(--muted)}.steps li+li{margin-top:4px}
label{display:grid;gap:4px;margin-top:10px;font-size:.85rem;color:var(--muted);flex:1;min-width:0}
.row{display:flex;gap:8px;flex-wrap:wrap}.row label{min-width:7rem}
input,select{width:100%;font:inherit;color:var(--text);background:var(--box);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
input[type=file]{padding:8px}
.line{display:flex;align-items:center;justify-content:space-between;gap:8px}
.badge{font-size:.8rem;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--box);color:var(--muted)}
.badge.s1{color:var(--accent)}.badge.s3{color:#2563eb}.badge.s4{color:#16a34a}.badge.s5{color:#dc2626}
.uri{margin:8px 0;word-break:break-word}
.details{margin:8px 0 0;font-size:.9rem}
.details div{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.details dt{color:var(--muted)}.details dd{margin:0;text-align:right}
.post input{margin-top:10px}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.primary{width:100%;margin-top:12px;padding:14px;border:0;border-radius:16px;background:var(--accent);color:var(--accent-text);font:inherit;font-size:1.05rem;font-weight:700;cursor:pointer}
.secondary{margin-top:10px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--box);color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.acts .secondary{margin-top:0;flex:1}
.primary:disabled,.secondary:disabled{opacity:.5;cursor:default}
.muted{color:var(--muted);font-size:.9rem}
#msg{margin:12px 4px;white-space:pre-wrap;word-break:break-word;font-size:.9rem}
#msg:empty{display:none}
#msg a{color:var(--accent)}
footer{margin-top:20px;font-size:.85rem;color:var(--muted)}
footer p{margin:0}
.love{text-align:center;margin-top:8px!important}.love span{color:var(--accent)}.love a{color:inherit;font-weight:600}
.link{border:0;background:none;color:var(--accent);font:inherit;font-size:.9rem;cursor:pointer;padding:0;margin-bottom:6px}
dialog{max-width:30rem;width:calc(100% - 32px);border:1px solid var(--line);border-radius:20px;padding:20px;background:var(--card);color:var(--text)}
dialog::backdrop{background:rgb(0 0 0 / .55)}
dialog h2{margin:0 0 8px}dialog h3{margin:16px 0 6px;font-size:1rem}
dialog ul{margin:0;padding-left:18px;font-size:.9rem}dialog li+li{margin-top:4px}dialog p{margin:0}
.flow{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:22px}
.flow li{position:relative;background:var(--box);border-radius:14px;padding:10px 12px;font-size:.9rem;display:grid;gap:2px}
.flow li+li::before{content:"↓";position:absolute;top:-21px;left:50%;transform:translateX(-50%);color:var(--accent)}
.flow span{color:var(--muted)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;
