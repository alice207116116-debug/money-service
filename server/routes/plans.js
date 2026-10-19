import { Router } from 'express';
import { q, q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

/** 해당 달 1일로 정규화 (예: '2026-10' | '2026-10-01' | Date) */
export function monthStart(input) {
  if (!input) {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  }
  const s = String(input);
  const [y, m] = s.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m ?? 1) - 1, 1));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** GET /api/plans?month=2026-10 */
r.get(
  '/',
  wrap(async (req, res) => {
    const month = monthStart(req.query.month);
    if (!month) return res.status(400).json({ error: '월 형식이 잘못됐어요 (예: 2026-10)' });

    const { rows } = await q(
      `SELECT id, month, name, amount, sort_order
         FROM public.monthly_plans
        WHERE user_id = $1 AND month = $2::date
        ORDER BY sort_order, name`,
      [req.userId, month]
    );
    res.json(rows);
  })
);

/** POST /api/plans { month, name, amount } */
r.post(
  '/',
  wrap(async (req, res) => {
    const { name, amount } = req.body ?? {};
    const month = monthStart(req.body?.month);
    const amt = Math.trunc(Number(amount));
    if (!month || !name || !amt || amt <= 0) return res.status(400).json({ error: '목적 이름과 금액을 확인해 주세요' });

    const row = await q1(
      `INSERT INTO public.monthly_plans (user_id, month, name, amount)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (user_id, month, name) DO UPDATE SET amount = EXCLUDED.amount
       RETURNING *`,
      [req.userId, month, String(name).trim().slice(0, 30), amt]
    );
    res.status(201).json(row);
  })
);

/** DELETE /api/plans/:id */
r.delete(
  '/:id',
  wrap(async (req, res) => {
    const { rowCount } = await q('DELETE FROM public.monthly_plans WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!rowCount) return res.status(404).json({ error: '사용 계획이 없어요' });
    res.json({ ok: true });
  })
);

export default r;
