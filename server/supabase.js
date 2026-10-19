import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

let _client = null;

/**
 * Supabase Admin 클라이언트 (service_role)
 * - 회원가입 / 로그인 / 로그아웃 / 비밀번호 재설정을 위임해요
 * - RLS 를 우회하므로 서버에서만 씁니다
 */
export function supabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요 (.env 확인)');
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
