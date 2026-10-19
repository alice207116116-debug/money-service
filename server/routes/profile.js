import { Router } from 'express';
import { q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

const clampInt = (v, min, max, fallback = 0) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

/**
 * GET /api/profile
 * 온보딩 완료 여부(setup_completed_at)까지 함께 줘요
 */
r.get(
  '/',
  wrap(async (req, res) => {
    const profile = await q1(
      `SELECT p.user_id, p.name, p.email, p.salary, p.payday, p.saving_goal, p.daily_budget,
              p.notify_pay, p.notify_daily, p.notify_over, p.notify_report,
              p.setup_completed_at, p.created_at
         FROM public.profiles p
        WHERE p.user_id = $1`,
      [req.userId]
    );
    res.json(profile ?? {});
  })
);

/**
 * PUT /api/profile
 * body: { name, salary, payday, savingGoal, dailyBudget,
 *         notify: { pay, daily, over, report }, setupDone }
 */
r.put(
  '/',
  wrap(async (req, res) => {
    const b = req.body ?? {};
    const profile = await q1('SELECT * FROM public.profiles WHERE user_id = $1', [req.userId]);
    if (!profile) return res.status(404).json({ error: '프로필이 없어요' });

    const salary = b.salary !== undefined ? clampInt(b.salary, 0, 2_000_000_000, profile.salary) : profile.salary;
    const payday = b.payday !== undefined ? clampInt(b.payday, 1, 31, profile.payday) : profile.payday;
    const saving = b.savingGoal !== undefined ? clampInt(b.savingGoal, 0, 2_000_000_000, profile.saving_goal) : profile.saving_goal;
    const daily = b.dailyBudget !== undefined ? clampInt(b.dailyBudget, 0, 2_000_000_000, profile.daily_budget) : profile.daily_budget;
    const n = b.notify ?? {};
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 12) : profile.name;
    const email = b.email !== undefined ? String(b.email).trim().slice(0, 60).toLowerCase() : profile.email;

    const updated = await q1(
      `UPDATE public.profiles
          SET name = $2, email = $3, salary = $4, payday = $5, saving_goal = $6, daily_budget = $7,
              notify_pay = $8, notify_daily = $9, notify_over = $10, notify_report = $11,
              setup_completed_at = COALESCE(setup_completed_at, CASE WHEN $12::boolean THEN now() END)
        WHERE user_id = $1
        RETURNING *`,
      [
        req.userId,
        name,
        email,
        salary,
        payday,
        saving,
        daily,
        n.pay ?? profile.notify_pay,
        n.daily ?? profile.notify_daily,
        n.over ?? profile.notify_over,
        n.report ?? profile.notify_report,
        b.setupDone === true,
      ]
    );

    res.json(updated);
  })
);

/** POST /api/profile/reset → 온보딩 값만 초기화 (계정은 유지) */
r.post(
  '/reset',
  wrap(async (req, res) => {
    const updated = await q1(
      `UPDATE public.profiles
          SET salary = 0, payday = 1, saving_goal = 0, daily_budget = 0, setup_completed_at = NULL
        WHERE user_id = $1
        RETURNING user_id`,
      [req.userId]
    );
    res.json({ ok: !!updated });
  })
);

export default r;
