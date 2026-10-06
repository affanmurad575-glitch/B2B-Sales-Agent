const jwt = require('jsonwebtoken');
const { findUserById } = require('../config/supabase');

const hasConfiguredSecret =
  typeof process.env.JWT_SECRET === 'string' &&
  process.env.JWT_SECRET.length >= 32 &&
  !process.env.JWT_SECRET.startsWith('replace_');

if (process.env.NODE_ENV === 'production' && !hasConfiguredSecret) {
  throw new Error('Set a strong JWT_SECRET before starting in production.');
}
if (process.env.NODE_ENV !== 'production' && !hasConfiguredSecret) {
  console.warn('JWT_SECRET is not configured; using a temporary development secret.');
}
const jwtSecret = hasConfiguredSecret
  ? process.env.JWT_SECRET
  : require('crypto').randomBytes(32).toString('hex');

function issueToken(user) {
  return jwt.sign({ tenantId: user.tenantId }, jwtSecret, {
    subject: user.id,
    expiresIn: '7d',
  });
}

function setSessionCookie(res, token) {
  res.cookie('sales_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

async function requireAuth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = req.cookies?.sales_session || bearer;
  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }

  try {
    const claims = jwt.verify(token, jwtSecret);
    const user = await findUserById(claims.sub);
    if (!user || user.tenantId !== claims.tenantId) {
      return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      res.clearCookie('sales_session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
    return next(error);
  }
}

module.exports = { issueToken, requireAuth, setSessionCookie };
