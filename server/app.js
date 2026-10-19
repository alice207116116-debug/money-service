import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import fixedRoutes from './routes/fixedExpenses.js';
import planRoutes from './routes/plans.js';
import transactionRoutes from './routes/transactions.js';
import categoryRoutes from './routes/categories.js';
import goalRoutes from './routes/goals.js';
import assetRoutes from './routes/assets.js';
import notificationRoutes from './routes/notifications.js';
import supportRoutes from './routes/support.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
  next();
});

/** 상태 확인용 */
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'wolyeoyu', now: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/fixed-expenses', fixedRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/support', supportRoutes);

/** 프론트(money 폴더)를 그대로 서빙 → http://localhost:4000/home.html */
app.use(express.static(path.join(__dirname, '..', 'money')));

app.use((req, res) => res.status(404).json({ error: `찾을 수 없는 주소예요: ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '서버 오류가 발생했어요' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`월여유 API 서버 실행 중: http://localhost:${port}`);
  console.log(`프론트 미리보기: http://localhost:${port}/home.html`);
});
