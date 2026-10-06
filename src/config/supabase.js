const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseKey &&
    !supabaseUrl.includes('your_') &&
    !supabaseKey.includes('your_'),
);

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const memory = {
  users: [],
  leads: [],
};

function unwrap(result, operation) {
  if (result.error) {
    throw new Error(`Supabase ${operation} failed: ${result.error.message}`);
  }
  return result.data;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    tenantId: row.tenant_id,
    plan: row.plan || 'free',
    createdAt: row.created_at,
  };
}

function mapLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    email: row.email || '',
    company: row.company || '',
    status: row.status || 'COLD',
    score: Number(row.score) || 0,
    history: Array.isArray(row.history) ? row.history : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function userToRow(user) {
  return {
    id: user.id,
    email: user.email,
    password_hash: user.passwordHash,
    tenant_id: user.tenantId,
    plan: user.plan,
    created_at: user.createdAt,
  };
}

function leadToRow(lead) {
  return {
    id: lead.id,
    tenant_id: lead.tenantId,
    user_id: lead.userId,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    status: lead.status,
    score: lead.score,
    history: lead.history,
    created_at: lead.createdAt,
    updated_at: lead.updatedAt,
  };
}

async function findUserByEmail(email) {
  if (!isSupabaseConfigured) {
    return memory.users.find((user) => user.email === email) || null;
  }
  const result = await supabase.from('sales_users').select('*').eq('email', email).maybeSingle();
  return mapUser(unwrap(result, 'user lookup'));
}

async function findUserById(id) {
  if (!isSupabaseConfigured) {
    return memory.users.find((user) => user.id === id) || null;
  }
  const result = await supabase.from('sales_users').select('*').eq('id', id).maybeSingle();
  return mapUser(unwrap(result, 'user lookup'));
}

async function createUser(user) {
  if (!isSupabaseConfigured) {
    if (memory.users.some((existing) => existing.email === user.email)) {
      const error = new Error('An account with this email already exists.');
      error.code = 'DUPLICATE_EMAIL';
      throw error;
    }
    memory.users.push(user);
    return user;
  }
  const result = await supabase.from('sales_users').insert(userToRow(user)).select('*').single();
  if (result.error && result.error.code === '23505') {
    const error = new Error('An account with this email already exists.');
    error.code = 'DUPLICATE_EMAIL';
    throw error;
  }
  return mapUser(unwrap(result, 'user creation'));
}

async function listLeads(tenantId, userId) {
  if (!isSupabaseConfigured) {
    return memory.leads
      .filter((lead) => lead.tenantId === tenantId && lead.userId === userId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
  const result = await supabase
    .from('sales_leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  return unwrap(result, 'lead listing').map(mapLead);
}

async function findLead(id, tenantId, userId) {
  if (!isSupabaseConfigured) {
    return memory.leads.find(
      (lead) => lead.id === id && lead.tenantId === tenantId && lead.userId === userId,
    ) || null;
  }
  const result = await supabase
    .from('sales_leads')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  return mapLead(unwrap(result, 'lead lookup'));
}

async function createLead(lead) {
  if (!isSupabaseConfigured) {
    memory.leads.push(lead);
    return lead;
  }
  const result = await supabase.from('sales_leads').insert(leadToRow(lead)).select('*').single();
  return mapLead(unwrap(result, 'lead creation'));
}

async function updateLead(lead) {
  if (!isSupabaseConfigured) {
    const index = memory.leads.findIndex(
      (existing) =>
        existing.id === lead.id &&
        existing.tenantId === lead.tenantId &&
        existing.userId === lead.userId,
    );
    if (index === -1) return null;
    memory.leads[index] = lead;
    return lead;
  }
  const { id, tenantId, userId, ...changes } = lead;
  const result = await supabase
    .from('sales_leads')
    .update({
      name: changes.name,
      email: changes.email,
      company: changes.company,
      status: changes.status,
      score: changes.score,
      history: changes.history,
      updated_at: changes.updatedAt,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  return mapLead(unwrap(result, 'lead update'));
}

async function updateUserPlan(id, tenantId, plan) {
  if (!isSupabaseConfigured) {
    const user = memory.users.find((existing) => existing.id === id && existing.tenantId === tenantId);
    if (!user) return null;
    user.plan = plan;
    return user;
  }
  const result = await supabase
    .from('sales_users')
    .update({ plan })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .maybeSingle();
  return mapUser(unwrap(result, 'plan update'));
}

function newLead({ userId, tenantId, name, email = '', company = '' }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tenantId,
    userId,
    name: name.trim(),
    email: email.trim(),
    company: company.trim(),
    status: 'COLD',
    score: 0,
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  createLead,
  createUser,
  findLead,
  findUserByEmail,
  findUserById,
  isSupabaseConfigured,
  listLeads,
  newLead,
  supabase,
  updateLead,
  updateUserPlan,
};
