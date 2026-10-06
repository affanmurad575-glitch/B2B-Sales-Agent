require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const {
  createLead,
  createUser,
  findLead,
  findUserByEmail,
  isSupabaseConfigured,
  listLeads,
  newLead,
  updateLead,
  updateUserPlan,
} = require('./src/config/supabase');
const { processSalesConversation } = require('./src/agent/engine');
const { issueToken, requireAuth, setSessionCookie } = require('./src/middleware/auth');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const plans = {
  free: { name: 'Free Tier', monthlyPrice: 0, monthlyChats: 50 },
  pro: { name: 'Pro Agent', monthlyPrice: 49, monthlyChats: Infinity },
  enterprise: { name: 'Enterprise', monthlyPrice: 199, monthlyChats: Infinity },
};

app.disable('x-powered-by');
app.use(cors({
  origin: process.env.APP_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(express.static(require('path').join(__dirname, 'public')));

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    plan: user.plan || 'free',
    createdAt: user.createdAt,
  };
}

function handleFailure(res, error, operation) {
  console.error(`${operation} failed:`, error.message);
  if (error.code === 'DUPLICATE_EMAIL') {
    return res.status(409).json({ error: error.message });
  }
  return res.status(503).json({ error: 'This request could not be completed. Please try again.' });
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', storage: isSupabaseConfigured ? 'supabase' : 'memory' });
});

app.post('/api/auth/signup', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
  }

  try {
    const user = await createUser({
      id: randomUUID(),
      email,
      passwordHash: await bcrypt.hash(password, 12),
      tenantId: randomUUID(),
      plan: 'free',
      createdAt: new Date().toISOString(),
    });
    setSessionCookie(res, issueToken(user));
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return handleFailure(res, error, 'Signup');
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    setSessionCookie(res, issueToken(user));
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return handleFailure(res, error, 'Login');
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('sales_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), storage: isSupabaseConfigured ? 'supabase' : 'memory' });
});

app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const leads = await listLeads(req.user.tenantId, req.user.id);
    return res.json({ leads });
  } catch (error) {
    return handleFailure(res, error, 'Lead listing');
  }
});

app.post('/api/leads', requireAuth, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const company = typeof req.body?.company === 'string' ? req.body.company.trim() : '';
  if (!name || name.length > 120 || email.length > 254 || company.length > 120) {
    return res.status(400).json({ error: 'Enter a lead name and valid contact details.' });
  }
  try {
    const lead = await createLead(newLead({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      name,
      email,
      company,
    }));
    return res.status(201).json({ lead });
  } catch (error) {
    return handleFailure(res, error, 'Lead creation');
  }
});

app.patch('/api/leads/:id', requireAuth, async (req, res) => {
  const allowedStates = ['COLD', 'QUALIFIED', 'OBJECTION_HANDLING', 'CLOSING'];
  if (!allowedStates.includes(req.body?.status)) {
    return res.status(400).json({ error: 'Select a valid lead stage.' });
  }
  try {
    const lead = await findLead(req.params.id, req.user.tenantId, req.user.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const updated = await updateLead({ ...lead, status: req.body.status, updatedAt: new Date().toISOString() });
    return res.json({ lead: updated });
  } catch (error) {
    return handleFailure(res, error, 'Lead update');
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 4000) {
    return res.status(400).json({ error: 'Enter a message of 1 to 4,000 characters.' });
  }

  try {
    const currentPlan = plans[req.user.plan] || plans.free;
    const workspaceLeads = await listLeads(req.user.tenantId, req.user.id);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const userMessagesThisMonth = workspaceLeads.reduce(
      (total, workspaceLead) =>
        total +
        workspaceLead.history.filter(
          (entry) => entry.role === 'user' && new Date(entry.createdAt) >= monthStart,
        ).length,
      0,
    );
    if (userMessagesThisMonth >= currentPlan.monthlyChats) {
      return res.status(429).json({ error: 'You have reached the Free Tier monthly chat limit. Upgrade to continue.' });
    }

    let lead = req.body.leadId
      ? await findLead(String(req.body.leadId), req.user.tenantId, req.user.id)
      : null;
    if (req.body.leadId && !lead) {
      return res.status(404).json({ error: 'Lead not found in this workspace.' });
    }
    if (!lead) {
      lead = await createLead(newLead({
        userId: req.user.id,
        tenantId: req.user.tenantId,
        name: 'New prospect',
      }));
    }

    const result = await processSalesConversation(
      message,
      lead.history,
      lead.status,
      lead.score,
    );
    const now = new Date().toISOString();
    lead.history = [
      ...lead.history,
      { role: 'user', content: message, createdAt: now },
      {
        role: 'assistant',
        content: result.reply,
        currentState: result.currentState,
        leadScore: result.leadScore,
        createdAt: now,
      },
    ].slice(-100);
    lead.status = result.currentState;
    lead.score = result.leadScore;
    lead.updatedAt = now;
    lead = await updateLead(lead);

    return res.json({
      ...result,
      leadId: lead.id,
      history: lead.history,
    });
  } catch (error) {
    return handleFailure(res, error, 'Chat');
  }
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const plan = req.body?.plan;
  if (!Object.hasOwn(plans, plan)) {
    return res.status(400).json({ error: 'Choose a valid workspace plan.' });
  }
  try {
    const user = await updateUserPlan(req.user.id, req.user.tenantId, plan);
    if (!user) return res.status(404).json({ error: 'Workspace was not found.' });
    return res.json({
      user: publicUser(user),
      checkout: { status: 'mock_complete', plan, message: 'Demo checkout complete. No payment was processed.' },
    });
  } catch (error) {
    return handleFailure(res, error, 'Plan update');
  }
});

app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 400 || error.type === 'entity.parse.failed' ? 400 : 500;
  console.error('Unhandled request error:', error.message);
  return res.status(status).json({ error: status === 400 ? 'Request body must be valid JSON.' : 'Unexpected server error.' });
});

app.listen(port, () => {
  console.log(`B2B Sales Agent is running at http://localhost:${port}`);
  if (!isSupabaseConfigured) {
    console.log('Using in-memory storage. Configure SUPABASE_URL and SUPABASE_KEY for persistent storage.');
  }
});
