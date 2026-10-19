import { Router } from 'express';
import { q, q1 } from '../db.js';
import { requireAuth, optionalAuth, wrap } from '../middleware/auth.js';

const r = Router();

/** GET /api/support/faqs → 공개 (로그인 없이도) */
r.get(
  '/faqs',
  wrap(async (_req, res) => {
    const { rows } = await q(
      `SELECT id, question, answer, sort_order
         FROM public.faqs
        WHERE is_published = true
        ORDER BY sort_order, id`
    );
    res.json(rows);
  })
);

/** GET /api/support/documents/:slug → 약관/정책 (terms, privacy, marketing ...) */
r.get(
  '/documents/:slug',
  wrap(async (req, res) => {
    const doc = await q1('SELECT slug, title, body, updated_at FROM public.legal_documents WHERE slug = $1', [req.params.slug]);
    if (!doc) return res.status(404).json({ error: '문서가 없어요' });
    res.json(doc);
  })
);

/** POST /api/support/tickets { email, title, body } → 1:1 문의 (비회원도 가능) */
r.post(
  '/tickets',
  optionalAuth,
  wrap(async (req, res) => {
    const { email, title, body } = req.body ?? {};
    if (!email || !title || !body) return res.status(400).json({ error: '이메일·제목·내용을 모두 입력해 주세요' });

    let userId = null;
    if (req.authUid) {
      const u = await q1('SELECT id FROM public.users WHERE auth_uid = $1', [req.authUid]);
      userId = u?.id ?? null;
    }

    const row = await q1(
      `INSERT INTO public.support_tickets (user_id, email, title, body)
       VALUES ($1, lower($2), $3, $4) RETURNING id, email, title, status, created_at`,
      [userId, String(email).slice(0, 60), String(title).slice(0, 60), String(body).slice(0, 2000)]
    );
    res.status(201).json(row);
  })
);

/** GET /api/support/tickets → 내가 남긴 문의 */
r.get(
  '/tickets',
  requireAuth,
  wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT id, email, title, body, status, answer, answered_at, created_at
         FROM public.support_tickets
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(rows);
  })
);

export default r;
