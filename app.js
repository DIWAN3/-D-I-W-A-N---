(() => {
  'use strict';

  const root = document.documentElement;
  const languageButton = document.querySelector('#language-toggle');
  const themeButton = document.querySelector('#theme-toggle');
  const DB = Object.freeze({
    users: 'diwan_users_v1',
    ideas: 'diwan_ideas_v1',
    messages: 'diwan_messages_v1',
    session: 'diwan_session_v1',
    language: 'diwan-language',
    theme: 'diwan-theme'
  });

  const CONFIG = Object.freeze(window.DIWAN_CONFIG || {});
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const text = {
    ar: {
      sending: 'جارٍ الحفظ...', sent: 'تم الحفظ بنجاح.', error: 'حدث خطأ غير متوقع.',
      loginRequired: 'يجب تسجيل الدخول أولًا.', signOut: 'تسجيل الخروج', signIn: 'تسجيل الدخول',
      account: 'حسابي', loggedOut: 'تم تسجيل الخروج.', duplicate: 'البريد الإلكتروني أو اسم المستخدم مستخدم مسبقًا.',
      invalidLogin: 'بيانات الدخول غير صحيحة.', registered: 'تم إنشاء حسابك بنجاح.',
      ideaSaved: 'تم حفظ فكرتك في هذا الجهاز.', messageSaved: 'تم حفظ رسالتك في هذا الجهاز.',
      forgot: 'استعادة كلمة المرور عبر البريد تحتاج خدمة خارجية، لأن هذه النسخة تعمل بدون خادم.',
      menuOpen: 'فتح القائمة', menuClose: 'إغلاق القائمة'
    },
    en: {
      sending: 'Saving...', sent: 'Saved successfully.', error: 'Something went wrong.',
      loginRequired: 'Please sign in first.', signOut: 'Sign out', signIn: 'Sign in',
      account: 'My account', loggedOut: 'Signed out.', duplicate: 'Email or username is already in use.',
      invalidLogin: 'Invalid sign-in details.', registered: 'Account created successfully.',
      ideaSaved: 'Your idea was saved on this device.', messageSaved: 'Your message was saved on this device.',
      forgot: 'Email password recovery needs an external service because this version runs without a server.',
      menuOpen: 'Open menu', menuClose: 'Close menu'
    }
  };

  function language() { return root.lang === 'en' ? 'en' : 'ar'; }
  function read(key, fallback) {
    try { const value = localStorage.getItem(key); return value ?? fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
  function readJson(key, fallback = []) {
    try { return JSON.parse(read(key, JSON.stringify(fallback))) || fallback; } catch { return fallback; }
  }
  function writeJson(key, value) { return write(key, JSON.stringify(value)); }
  function uid(prefix = 'd') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
  function nowIso() { return new Date().toISOString(); }

  async function hashPassword(value) {
    try {
      if (window.crypto?.subtle) {
        const data = new TextEncoder().encode(value);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch {}
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return `fallback_${(h >>> 0).toString(16)}`;
  }

  function getUsers() { return readJson(DB.users, []); }
  function getIdeas() { return readJson(DB.ideas, []); }
  function getMessages() { return readJson(DB.messages, []); }
  function getSession() {
    const session = readJson(DB.session, null);
    return session?.userId ? session : null;
  }
  function getCurrentUser() {
    const session = getSession();
    if (!session) return null;
    const user = getUsers().find((item) => item.id === session.userId);
    return user || null;
  }
  function setSession(user, remember) {
    const payload = { userId: user.id, createdAt: nowIso(), remember: Boolean(remember) };
    writeJson(DB.session, payload);
    return payload;
  }
  function clearSession() { try { localStorage.removeItem(DB.session); } catch {} }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  }
  function formatDate(value) {
    try { return new Intl.DateTimeFormat(language() === 'ar' ? 'ar-JO' : 'en-US', { dateStyle: 'medium' }).format(new Date(value)); }
    catch { return value; }
  }
  function applyLanguage(next) {
    root.lang = next;
    root.dir = next === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-ar][data-en]').forEach((node) => { node.textContent = node.dataset[next]; });
    document.querySelectorAll('[data-ar-html][data-en-html]').forEach((node) => { node.innerHTML = node.dataset[`${next}Html`]; });
    if (languageButton) languageButton.textContent = next === 'ar' ? 'EN' : 'ع';
    write(DB.language, next);
    document.dispatchEvent(new CustomEvent('languagechange'));
  }
  function applyTheme(next) {
    root.dataset.theme = next;
    if (themeButton) themeButton.textContent = next === 'dark' ? '☀' : '☾';
    write(DB.theme, next);
  }
  function setStatus(node, message, type = '') {
    if (!node) return;
    node.className = `form-status ${type}`.trim();
    node.textContent = message;
  }
  function setAuthMessage(node, message, type = '') {
    if (!node) return;
    node.className = `auth-message ${type}`.trim();
    node.textContent = message;
  }

  function isInternalPageLink(anchor) {
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    if (/^https?:\/\//i.test(href) || href.startsWith('//')) return false;
    return /\.html($|[?#])/i.test(href) || href === '/' || href === './';
  }

  function setupPageLifecycle() {
    requestAnimationFrame(() => root.classList.add('page-ready'));

    document.addEventListener('click', (event) => {
      const link = event.target.closest('a');
      if (!link || !isInternalPageLink(link)) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (reduceMotion) return;

      const href = link.getAttribute('href');
      const current = location.pathname.split('/').pop() || 'index.html';
      const next = href.split('/').pop().split(/[?#]/)[0];
      if (next === current) return;

      event.preventDefault();
      root.classList.add('page-exit');
      window.setTimeout(() => { location.href = href; }, 280);
    });
  }

  function setupScrollProgress() {
    let bar = document.querySelector('.scroll-progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'scroll-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.prepend(bar);
    }
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const value = max > 0 ? (window.scrollY / max) * 100 : 0;
      bar.style.width = `${Math.min(100, Math.max(0, value))}%`;
      document.querySelector('.topbar')?.classList.toggle('is-scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  function setupMobileNav() {
    const toggle = document.querySelector('#nav-toggle');
    const nav = document.querySelector('.nav-links');
    if (!toggle || !nav) return;

    let backdrop = document.querySelector('.nav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'nav-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.appendChild(backdrop);
    }

    if (!nav.querySelector('.nav-mobile-cta')) {
      const cta = document.createElement('div');
      cta.className = 'nav-mobile-cta';
      const user = getCurrentUser();
      cta.innerHTML = `
        <a class="button button-primary" href="${user ? 'dashboard.html' : 'login.html'}">${user ? text[language()].account : text[language()].signIn}</a>
        <a class="button button-secondary" data-discord-link href="${CONFIG.discordServerInvite || 'https://discord.gg/FcSqsCtBJ'}" target="_blank" rel="noreferrer">Discord</a>
      `;
      nav.appendChild(cta);
    }

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? text[language()].menuClose : text[language()].menuOpen);
      nav.classList.toggle('is-open', open);
      backdrop.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };

    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    backdrop.addEventListener('click', () => setOpen(false));
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) setOpen(false);
    });
  }

  function setupCursorGlow() {
    if (reduceMotion || window.matchMedia('(hover: none)').matches) return;
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
    let frame = 0;
    let x = 0;
    let y = 0;
    const render = () => {
      glow.style.left = `${x}px`;
      glow.style.top = `${y}px`;
      frame = 0;
    };
    document.addEventListener('pointermove', (event) => {
      x = event.clientX;
      y = event.clientY;
      glow.classList.add('is-on');
      if (!frame) frame = requestAnimationFrame(render);
    }, { passive: true });
    document.addEventListener('pointerleave', () => glow.classList.remove('is-on'));
  }

  function setupPressFeedback() {
    document.querySelectorAll('.button, .icon-button, .language-button, .nav-toggle').forEach((node) => {
      node.addEventListener('pointerdown', () => node.classList.add('is-pressing'));
      node.addEventListener('pointerup', () => node.classList.remove('is-pressing'));
      node.addEventListener('pointerleave', () => node.classList.remove('is-pressing'));
      node.addEventListener('pointercancel', () => node.classList.remove('is-pressing'));
    });
  }

  function setupTicker() {
    document.querySelectorAll('.ticker').forEach((ticker) => {
      if (ticker.querySelector('.ticker-rail')) return;
      const items = [...ticker.children];
      if (!items.length) return;
      const track = document.createElement('div');
      track.className = 'ticker-track';
      items.forEach((node) => track.appendChild(node));
      const clone = track.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      const rail = document.createElement('div');
      rail.className = 'ticker-rail';
      rail.append(track, clone);
      ticker.replaceChildren(rail);
    });
  }

  function setupGlobalUi() {
    applyLanguage(read(DB.language, 'ar'));
    applyTheme(read(DB.theme, 'dark'));
    languageButton?.addEventListener('click', () => applyLanguage(language() === 'ar' ? 'en' : 'ar'));
    themeButton?.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
    document.querySelectorAll('[data-discord-link]').forEach((node) => { if (CONFIG.discordServerInvite) node.href = CONFIG.discordServerInvite; });
    document.querySelectorAll('[data-complaints-link]').forEach((node) => { if (CONFIG.complaintsInvite) node.href = CONFIG.complaintsInvite; });
    updateAuthLinks();
  }

  function setupReveal() {
    const items = document.querySelectorAll('.reveal');
    items.forEach((item, index) => {
      if (!item.style.getPropertyValue('--reveal-delay')) {
        item.style.setProperty('--reveal-delay', `${Math.min(index % 6, 5) * 70}ms`);
      }
    });
    if (!('IntersectionObserver' in window) || reduceMotion) {
      return items.forEach((item) => item.classList.add('is-visible'));
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((item) => observer.observe(item));
  }

  function updateAuthLinks() {
    const user = getCurrentUser();
    document.querySelectorAll('.header-actions a.button-primary').forEach((link) => {
      if (!link.matches('[data-discord-link]')) {
        link.href = user ? 'dashboard.html' : 'login.html';
        link.textContent = user ? text[language()].account : text[language()].signIn;
      }
    });
    document.querySelectorAll('.nav-mobile-cta a.button-primary').forEach((link) => {
      link.href = user ? 'dashboard.html' : 'login.html';
      link.textContent = user ? text[language()].account : text[language()].signIn;
    });
  }

  function validateEmail(email) { return /^\S+@\S+\.\S+$/.test(email); }
  function validateUsername(username) { return /^[\u0600-\u06FFa-zA-Z0-9_ .-]{2,32}$/u.test(username); }
  function validatePassword(password) { return typeof password === 'string' && password.length >= 8 && password.length <= 72; }

  function setupAuth() {
    const loginForm = document.querySelector('#login-form');
    const registerForm = document.querySelector('#register-form');
    const authSwitch = document.querySelector('#auth-switch');
    const authBottomCopy = document.querySelector('#auth-bottom-copy');
    const switchMode = (mode) => {
      const login = mode === 'login';
      if (loginForm) loginForm.hidden = !login;
      if (registerForm) registerForm.hidden = login;
      if (authSwitch) {
        authSwitch.dataset.mode = login ? 'register' : 'login';
        authSwitch.textContent = login ? (language() === 'ar' ? 'إنشاء حساب' : 'Create account') : (language() === 'ar' ? 'تسجيل الدخول' : 'Sign in');
      }
      if (authBottomCopy) authBottomCopy.textContent = login ? (language() === 'ar' ? 'ليس لديك حساب؟' : "Don't have an account?") : (language() === 'ar' ? 'لديك حساب بالفعل؟' : 'Already have an account?');
      const visible = login ? loginForm : registerForm;
      if (visible && !reduceMotion) {
        visible.classList.remove('auth-form');
        void visible.offsetWidth;
        visible.classList.add('auth-form');
      }
    };
    authSwitch?.addEventListener('click', () => switchMode(authSwitch.dataset.mode || 'register'));
    document.addEventListener('languagechange', () => {
      if (authSwitch) switchMode(authSwitch.dataset.mode === 'login' ? 'register' : 'login');
    });

    document.querySelectorAll('.toggle-pass').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      const showing = input.type === 'text';
      button.setAttribute('aria-label', showing ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      button.setAttribute('title', showing ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      button.classList.toggle('is-showing', showing);
    }));

    const password = document.querySelector('#register-password');
    const meter = document.querySelector('#password-meter');
    password?.addEventListener('input', () => {
      if (!meter) return;
      let level = 0; const value = password.value;
      if (value.length >= 8) level = 1;
      if (/[A-Z\u0621-\u064A]/.test(value) && /\d/.test(value) && value.length >= 10) level = 2;
      if (/[^A-Za-z0-9\u0621-\u064A\s]/.test(value) && value.length >= 12) level = 3;
      meter.dataset.level = String(level); meter.style.display = value ? 'flex' : 'none';
    });

    document.querySelector('#forgot-password')?.addEventListener('click', () => {
      const modal = document.querySelector('#forgot-modal');
      if (modal) modal.classList.add('show');
      const p = modal?.querySelector('p'); if (p) p.textContent = text[language()].forgot;
    });
    document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => button.closest('.modal')?.classList.remove('show')));
    document.querySelector('#forgot-modal')?.addEventListener('click', (event) => { if (event.target.id === 'forgot-modal') event.currentTarget.classList.remove('show'); });

    loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = loginForm.querySelector('.auth-message'); const button = loginForm.querySelector('button[type="submit"]');
      const form = new FormData(loginForm); const identity = String(form.get('identity') || '').trim().toLowerCase(); const passwordValue = String(form.get('password') || '');
      button?.setAttribute('disabled', 'disabled'); setAuthMessage(status, text[language()].sending);
      try {
        const user = getUsers().find((item) => item.email === identity || item.username.toLowerCase() === identity);
        const hash = await hashPassword(passwordValue);
        if (!user || user.passwordHash !== hash) throw new Error(text[language()].invalidLogin);
        setSession(user, form.get('remember') === 'on'); setAuthMessage(status, language() === 'ar' ? 'تم تسجيل الدخول بنجاح.' : 'Signed in successfully.', 'success');
        updateAuthLinks();
        setTimeout(() => {
          root.classList.add('page-exit');
          window.location.href = 'dashboard.html';
        }, 350);
      } catch (error) { setAuthMessage(status, error.message, 'error'); }
      finally { button?.removeAttribute('disabled'); }
    });

    registerForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = registerForm.querySelector('.auth-message'); const button = registerForm.querySelector('button[type="submit"]');
      const form = new FormData(registerForm); const username = String(form.get('username') || '').trim(); const email = String(form.get('email') || '').trim().toLowerCase(); const passwordValue = String(form.get('password') || '');
      button?.setAttribute('disabled', 'disabled'); setAuthMessage(status, text[language()].sending);
      try {
        if (!validateUsername(username)) throw new Error(language() === 'ar' ? 'اسم المستخدم يجب أن يكون بين 2 و32 حرفًا.' : 'Username must be 2–32 characters.');
        if (!validateEmail(email)) throw new Error(language() === 'ar' ? 'أدخل بريدًا إلكترونيًا صحيحًا.' : 'Enter a valid email address.');
        if (!validatePassword(passwordValue)) throw new Error(language() === 'ar' ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' : 'Password must be at least 8 characters.');
        const users = getUsers();
        if (users.some((item) => item.email === email || item.username.toLowerCase() === username.toLowerCase())) throw new Error(text[language()].duplicate);
        const user = { id: uid('user'), username, email, passwordHash: await hashPassword(passwordValue), role: 'member', createdAt: nowIso() };
        users.push(user); writeJson(DB.users, users); setSession(user, form.get('remember') === 'on');
        setAuthMessage(status, text[language()].registered, 'success'); updateAuthLinks();
        setTimeout(() => {
          root.classList.add('page-exit');
          window.location.href = 'dashboard.html';
        }, 350);
      } catch (error) { setAuthMessage(status, error.message, 'error'); }
      finally { button?.removeAttribute('disabled'); }
    });
  }

  function discordLabel(type) {
    return ({ complaint: 'شكوى', request: 'طلب', suggestion: 'اقتراح', message: 'مراسلة' })[type] || 'رسالة';
  }

  function submitDiscordWebhook(payload) {
    const webhook = String(CONFIG.discordWebhookUrl || '').trim();
    if (!webhook) return Promise.resolve({ sent: false, configured: false });

    const target = `diwan-discord-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement('iframe');
    iframe.name = target;
    iframe.hidden = true;
    document.body.appendChild(iframe);

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = webhook + (webhook.includes('?') ? '&wait=true' : '?wait=true');
    form.enctype = 'multipart/form-data';
    form.target = target;
    form.style.display = 'none';

    const embed = {
      title: `${discordLabel(payload.type)} جديدة — DIWAN`,
      description: String(payload.message || '').slice(0, 4000),
      color: 0x43e0d0,
      fields: [
        { name: 'الاسم', value: String(payload.name || 'غير مذكور').slice(0, 1024), inline: true },
        { name: 'البريد الإلكتروني', value: String(payload.email || 'غير مذكور').slice(0, 1024), inline: true },
        { name: 'Discord', value: String(payload.discord || 'غير مذكور').slice(0, 1024), inline: true },
        { name: 'العنوان', value: String(payload.subject || 'غير مذكور').slice(0, 1024), inline: false }
      ],
      footer: { text: 'DIWAN • رسالة من الموقع' },
      timestamp: payload.createdAt || new Date().toISOString()
    };

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'payload_json';
    hidden.value = JSON.stringify({
      username: 'DIWAN • Website',
      allowed_mentions: { parse: [] },
      embeds: [embed]
    });
    form.appendChild(hidden);
    document.body.appendChild(form);
    form.submit();

    window.setTimeout(() => {
      iframe.remove();
      form.remove();
    }, 5000);

    return Promise.resolve({ sent: true, configured: true });
  }

  async function sendToDiscord(payload) {
    return submitDiscordWebhook(payload);
  }

  async function setupLocalForms() {
    document.querySelectorAll('[data-local-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('.form-status');
      const button = form.querySelector('button[type="submit"]');
      const payload = Object.fromEntries(new FormData(form));
      button?.setAttribute('disabled', 'disabled');
      setStatus(status, text[language()].sending);
      try {
        if (form.dataset.localForm === 'contact') {
          if (!payload.name || !validateEmail(payload.email || '') || !payload.subject || String(payload.message || '').trim().length < 10 || !payload.type) {
            throw new Error(language() === 'ar' ? 'تأكد من الاسم والبريد والنوع والعنوان واكتب تفاصيل لا تقل عن 10 أحرف.' : 'Check the name, email, type, subject, and write at least 10 characters.');
          }
          const messages = getMessages();
          const record = {
            id: uid('msg'),
            name: String(payload.name).trim().slice(0, 80),
            email: String(payload.email).trim().toLowerCase().slice(0, 160),
            type: String(payload.type).trim().slice(0, 30),
            discord: String(payload.discord || '').trim().slice(0, 120),
            subject: String(payload.subject).trim().slice(0, 140),
            message: String(payload.message).trim().slice(0, 3000),
            createdAt: nowIso()
          };
          messages.unshift(record);
          writeJson(DB.messages, messages);

          let delivery = { sent: false, configured: false };
          try {
            delivery = await sendToDiscord({
              source: 'DIWAN website',
              type: record.type,
              name: record.name,
              email: record.email,
              discord: record.discord,
              subject: record.subject,
              message: record.message,
              createdAt: record.createdAt
            });
          } catch (discordError) {
            console.warn('DIWAN Discord delivery failed:', discordError);
          }

          if (delivery.sent) {
            setStatus(status, language() === 'ar' ? 'تم إرسال رسالتك إلى فريق ديوان بنجاح.' : 'Your message was sent to the DIWAN team.', 'success');
          } else if (!delivery.configured) {
            setStatus(status, language() === 'ar' ? 'تم استلام رسالتك. الربط التلقائي مع قناة Discord يحتاج Webhook / Endpoint للقناة.' : 'Your message was received. Automatic Discord delivery still needs the channel webhook / endpoint.', 'success');
          } else {
            setStatus(status, language() === 'ar' ? 'تم حفظ رسالتك، لكن تعذر إرسالها إلى Discord حاليًا.' : 'Your message was saved, but Discord delivery is temporarily unavailable.', 'error');
          }
          form.reset();
          document.dispatchEvent(new CustomEvent('contactsubmitted'));
        }
        if (form.dataset.localForm === 'ideas') {
          const user = getCurrentUser();
          if (!user) { setStatus(status, text[language()].loginRequired, 'error'); setTimeout(() => { window.location.href = 'login.html'; }, 550); return; }
          if (!payload.title || String(payload.details || '').trim().length < 10 || !payload.discord) throw new Error(language() === 'ar' ? 'املأ العنوان والتفاصيل وحساب Discord.' : 'Fill in the title, details, and Discord handle.');
          const ideas = getIdeas();
          const ideaRecord = { id: uid('idea'), title: String(payload.title).trim().slice(0,120), details: String(payload.details).trim().slice(0,3000), discord: String(payload.discord).trim().slice(0,120), userId: user.id, createdAt: nowIso() };
          ideas.unshift(ideaRecord);
          writeJson(DB.ideas, ideas);
          await sendToDiscord({
            type: 'suggestion',
            name: user.username,
            email: user.email,
            discord: ideaRecord.discord,
            subject: ideaRecord.title,
            message: ideaRecord.details,
            createdAt: ideaRecord.createdAt
          });
          setStatus(status, language() === 'ar' ? 'تم حفظ الاقتراح وإرساله إلى فريق ديوان.' : 'The suggestion was saved and sent to the DIWAN team.', 'success'); form.reset();
        }
      } catch (error) {
        setStatus(status, error.message, 'error');
      } finally {
        button?.removeAttribute('disabled');
        loadStats();
      }
    }));
  }

  function animateCount(node, target) {
    if (reduceMotion) {
      node.textContent = Number(target).toLocaleString(language() === 'ar' ? 'ar-JO' : 'en-US');
      return;
    }
    const end = Number(target) || 0;
    const start = Number(String(node.textContent).replace(/[^\d]/g, '')) || 0;
    const duration = 700;
    const began = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(start + (end - start) * eased);
      node.textContent = value.toLocaleString(language() === 'ar' ? 'ar-JO' : 'en-US');
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function loadStats() {
    document.querySelectorAll('[data-stat]').forEach((node) => {
      const key = node.dataset.stat; let value = 0;
      if (key === 'users') value = getUsers().length;
      if (key === 'ideas') value = getIdeas().length;
      if (key === 'messages') value = getMessages().length;
      animateCount(node, value);
    });
  }

  function loadDashboard() {
    const page = document.querySelector('[data-dashboard]'); if (!page) return;
    const user = getCurrentUser();
    if (!user) { window.location.href = 'login.html'; return; }
    const name = document.querySelector('#dashboard-name'); const email = document.querySelector('#dashboard-email'); const role = document.querySelector('#dashboard-role-chip'); const roleCard = document.querySelector('#dashboard-role-card'); const initials = document.querySelector('#dashboard-avatar'); const ideaCount = document.querySelector('#dashboard-idea-count'); const ideaList = document.querySelector('#idea-list');
    if (name) name.textContent = user.username; if (email) email.textContent = user.email;
    const roleLabel = user.role === 'admin' ? (language() === 'ar' ? 'مدير' : 'Admin') : (language() === 'ar' ? 'عضو' : 'Member');
    if (role) role.textContent = roleLabel; if (roleCard) roleCard.textContent = roleLabel; if (initials) initials.textContent = (user.username || 'د').slice(0, 1);
    const ideas = getIdeas().filter((idea) => idea.userId === user.id).slice(0, 20);
    if (ideaCount) ideaCount.textContent = Number(ideas.length).toLocaleString(language() === 'ar' ? 'ar-JO' : 'en-US');
    if (ideaList) ideaList.innerHTML = ideas.length ? ideas.map((idea) => `<article class="idea-item reveal is-visible"><strong>${escapeHtml(idea.title)}</strong><p>${escapeHtml(idea.details)}</p><small>${formatDate(idea.createdAt)}</small></article>`).join('') : `<div class="idea-item"><strong>${language() === 'ar' ? 'لا توجد أفكار مرسلة بعد.' : 'No submitted ideas yet.'}</strong><p>${language() === 'ar' ? 'استخدم زر إرسال فكرة وشارك اقتراحك.' : 'Use the idea button to share your suggestion.'}</p></div>`;
    document.querySelector('#logout-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      clearSession();
      updateAuthLinks();
      root.classList.add('page-exit');
      window.location.href = 'index.html';
    });
  }

  document.addEventListener('languagechange', () => { updateAuthLinks(); loadStats(); if (document.querySelector('[data-dashboard]')) loadDashboard(); });
  setupPageLifecycle();
  setupGlobalUi();
  setupMobileNav();
  setupScrollProgress();
  setupCursorGlow();
  setupPressFeedback();
  setupTicker();
  setupReveal();
  setupAuth();
  setupLocalForms();
  loadStats();
  loadDashboard();
})();
