import { Router } from 'express';
import { q, q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

/** GET /api/assets?limit=13 → 월별 총 자산 그래프 */
r.get(
  '/',
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 13, 1), 60);
    const { rows } = await q(
      `SELECT id, month, total_amount
         FROM public.asset_snapshots
        WHERE user_id = $1
        ORDER BY month DESC
        LIMIT $2`,
      [req.userId, limit]
    );
    res.json(rows.reverse());
  })
);

/** POST /api/assets { month: '2026-10', totalAmount } → 오늘 자산 스냅샷 저장 */
r.post(
  '/',
  wrap(async (req, res) => {
    const { month, totalAmount } = req.body ?? {};
    const amount = Math.trunc(Number(totalAmount));
    const m = /^(\d{4})-(\d{2})/.exec(String(month ?? ''));
    if (!m || !Number.isFinite(amount)) return res.status(400).json({ error: '월(YYYY-MM)과 총 자산 금액을 확인해 주세요' });

    const row = await q1(
      `INSERT INTO public.asset_snapshots (user_id, month, total_amount)
       VALUES ($1, make_date($2::int, $3::int, 1), $4)
       ON CONFLICT (user_id, month) DO UPDATE SET total_amount = EXCLUDED.total_amount
       RETURNING *`,
      [req.userId, m[1], m[2], amount]
    );
    res.status(201).json(row);
  })
);

export default r;
