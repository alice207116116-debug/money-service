import { Router } from 'express';
import { q, q1, tx } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

/** GET /api/categories → 내 분류 + 서비스 기본 분류 */
r.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT id, user_id, name, color, icon, sort_order
         FROM public.categories
        WHERE user_id = $1 OR user_id IS NULL
        ORDER BY sort_order, name`,
      [req.userId]
    );
    res.json(rows);
  })
);

/** POST /api/categories { name, color?, icon? } */
r.post(
  '/',
  wrap(async (req, res) => {
    const { name, color, icon } = req.body ?? {};
    if (!name) return res.status(400).json({ error: '분류 이름을 입력해 주세요' });

    const row = await q1(
      `INSERT INTO public.categories (user_id, name, color, icon)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, name) WHERE user_id IS NOT NULL
       DO UPDATE SET color = EXCLUDED.color, icon = EXCLUDED.icon
       RETURNING *`,
      [req.userId, String(name).trim().slice(0, 12), color ?? '#4a968c', icon ?? 'dots']
    );
    res.status(201).json(row);
  })
);

export default r;
