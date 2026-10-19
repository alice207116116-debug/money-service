import { Router } from 'express';
import { supabase } from '../supabase.js';
import { q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();

/** POST /api/auth/register  { email, password } */
r.post(
  '/register',
  wrap(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해 주세요' });
    if (String(password).length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이에요' });

    const { data, error } = await supabase().auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({
      access_token: data.session?.access_token ?? null,
      refresh_token: data.session?.refresh_token ?? null,
      user: { id: data.user?.id, email },
      needs_confirm: !data.session, // 이메일 확인을 켜 둔 프로젝트면 여기서 끝나요
    });
  })
);

/** POST /api/auth/login  { email, password, keep } */
r.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해 주세요' });

    const { data, error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: '이메일 또는 비밀번호가 맞지 않아요' });

    // 서비스 프로필을 미리 만들어 둔다 (첫 로그인 대응)
    const user = await q1('SELECT id FROM public.users WHERE auth_uid = $1', [data.user.id]);
    if (!user) {
      const created = await q1(
        `INSERT INTO public.users (auth_uid, email)
         VALUES ($1, lower($2))
         ON CONFLICT (auth_uid) DO UPDATE SET auth_uid = EXCLUDED.auth_uid
         RETURNING id`,
        [data.user.id, email]
      );
      await q1(
        `INSERT INTO public.profiles (user_id, email)
         VALUES ($1, lower($2))
         ON CONFLICT (user_id) DO NOTHING`,
        [created.id, email]
      );
    }

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      user: { id: data.user.id, email },
    });
  })
);

/** POST /api/auth/logout */
r.post(
  '/logout',
  wrap(async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) await supabase().auth.admin.signOut(token).catch(() => {});
    res.json({ ok: true });
  })
);

/** POST /api/auth/reset-password  { email } → 재설정 메일 */
r.post(
  '/reset-password',
  wrap(async (req, res) => {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: '이메일을 입력해 주세요' });
    await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.APP_URL ?? 'http://localhost:4000'}/login.html`,
    });
    // 이메일 존재 여부를 알리지 않도록 항상 성공으로 응답
    res.json({ ok: true });
  })
);

/** GET /api/auth/me → 로그인 상태 + 프로필 요약 */
r.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const profile = await q1(
      `SELECT u.id, u.email, p.name, p.salary, p.payday, p.saving_goal, p.daily_budget,
              p.notify_pay, p.notify_daily, p.notify_over, p.notify_report,
              p.setup_completed_at, p.created_at
         FROM public.users u
         LEFT JOIN public.profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [req.userId]
    );
    res.json(profile);
  })
);

export default r;
