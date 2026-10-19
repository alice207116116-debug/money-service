import { Router } from 'express';
import { q, q1, tx } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

/** GET /api/goals → 대표 목표 + 서브 목표 */
r.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT id, name, icon, target_amount, current_amount, is_primary, sort_order,
              CASE WHEN target_amount > 0
                   THEN ROUND(current_amount::numeric * 100 / target_amount, 1)
                   ELSE 0 END AS percent
         FROM public.savings_goals
        WHERE user_id = $1
        ORDER BY is_primary DESC, sort_order, created_at`,
      [req.userId]
    );
    res.json(rows);
  })
);

/** POST /api/goals { name, targetAmount, currentAmount?, icon?, isPrimary? } */
r.post(
  '/',
  wrap(async (req, res) => {
    const b = req.body ?? {};
    const target = Math.trunc(Number(b.targetAmount));
    const current = Math.max(Math.trunc(Number(b.currentAmount) || 0), 0);
    if (!b.name || !target || target <= 0) return res.status(400).json({ error: '이름과 목표 금액을 입력해 주세요' });

    const row = await q1(
      `INSERT INTO public.savings_goals (user_id, name, icon, target_amount, current_amount, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.userId, String(b.name).trim().slice(0, 14), b.icon ?? 'star', target, current, b.isPrimary === true]
    );
    res.status(201).json(row);
  })
);

/** PATCH /api/goals/:id { name?, icon?, targetAmount?, currentAmount?, isPrimary? } */
r.patch(
  '/:id',
  wrap(async (req, res) => {
    const cur = await q1('SELECT * FROM public.savings_goals WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!cur) return res.status(404).json({ error: '목표가 없어요' });
    const b = req.body ?? {};

    const row = await q1(
      `UPDATE public.savings_goals
          SET name = $3, icon = $4, target_amount = $5, current_amount = $6, is_primary = $7
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [
        req.params.id,
        req.userId,
        b.name !== undefined ? String(b.name).trim().slice(0, 14) : cur.name,
        b.icon ?? cur.icon,
        b.targetAmount !== undefined ? Math.max(Math.trunc(Number(b.targetAmount)), 1) : cur.target_amount,
        b.currentAmount !== undefined ? Math.max(Math.trunc(Number(b.currentAmount)), 0) : cur.current_amount,
        b.isPrimary !== undefined ? !!b.isPrimary : cur.is_primary,
      ]
    );
    res.json(row);
  })
);

/** DELETE /api/goals/:id */
r.delete(
  '/:id',
  wrap(async (req, res) => {
    const { rowCount } = await q('DELETE FROM public.savings_goals WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!rowCount) return res.status(404).json({ error: '목표가 없어요' });
    res.json({ ok: true });
  })
);

/** POST /api/goals/:id/deposits { amount } → "지금 모으기" */
r.post(
  '/:id/deposits',
  wrap(async (req, res) => {
    const amount = Math.trunc(Number(req.body?.amount));
    if (!amount || amount <= 0) return res.status(400).json({ error: '모을 금액을 입력해 주세요' });

    const goal = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE public.savings_goals
            SET current_amount = current_amount + $3
          WHERE id = $1 AND user_id = $2
          RETURNING *`,
        [req.params.id, req.userId, amount]
      );
      if (!rows[0]) return null;
      await client.query(
        `INSERT INTO public.savings_deposits (goal_id, user_id, amount) VALUES ($1, $2, $3)`,
        [req.params.id, req.userId, amount]
      );
      return rows[0];
    });

    if (!goal) return res.status(404).json({ error: '목표가 없어요' });
    res.status(201).json(goal);
  })
);

export default r;
