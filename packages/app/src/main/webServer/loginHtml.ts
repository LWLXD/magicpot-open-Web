export function renderLoginHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MagicPot Web 登录</title>
  <style>
    :root { color-scheme: dark; --bg:#101014; --panel:#181820; --line:rgba(255,255,255,.1); --text:#f7f7fb; --muted:#a8adbb; --brand:#8b5cf6; --brand2:#5eead4; --danger:#ff7070; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; color:var(--text); font-family:Inter,"Microsoft YaHei",system-ui,sans-serif; background: radial-gradient(circle at 20% 8%, rgba(139,92,246,.22), transparent 34%), radial-gradient(circle at 80% 12%, rgba(94,234,212,.13), transparent 30%), var(--bg); }
    .card { width:min(430px, calc(100vw - 32px)); border:1px solid var(--line); border-radius:8px; background:rgba(24,24,32,.92); box-shadow:0 24px 80px rgba(0,0,0,.42); padding:28px; }
    .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:22px; }
    .mark { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--brand),#6d5dfc 48%,var(--brand2)); }
    p { margin:10px 0 22px; color:var(--muted); line-height:1.6; }
    label { display:grid; gap:8px; margin:14px 0; color:var(--muted); font-size:13px; }
    input { width:100%; border:1px solid var(--line); border-radius:8px; background:#101017; color:var(--text); padding:12px 14px; outline:none; }
    input:focus { border-color:rgba(139,92,246,.75); }
    button { width:100%; border:0; border-radius:8px; color:white; padding:12px 16px; font-weight:700; cursor:pointer; background:linear-gradient(135deg,#7c5cff,#bd7cff); }
    .ghost { margin-top:12px; background:transparent; color:var(--muted); }
    .hidden { display:none; }
    .error { min-height:22px; color:var(--danger); font-size:13px; margin-top:10px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><div class="mark"></div><span>MagicPot Web</span></div>
    <p id="sub">公司内网 MagicPot 工作台，登录后直接进入客户端同款界面。</p>
    <label id="username-wrap" class="hidden">用户名<input id="username" autocomplete="username" /></label>
    <label>邮箱<input id="email" autocomplete="email" /></label>
    <label>密码<input id="password" type="password" autocomplete="current-password" /></label>
    <button id="primary">登录</button>
    <button id="secondary" class="ghost">注册新账号</button>
    <div id="error" class="error"></div>
  </main>
  <script>
    let mode = 'login';
    let needsAdmin = false;

    async function api(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data.error === 'string'
            ? data.error
            : data.error && typeof data.error.message === 'string'
              ? data.error.message
              : '请求失败';
        throw new Error(message);
      }
      return data;
    }

    function setMode(nextMode) {
      mode = nextMode;
      const registering = mode === 'register';
      document.getElementById('username-wrap').classList.toggle('hidden', !registering);
      document.getElementById('password').autocomplete = registering ? 'new-password' : 'current-password';
      document.getElementById('primary').textContent = registering ? '注册并登录' : '登录';
      document.getElementById('secondary').textContent = registering ? '返回登录' : '注册新账号';
      document.getElementById('secondary').classList.toggle('hidden', needsAdmin);
      document.getElementById('error').textContent = '';
      if (!needsAdmin) {
        document.getElementById('sub').textContent = registering
          ? '创建公司内网账号，注册后自动进入工作台。'
          : '公司内网 MagicPot 工作台，登录后直接进入客户端同款界面。';
      }
    }

    async function bootstrap() {
      const res = await fetch('/__magicpot/api/auth/bootstrap');
      const data = await res.json();
      needsAdmin = Boolean(data.needsAdmin);
      if (needsAdmin) {
        document.getElementById('sub').textContent = '请先注册第一个管理员账号。';
        setMode('register');
      } else {
        setMode('login');
      }
    }
    async function submit() {
      const error = document.getElementById('error');
      error.textContent = '';
      const registering = mode === 'register';
      const body = {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      };
      if (registering) {
        body.username = document.getElementById('username').value;
      }
      try {
        await api(
          registering ? '/__magicpot/api/auth/register' : '/__magicpot/api/auth/login',
          body
        );
        location.href = '/';
      } catch (err) {
        error.textContent = err.message;
      }
    }
    document.getElementById('primary').onclick = () => submit();
    document.getElementById('secondary').onclick = () => setMode(mode === 'register' ? 'login' : 'register');
    bootstrap();
  </script>
</body>
</html>`
}
