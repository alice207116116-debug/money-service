import { Router } from 'express';
import { q, q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';
import { monthStart } from './plans.js';

const r = Router();
r.use(requireAuth);

/**
 * GET /api/transactions?month=2026-10&category=<id>&limit=100
 * 최근 거래 / salary.html 내역 / 이번 주 지출에 써요
 */
r.get(
  '/',
  wrap(async (req, res) => {
    const month = monthStart(req.query.month);
    const next = month ? new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const { rows } = await q(
      `SELECT t.id, t.type, t.name, t.memo, t.amount, t.icon, t.spent_at,
              t.category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
         FROM public.transactions t
         LEFT JOIN public.categories c ON c.id = t.category_id
        WHERE t.user_id = $1
          AND ($2::date IS NULL OR (t.spent_at >= $2::date AND t.spent_at < $3::date))
          AND ($4::uuid IS NULL OR t.category_id = $4::uuid)
        ORDER BY t.spent_at DESC
        LIMIT $5`,
      [req.userId, month, next, req.query.category || null, limit]
    );
    res.json(rows);
  })
);

/** POST /api/transactions { name, amount, categoryId?, memo?, type?, spentAt? } */
r.post(
  '/',
  wrap(async (req, res) => {
    const { name, amount, categoryId, memo, type, spentAt } = req.body ?? {};
    const amt = Math.trunc(Number(amount));
    if (!amt || amt <= 0) return res.status(400).json({ error: '금액을 입력해 주세요' });

    const kind = type === 'income' ? 'income' : 'expense';
    const row = await q1(
      `INSERT INTO public.transactions (user_id, category_id, type, name, memo, amount, spent_at)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
       RETURNING *`,
      [
        req.userId,
        categoryId || null,
        kind,
        String(name ?? '기타').trim().slice(0, 30) || '기타',
        memo ? String(memo).trim().slice(0, 100) : null,
        amt,
        spentAt || null,
      ]
    );
    res.status(201).json(row);
  })
);

/** DELETE /api/transactions/:id */
r.delete(
  '/:id',
  wrap(async (req, res) => {
    const { rowCount } = await q('DELETE FROM public.transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!rowCount) return res.status(404).json({ error: '거래 내역이 없어요' });
    res.json({ ok: true });
  })
);

/**
 * GET /api/transactions/summary?month=2026-10
 * 대시보드 히어로 숫자 + 이번 주 지출 + 분류별 도넛을 한 번에
 */
r.get(
  '/summary',
  wrap(async (req, res) => {
    const month = monthStart(req.query.month) ?? monthStart();
    const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

    const [income, expense, byCategory, week] = await Promise.all([
      q1(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
           FROM public.transactions
          WHERE user_id = $1 AND type = 'income' AND spent_at >= $2::date AND spent_at < $3::date`,
        [req.userId, month, next]
      ),
      q1(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
           FROM public.transactions
          WHERE user_id = $1 AND type = 'expense' AND spent_at >= $2::date AND spent_at < $3::date`,
        [req.userId, month, next]
      ),
      q(
        `SELECT COALESCE(c.id, '00000000-0000-0000-0000-000000000000') AS category_id,
                COALESCE(c.name, t.name) AS name,
                COALESCE(c.color, '#d9d9d9') AS color,
                COALESCE(c.icon, 'dots') AS icon,
                SUM(t.amount)::bigint AS amount
           FROM public.transactions t
           LEFT JOIN public.categories c ON c.id = t.category_id
          WHERE t.user_id = $1 AND t.type = 'expense' AND t.spent_at >= $2::date AND t.spent_at < $3::date
          GROUP BY c.id, c.name, c.color, c.icon, t.name
          ORDER BY amount DESC`,
        [req.userId, month, next]
      ),
      q1(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
           FROM public.transactions
          WHERE user_id = $1 AND type = 'expense' AND spent_at >= DATE_TRUNC('week', CURRENT_DATE)`,
        [req.userId]
      ),
    ]);

    const fixed = await q1(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total, COUNT(*)::int AS count
         FROM public.fixed_expenses WHERE user_id = $1 AND is_active = true`,
      [req.userId]
    );
    const plans = await q1(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total, COUNT(*)::int AS count
         FROM public.monthly_plans WHERE user_id = $1 AND month = $2::date`,
      [req.userId, month]
    );
    const profile = await q1(
      `SELECT salary, payday, saving_goal, daily_budget FROM public.profiles WHERE user_id = $1`,
      [req.userId]
    );

    res.json({
      month: month.toISOString().slice(0, 10),
      income: Number(income.total),
      expense: Number(expense.total),
      weekExpense: Number(week.total),
      fixedTotal: Number(fixed.total),
      fixedCount: fixed.count,
      planTotal: Number(plans.total),
      planCount: plans.count,
      byCategory: byCategory.rows.map((c) => ({ ...c, amount: Number(c.amount) })),
      profile,
    });
  })
);

export default r;
