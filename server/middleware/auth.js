import jwt from 'jsonwebtoken';
import { q1 } from '../db.js';
import { supabase } from '../supabase.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

/** 비동기 라우터용 try/catch 래퍼 */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** auth.users.id → 서비스 users.id 매핑 (없으면 첫 로그인이라 새로 만든다) */
async function resolveAppUser(authUid) {
  const existing = await q1('SELECT id, email FROM public.users WHERE auth_uid = $1', [authUid]);
  if (existing) return existing;

  const { data, error } = await supabase().auth.admin.getUserById(authUid);
  if (error) throw error;
  const email = data.user?.email ?? `${authUid}@no-email.local`;

  const created = await q1(
    `INSERT INTO public.users (auth_uid, email)
     VALUES ($1, lower($2))
     ON CONFLICT (auth_uid) DO UPDATE SET auth_uid = EXCLUDED.auth_uid
     RETURNING id, email`,
    [authUid, email]
  );
  await q1(
    `INSERT INTO public.profiles (user_id, email)
     VALUES ($1, lower($2))
     ON CONFLICT (user_id) DO NOTHING`,
    [created.id, email]
  );
  return created;
}

/**
 * Supabase Auth 액세스 토큰 검증 미들웨어
 * 헤더: Authorization: Bearer <access_token>
 * req.authUid = Supabase auth.users.id / req.userId = public.users.id
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: '로그인이 필요해요' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: '로그인 정보가 만료됐어요. 다시 로그인해 주세요' });
    }

    req.authUid = payload.sub;
    const user = await resolveAppUser(req.authUid);
    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch (err) {
    next(err);
  }
}

/** 로그인 여부를 모르는 공개 라우트용 (있으면만 채운다) */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      req.authUid = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] }).sub;
    } catch {
      /* 토큰이 이상해도 공개 라우트는 그냥 진행 */
    }
  }
  next();
}
