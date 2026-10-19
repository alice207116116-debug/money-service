import { Router } from 'express';
import { q, q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

const toInt = (v, min, max, fallback = null) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

/** GET /api/fixed-expenses?month=2026-10-01 → 이번 달 결제 예정까지 계산 */
r.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT id, name, amount, pay_day, is_active, created_at,
              (make_date(EXTRACT(year FROM $2::date)::int, EXTRACT(month FROM $2::date)::int,
                         LEAST(pay_day, EXTRACT(day FROM (DATE_TRUNC('month', $2::date) + INTERVAL '1 month - 1 day'))::int))
                 - DATE_TRUNC('month', $2::date)::date)::int AS days_left
         FROM public.fixed_expenses
        WHERE user_id = $1 AND is_active = true
        ORDER BY pay_day, name`,
      [req.userId, req.query.month ?? new Date()]
    );
    res.json(rows);
  })
);

/** POST /api/fixed-expenses { name, amount, payDay } */
r.post(
  '/',
  wrap(async (req, res) => {
    const { name, amount, payDay } = req.body ?? {};
    const amt = toInt(amount, 1, 2_000_000_000);
    const day = toInt(payDay, 1, 31);
    if (!name || !amt || !day) return res.status(400).json({ error: '이름·금액·결제일을 확인해 주세요' });

    const row = await q1(
      `INSERT INTO public.fixed_expenses (user_id, name, amount, pay_day)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.userId, String(name).trim().slice(0, 20), amt, day]
    );
    res.status(201).json(row);
  })
);

/** PATCH /api/fixed-expenses/:id { name?, amount?, payDay?, isActive? } */
r.patch(
  '/:id',
  wrap(async (req, res) => {
    const cur = await q1('SELECT * FROM public.fixed_expenses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!cur) return res.status(404).json({ error: '정기지출이 없어요' });
    const b = req.body ?? {};

    const row = await q1(
      `UPDATE public.fixed_expenses
          SET name = $3, amount = $4, pay_day = $5, is_active = $6
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [
        req.params.id,
        req.userId,
        b.name !== undefined ? String(b.name).trim().slice(0, 20) : cur.name,
        toInt(b.amount, 1, 2_000_000_000, cur.amount),
        toInt(b.payDay, 1, 31, cur.pay_day),
        b.isActive !== undefined ? !!b.isActive : cur.is_active,
      ]
    );
    res.json(row);
  })
);

/** DELETE /api/fixed-expenses/:id */
r.delete(
  '/:id',
  wrap(async (req, res) => {
    const { rowCount } = await q('DELETE FROM public.fixed_expenses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!rowCount) return res.status(404).json({ error: '정기지출이 없어요' });
    res.json({ ok: true });
  })
);

export default r;
