import { Router } from 'express';
import { q, q1 } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

/** GET /api/notifications?limit=20 */
r.get(
  '/',
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const { rows } = await q(
      `SELECT id, level, kind, body, is_read, created_at
         FROM public.notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [req.userId, limit]
    );
    const unread = await q1(
      `SELECT COUNT(*)::int AS count FROM public.notifications WHERE user_id = $1 AND is_read = false`,
      [req.userId]
    );
    res.json({ items: rows, unread: unread.count });
  })
);

/** POST /api/notifications { kind, body, level? } → 서버에서 알림 만들 때 */
r.post(
  '/',
  wrap(async (req, res) => {
    const { kind, body, level } = req.body ?? {};
    if (!kind || !body) return res.status(400).json({ error: '알림 종류와 내용이 필요해요' });

    const row = await q1(
      `INSERT INTO public.notifications (user_id, kind, body, level)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.userId, String(kind).slice(0, 20), String(body).slice(0, 300), level === 'warn' ? 'warn' : 'info']
    );
    res.status(201).json(row);
  })
);

/** POST /api/notifications/read-all → "모두 읽음" */
r.post(
  '/read-all',
  wrap(async (req, res) => {
    const { rowCount } = await q(
      'UPDATE public.notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );
    res.json({ ok: true, updated: rowCount });
  })
);

export default r;
