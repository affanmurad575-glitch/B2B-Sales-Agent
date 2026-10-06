(() => {
  const byId = (id) => document.getElementById(id);
  const landingView = byId('landingView');
  const appShell = byId('appShell');
  const authModal = byId('authModal');
  const checkoutModal = byId('checkoutModal');
  const messages = byId('messages');
  const authForm = byId('authForm');
  const chatForm = byId('chatForm');
  const leadForm = byId('leadForm');
  const states = ['COLD', 'QUALIFIED', 'OBJECTION_HANDLING', 'CLOSING'];
  const plans = {
    free: { name: 'Free Tier', description: 'A great place to start building your pipeline.', price: 0 },
    pro: { name: 'Pro Agent', description: 'More room to qualify leads and keep your pipeline moving.', price: 49 },
    enterprise: { name: 'Enterprise', description: 'A powerful sales agent for ambitious, high-growth teams.', price: 199 },
  };
  let user = null;
  let leads = [];
  let activeLead = null;
  let authMode = 'login';
  let checkoutPlan = null;
  let isSending = false;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && user) {
        user = null;
        sessionStorage.removeItem('northstar.hasSession');
        showLanding();
      }
      throw new Error(payload.error || 'The request could not be completed.');
    }
    return payload;
  }

  function notify(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    byId('toastRegion').appendChild(toast);
    window.setTimeout(() => toast.remove(), 3800);
  }

  function showLanding() {
    landingView.hidden = false;
    appShell.hidden = true;
  }

  function showWorkspace() {
    landingView.hidden = true;
    appShell.hidden = false;
    byId('userEmail').textContent = user.email;
    byId('profileEmail').textContent = user.email;
    const initial = (user.email[0] || 'N').toUpperCase();
    byId('profileInitial').textContent = initial;
    byId('topInitial').textContent = initial;
    updatePlanUI();
  }

  function openAuth(mode = 'login') {
    setAuthMode(mode);
    byId('authError').textContent = '';
    authModal.hidden = false;
    window.setTimeout(() => authForm.elements.email.focus(), 0);
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.authMode === mode);
    });
    byId('authTitle').textContent = mode === 'signup' ? 'Create your workspace' : 'Welcome to your workspace';
    byId('authDescription').textContent = mode === 'signup'
      ? 'Create a secure account and start qualifying leads.'
      : 'Sign in to continue your sales conversations.';
    byId('authSubmit').textContent = mode === 'signup' ? 'Create account' : 'Log in to workspace';
    authForm.elements.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  }

  function setView(view) {
    if (!user) return openAuth('login');
    const titles = { workspace: 'Agent workspace', leads: 'Leads', billing: 'Plans & billing' };
    document.querySelectorAll('.view-section').forEach((section) => {
      section.classList.toggle('active', section.id === `${view}View`);
    });
    document.querySelectorAll('[data-view-link]').forEach((link) => {
      link.classList.toggle('active', link.dataset.viewLink === view && link.classList.contains('side-link'));
    });
    byId('pageTitle').textContent = titles[view] || titles.workspace;
    localStorage.setItem('northstar.activeView', view);
  }

  function stateClass(state) {
    return `state-${String(state || 'COLD').toLowerCase()}`;
  }

  function renderLeadHeader() {
    const name = activeLead?.name || 'New prospect';
    byId('leadName').textContent = name;
    byId('leadCompany').textContent = activeLead?.company || activeLead?.email || 'B2B sales conversation';
    byId('leadAvatar').textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    const state = activeLead?.status || 'COLD';
    const badge = byId('stateBadge');
    badge.textContent = state;
    badge.className = `state-pill ${stateClass(state)}`;
    document.querySelectorAll('[data-stage]').forEach((stage) => {
      stage.classList.toggle('active', stage.dataset.stage === state);
    });
    const score = activeLead?.score || 0;
    byId('scoreValue').textContent = score;
    byId('scoreFill').style.width = `${score}%`;
    byId('scoreProgress').setAttribute('aria-valuenow', score);
    byId('scoreCaption').textContent = score >= 70
      ? 'Strong buying signals — consider a product demo.'
      : score >= 35
        ? 'Promising engagement — learn more about their needs.'
        : activeLead?.history?.length
          ? 'Continue the conversation to uncover buying intent.'
          : 'Start a conversation to understand buying intent.';
  }

  function renderMessages(history = []) {
    messages.replaceChildren();
    if (!history.length) {
      const welcome = document.createElement('div');
      welcome.className = 'welcome-state';
      const spark = document.createElement('span');
      spark.className = 'welcome-spark';
      spark.textContent = '✦';
      const title = document.createElement('b');
      title.textContent = 'Your sales agent is ready';
      const copy = document.createElement('p');
      copy.textContent = 'Send a message to start qualifying this lead. Your conversation and lead insights will stay in sync.';
      welcome.append(spark, title, copy);
      messages.appendChild(welcome);
      return;
    }
    history.forEach((entry) => {
      if (entry.role !== 'user' && entry.role !== 'assistant') return;
      const row = document.createElement('div');
      row.className = `message-row${entry.role === 'user' ? ' user-message' : ''}`;
      const avatar = document.createElement('span');
      avatar.className = 'message-avatar';
      avatar.textContent = entry.role === 'user' ? 'You' : 'AI';
      const content = document.createElement('div');
      content.className = 'message-content';
      content.append(document.createTextNode(entry.content || ''));
      if (entry.createdAt) {
        const time = document.createElement('small');
        time.className = 'message-time';
        time.textContent = new Date(entry.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        content.appendChild(time);
      }
      row.append(avatar, content);
      messages.appendChild(row);
    });
    messages.scrollTop = messages.scrollHeight;
  }

  function setActiveLead(lead) {
    activeLead = lead;
    if (lead) localStorage.setItem('northstar.activeLead', lead.id);
    else localStorage.removeItem('northstar.activeLead');
    renderLeadHeader();
    renderMessages(lead?.history || []);
  }

  function formatState(state) {
    return state === 'OBJECTION_HANDLING' ? 'Objection handling' : state[0] + state.slice(1).toLowerCase();
  }

  function renderLeads() {
    const tbody = byId('leadsTableBody');
    tbody.replaceChildren();
    const filter = byId('leadSearch').value.trim().toLowerCase();
    const visible = leads.filter((lead) =>
      `${lead.name} ${lead.company} ${lead.email}`.toLowerCase().includes(filter),
    );
    byId('emptyLeads').hidden = visible.length > 0;
    byId('totalLeads').textContent = String(leads.length);
    byId('qualifiedLeads').textContent = String(leads.filter((lead) => lead.status !== 'COLD').length);
    const average = leads.length
      ? Math.round(leads.reduce((sum, lead) => sum + (Number(lead.score) || 0), 0) / leads.length)
      : 0;
    byId('averageScore').textContent = String(average);
    byId('leadCount').textContent = String(leads.length);

    visible.forEach((lead) => {
      const row = document.createElement('tr');
      const contact = document.createElement('td');
      const contactWrap = document.createElement('div');
      contactWrap.className = 'table-contact';
      const avatar = document.createElement('span');
      avatar.className = 'table-contact-avatar';
      avatar.textContent = lead.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
      const identity = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = lead.name;
      const email = document.createElement('small');
      email.textContent = lead.email || 'No email provided';
      identity.append(name, email);
      contactWrap.append(avatar, identity);
      contact.appendChild(contactWrap);

      const company = document.createElement('td');
      company.textContent = lead.company || '—';
      const stage = document.createElement('td');
      const stageSelect = document.createElement('select');
      stageSelect.className = `table-stage ${stateClass(lead.status)}`;
      stageSelect.setAttribute('aria-label', `Stage for ${lead.name}`);
      states.forEach((state) => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = formatState(state);
        option.selected = state === lead.status;
        stageSelect.appendChild(option);
      });
      stageSelect.addEventListener('change', async () => {
        try {
          const { lead: updated } = await api(`/api/leads/${encodeURIComponent(lead.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: stageSelect.value }),
          });
          replaceLead(updated);
          notify('Lead stage updated.');
        } catch (error) {
          notify(error.message, true);
          stageSelect.value = lead.status;
        }
      });
      stage.appendChild(stageSelect);

      const scoreCell = document.createElement('td');
      const scoreWrap = document.createElement('div');
      scoreWrap.className = 'table-score';
      const score = document.createElement('b');
      score.textContent = String(lead.score || 0);
      const track = document.createElement('span');
      track.className = 'table-score-track';
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(0, Math.min(100, Number(lead.score) || 0))}%`;
      track.appendChild(fill);
      scoreWrap.append(score, track);
      scoreCell.appendChild(scoreWrap);

      const active = document.createElement('td');
      active.textContent = lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString() : '—';
      const actions = document.createElement('td');
      const open = document.createElement('button');
      open.className = 'icon-button';
      open.type = 'button';
      open.textContent = '→';
      open.setAttribute('aria-label', `Open conversation with ${lead.name}`);
      open.addEventListener('click', () => {
        setActiveLead(lead);
        setView('workspace');
      });
      actions.appendChild(open);
      row.append(contact, company, stage, scoreCell, active, actions);
      tbody.appendChild(row);
    });
  }

  function replaceLead(lead) {
    const index = leads.findIndex((item) => item.id === lead.id);
    if (index === -1) leads.unshift(lead);
    else leads[index] = lead;
    if (activeLead?.id === lead.id) setActiveLead(lead);
    renderLeads();
  }

  async function loadLeads() {
    const result = await api('/api/leads');
    leads = result.leads;
    const activeId = localStorage.getItem('northstar.activeLead');
    const selected = leads.find((lead) => lead.id === activeId) || leads[0] || null;
    if (selected) setActiveLead(selected);
    else setActiveLead(null);
    renderLeads();
  }

  function updatePlanUI() {
    const plan = plans[user?.plan] || plans.free;
    byId('sidebarPlan').textContent = plan.name;
    byId('sidebarUsage').textContent = plan.price === 0 ? 'Up to 50 chats / month' : 'Unlimited AI conversations';
    byId('currentPlanName').textContent = plan.name;
    byId('currentPlanDescription').textContent = plan.description;
    document.querySelectorAll('[data-plan]').forEach((button) => {
      const selected = button.dataset.plan === (user?.plan || 'free');
      button.textContent = selected ? 'Current plan' : `Choose ${plans[button.dataset.plan].name}`;
      button.disabled = selected;
      button.classList.toggle('button-outline', selected || button.dataset.plan !== 'pro');
    });
  }

  async function establishSession(nextUser, resetWorkspace = false) {
    user = nextUser;
    sessionStorage.setItem('northstar.hasSession', 'true');
    showWorkspace();
    await loadLeads();
    const view = resetWorkspace ? 'workspace' : (localStorage.getItem('northstar.activeView') || 'workspace');
    if (resetWorkspace) localStorage.setItem('northstar.activeView', view);
    setView(view);
  }

  document.querySelectorAll('[data-auth-open]').forEach((button) => {
    button.addEventListener('click', () => openAuth(button.dataset.authOpen));
  });
  document.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop')));
  });
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
  });
  document.querySelectorAll('[data-view-link]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.viewLink));
  });
  document.querySelectorAll('[data-create-lead]').forEach((button) => {
    button.addEventListener('click', () => {
      leadForm.hidden = false;
      leadForm.elements.name.focus();
    });
  });

  authModal.addEventListener('click', (event) => {
    if (event.target === authModal) closeModal(authModal);
  });
  checkoutModal.addEventListener('click', (event) => {
    if (event.target === checkoutModal) closeModal(checkoutModal);
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = byId('authSubmit');
    const data = Object.fromEntries(new FormData(authForm));
    button.disabled = true;
    byId('authError').textContent = '';
    try {
      const { user: nextUser } = await api(`/api/auth/${authMode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      closeModal(authModal);
      authForm.reset();
      await establishSession(nextUser, authMode === 'signup');
      notify(authMode === 'signup' ? 'Your workspace is ready.' : 'Welcome back.');
    } catch (error) {
      byId('authError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  byId('logoutButton').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      notify(error.message, true);
    }
    user = null;
    activeLead = null;
    leads = [];
    sessionStorage.removeItem('northstar.hasSession');
    localStorage.removeItem('northstar.activeLead');
    showLanding();
  });

  byId('newConversationButton').addEventListener('click', async () => {
    try {
      const { lead } = await api('/api/leads', {
        method: 'POST',
        body: JSON.stringify({ name: 'New prospect' }),
      });
      replaceLead(lead);
      setActiveLead(lead);
      setView('workspace');
      byId('messageInput').focus();
    } catch (error) {
      notify(error.message, true);
    }
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('messageInput');
    const message = input.value.trim();
    if (!message || isSending) return;
    isSending = true;
    byId('sendButton').disabled = true;
    input.value = '';
    const temporaryHistory = [...(activeLead?.history || []), { role: 'user', content: message, createdAt: new Date().toISOString() }];
    renderMessages(temporaryHistory);
    try {
      const response = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message, leadId: activeLead?.id }),
      });
      if (!activeLead) {
        activeLead = {
          id: response.leadId,
          name: 'New prospect',
          status: response.currentState,
          score: response.leadScore,
          history: response.history,
        };
      }
      activeLead.id = response.leadId;
      activeLead.history = response.history;
      activeLead.status = response.currentState;
      activeLead.score = response.leadScore;
      activeLead.updatedAt = new Date().toISOString();
      localStorage.setItem('northstar.activeLead', activeLead.id);
      replaceLead(activeLead);
      renderMessages(activeLead.history);
      renderLeadHeader();
    } catch (error) {
      renderMessages([...(activeLead?.history || []), { role: 'user', content: message }, { role: 'assistant', content: error.message }]);
      notify(error.message, true);
    } finally {
      isSending = false;
      byId('sendButton').disabled = false;
      input.focus();
    }
  });

  byId('createLeadButton').addEventListener('click', () => {
    leadForm.hidden = false;
    leadForm.elements.name.focus();
  });
  byId('cancelLeadButton').addEventListener('click', () => { leadForm.hidden = true; });
  byId('cancelLeadButtonBottom').addEventListener('click', () => { leadForm.hidden = true; });
  leadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(leadForm));
    try {
      const { lead } = await api('/api/leads', { method: 'POST', body: JSON.stringify(fields) });
      replaceLead(lead);
      setActiveLead(lead);
      leadForm.reset();
      leadForm.hidden = true;
      notify('Lead added to your workspace.');
    } catch (error) {
      notify(error.message, true);
    }
  });
  byId('leadSearch').addEventListener('input', renderLeads);

  document.querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.plan === (user?.plan || 'free')) return;
      checkoutPlan = button.dataset.plan;
      byId('checkoutDescription').textContent = `${plans[checkoutPlan].name} — $${plans[checkoutPlan].price} per month. This demo checkout will not charge you.`;
      byId('checkoutError').textContent = '';
      byId('confirmCheckout').textContent = `Confirm ${plans[checkoutPlan].name}`;
      checkoutModal.hidden = false;
    });
  });
  byId('confirmCheckout').addEventListener('click', async () => {
    const button = byId('confirmCheckout');
    button.disabled = true;
    try {
      const result = await api('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: checkoutPlan }),
      });
      user = result.user;
      updatePlanUI();
      closeModal(checkoutModal);
      notify(`${plans[checkoutPlan].name} is now active. Demo checkout only; no payment was processed.`);
    } catch (error) {
      byId('checkoutError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal(authModal);
      closeModal(checkoutModal);
    }
  });

  async function boot() {
    if (!sessionStorage.getItem('northstar.hasSession')) {
      showLanding();
      return;
    }
    try {
      const { user: currentUser } = await api('/api/auth/me');
      await establishSession(currentUser);
    } catch (error) {
      user = null;
      sessionStorage.removeItem('northstar.hasSession');
      showLanding();
    }
  }

  boot();
})();
