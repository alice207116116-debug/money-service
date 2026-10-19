-- =============================================================
--  월여유 (WOLYEOYU) · PostgreSQL (Supabase) 스키마
--  파일: sche.sql
--  내용: 전체 DROP + CREATE (실행할 때마다 깨끗하게 새로 만듭니다)
--  실행: Supabase Dashboard → SQL Editor → New query → 그대로 실행
--
--  금액 단위는 모두 원(₩) 입니다.
-- =============================================================


-- =============================================================
-- 0. DROP  (의존 순서 반대 · CASCADE)
-- =============================================================
DROP TABLE IF EXISTS public.password_reset_tokens  CASCADE;
DROP TABLE IF EXISTS public.legal_documents        CASCADE;
DROP TABLE IF EXISTS public.support_tickets        CASCADE;
DROP TABLE IF EXISTS public.faqs                   CASCADE;
DROP TABLE IF EXISTS public.notifications          CASCADE;
DROP TABLE IF EXISTS public.asset_snapshots        CASCADE;
DROP TABLE IF EXISTS public.savings_deposits       CASCADE;
DROP TABLE IF EXISTS public.savings_goals          CASCADE;
DROP TABLE IF EXISTS public.transactions           CASCADE;
DROP TABLE IF EXISTS public.monthly_plans          CASCADE;
DROP TABLE IF EXISTS public.fixed_expenses         CASCADE;
DROP TABLE IF EXISTS public.categories             CASCADE;
DROP TABLE IF EXISTS public.profiles               CASCADE;
DROP TABLE IF EXISTS public.users                  CASCADE;

DROP FUNCTION IF EXISTS public.set_updated_at()          CASCADE;
DROP FUNCTION IF EXISTS public.current_app_user_id()     CASCADE;

DROP TYPE IF EXISTS public.tx_type       CASCADE;
DROP TYPE IF EXISTS public.noti_level    CASCADE;
DROP TYPE IF EXISTS public.ticket_status CASCADE;


-- =============================================================
-- 1. ENUM 타입
-- =============================================================
CREATE TYPE public.tx_type       AS ENUM ('income', 'expense');   -- 수입 / 지출
CREATE TYPE public.noti_level    AS ENUM ('info', 'warn');        -- 알림 등급
CREATE TYPE public.ticket_status AS ENUM ('open', 'answered', 'closed');


-- =============================================================
-- 2. 함수
-- =============================================================

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 로그인한 사용자의 users.id 를 돌려주는 헬퍼
-- (Supabase Auth 와 서비스 계정 테이블을 연결해요)
-- Supabase Auth 를 쓰지 않고 서비스가 직접 로그인을 처리하면
-- anon 키로는 조회가 막히므로 서버는 service_role 키를 사용하세요.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.auth_uid IS NOT NULL
    AND u.auth_uid = auth.uid();
$$;


-- =============================================================
-- 3. 테이블
-- =============================================================

-- -------------------------------------------------------------
-- 3-1. users · 계정 (login.html · 비밀번호 찾기)
-- -------------------------------------------------------------
CREATE TABLE public.users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid      uuid        UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  email         text        NOT NULL,
  password_hash text,                          -- bcrypt 해시 (직접 로그인을 쓸 때)
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON public.users (lower(email));

COMMENT ON TABLE  public.users       IS '서비스 계정';
COMMENT ON COLUMN public.users.auth_uid IS 'Supabase Auth(auth.users) 와 연결하는 키. 직접 로그인만 쓰면 NULL';


-- -------------------------------------------------------------
-- 3-2. profiles · 프로필 + 월급 정보 + 알림 설정
--      (Onboarding.html / mypage.html 의 wolyeoyu-setup 값)
-- -------------------------------------------------------------
CREATE TABLE public.profiles (
  user_id           uuid        PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  name              text        NOT NULL DEFAULT '',            -- 이름 또는 별명 (최대 12자)
  email             text,                                       -- 표시용 이메일
  salary            integer     NOT NULL DEFAULT 0 CHECK (salary >= 0),        -- 세후 한 달 월급
  payday            smallint    NOT NULL DEFAULT 1  CHECK (payday BETWEEN 1 AND 31),  -- 매달 월급날
  saving_goal       integer     NOT NULL DEFAULT 0 CHECK (saving_goal >= 0),   -- 한 달 저축 목표
  daily_budget      integer     NOT NULL DEFAULT 0 CHECK (daily_budget >= 0),  -- 하루 예산 (계산값 캐시)
  notify_pay        boolean     NOT NULL DEFAULT true,   -- 결제 하루 전 알림
  notify_daily      boolean     NOT NULL DEFAULT true,   -- 아침 예산 알림
  notify_over       boolean     NOT NULL DEFAULT false,  -- 하루 예산 초과 알림
  notify_report     boolean     NOT NULL DEFAULT true,   -- 월급날 리포트
  setup_completed_at timestamptz,                         -- 온보딩 완료 시각
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.profiles       IS '온보딩에서 만드는 프로필·월급·알림 설정';
COMMENT ON COLUMN public.profiles.daily_budget IS '(월급 - 정기지출 - 저축) / 다음 월급날까지 남은 일수';


-- -------------------------------------------------------------
-- 3-3. categories · 지출 분류
--      (home.html 빠른 적기: 식비·교통·카페·쇼핑·기타 / salary.html 도넛)
-- -------------------------------------------------------------
CREATE TABLE public.categories (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid     REFERENCES public.users (id) ON DELETE CASCADE,  -- NULL 이면 서비스 기본 분류
  name       text     NOT NULL,
  color      text     NOT NULL DEFAULT '#4a968c',   -- 도넛/범례 색상
  icon       text     NOT NULL DEFAULT 'dots',      -- SVG 아이콘 키
  sort_order integer  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- user_id 가 NULL(기본 분류)은 이름이 겹치면 안 되고,
-- 사용자별 분류도 같은 사용자 안에서만 겹치지 않게
CREATE UNIQUE INDEX categories_global_name_key ON public.categories (name) WHERE user_id IS NULL;
CREATE UNIQUE INDEX categories_user_name_key   ON public.categories (user_id, name) WHERE user_id IS NOT NULL;
CREATE INDEX categories_user_idx ON public.categories (user_id, sort_order);


-- -------------------------------------------------------------
-- 3-4. fixed_expenses · 정기지출
--      (Onboarding 3단계 / dashboard.html 정기지출 / mypage 정기지출)
-- -------------------------------------------------------------
CREATE TABLE public.fixed_expenses (
  id         uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid      NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name       text      NOT NULL,                       -- 월세, 통신비, 구독료 ...
  amount     integer   NOT NULL CHECK (amount > 0),
  pay_day    smallint  NOT NULL CHECK (pay_day BETWEEN 1 AND 31),  -- 매달 결제일
  is_active  boolean   NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fixed_expenses_user_idx     ON public.fixed_expenses (user_id, pay_day);
CREATE INDEX fixed_expenses_user_day_idx ON public.fixed_expenses (user_id, pay_day, amount);


-- -------------------------------------------------------------
-- 3-5. monthly_plans · 이번 달 사용 계획(목적)
--      (dashboard.html "이번 달 사용 계획" 패널)
-- -------------------------------------------------------------
CREATE TABLE public.monthly_plans (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid     NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  month      date     NOT NULL,                -- 해당 달의 1일 (예: 2026-10-01)
  name       text     NOT NULL,                -- 식비, 약속 · 취미, 쇼핑 · 자기관리 ...
  amount     integer  NOT NULL CHECK (amount > 0),
  sort_order integer  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_trunc('month', month)::date = month)
);

CREATE UNIQUE INDEX monthly_plans_user_month_name_key ON public.monthly_plans (user_id, month, name);
CREATE INDEX monthly_plans_user_month_idx ON public.monthly_plans (user_id, month);


-- -------------------------------------------------------------
-- 3-6. transactions · 거래 내역
--      (home.html 빠른 지출 적기 / 최근 거래 / salary.html 거래 내역)
-- -------------------------------------------------------------
CREATE TABLE public.transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  category_id uuid        REFERENCES public.categories (id) ON DELETE SET NULL,
  type        public.tx_type NOT NULL DEFAULT 'expense',
  name        text        NOT NULL,                     -- 스타벅스, 버스, 월세 이체 ...
  memo        text,                                     -- "점심 김밥" 같은 메모
  amount      integer     NOT NULL CHECK (amount > 0),
  icon        text        NOT NULL DEFAULT 'dots',      -- 아이콘 키 (bus, food, tv ...)
  spent_at    timestamptz NOT NULL DEFAULT now(),       -- 거래 시각
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_user_time_idx  ON public.transactions (user_id, spent_at DESC);
CREATE INDEX transactions_user_cat_idx   ON public.transactions (user_id, category_id, spent_at DESC);
CREATE INDEX transactions_user_week_idx  ON public.transactions (user_id, spent_at DESC)
  WHERE type = 'expense';


-- -------------------------------------------------------------
-- 3-7. savings_goals · 저축 목표 (salary.html 이번 달 목표)
-- -------------------------------------------------------------
CREATE TABLE public.savings_goals (
  id             uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid      NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name           text      NOT NULL,                  -- 제주 여행, 비상금 ...
  icon           text      NOT NULL DEFAULT 'star',   -- plane / shield / gift / device / star
  target_amount  integer   NOT NULL CHECK (target_amount > 0),
  current_amount integer   NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  is_primary     boolean   NOT NULL DEFAULT false,    -- 위쪽 큰 목표(진행 링)에 쓰는 대표 목표
  sort_order     integer   NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX savings_goals_user_idx ON public.savings_goals (user_id, sort_order);


-- -------------------------------------------------------------
-- 3-8. savings_deposits · 목표에 넣은 돈 (지금 모으기)
-- -------------------------------------------------------------
CREATE TABLE public.savings_deposits (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id     uuid        NOT NULL REFERENCES public.savings_goals (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount      integer     NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX savings_deposits_goal_idx ON public.savings_deposits (goal_id, created_at DESC);


-- -------------------------------------------------------------
-- 3-9. asset_snapshots · 월별 총 자산 (salary.html 자산 현황 그래프)
-- -------------------------------------------------------------
CREATE TABLE public.asset_snapshots (
  id           uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid      NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  month        date      NOT NULL,                    -- 해당 달의 1일
  total_amount bigint    NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (date_trunc('month', month)::date = month)
);

CREATE UNIQUE INDEX asset_snapshots_user_month_key ON public.asset_snapshots (user_id, month);
CREATE INDEX asset_snapshots_user_idx ON public.asset_snapshots (user_id, month);


-- -------------------------------------------------------------
-- 3-10. notifications · 알림 (home.html 종 모양 패널)
-- -------------------------------------------------------------
CREATE TABLE public.notifications (
  id         uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid              NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  level      public.noti_level NOT NULL DEFAULT 'info',
  kind       text              NOT NULL,       -- 결제 예정, 오늘 예산, 예산 초과, 저축 ...
  body       text              NOT NULL,       -- 알림 본문 (HTML 조각 허용)
  is_read    boolean           NOT NULL DEFAULT false,
  created_at timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON public.notifications (user_id, created_at DESC) WHERE is_read = false;


-- -------------------------------------------------------------
-- 3-11. faqs · 자주 묻는 질문 (support.html)
-- -------------------------------------------------------------
CREATE TABLE public.faqs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question     text        NOT NULL,
  answer       text        NOT NULL,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX faqs_pub_idx ON public.faqs (is_published, sort_order);


-- -------------------------------------------------------------
-- 3-12. support_tickets · 1:1 문의 (support.html)
-- -------------------------------------------------------------
CREATE TABLE public.support_tickets (
  id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid              REFERENCES public.users (id) ON DELETE SET NULL,  -- 비회원 문의는 NULL
  email       text              NOT NULL,
  title       text              NOT NULL,
  body        text              NOT NULL,
  status      public.ticket_status NOT NULL DEFAULT 'open',
  answer      text,                                  -- 상담사 답변
  answered_at timestamptz,
  created_at  timestamptz       NOT NULL DEFAULT now(),
  updated_at  timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX support_tickets_user_idx    ON public.support_tickets (user_id, created_at DESC);
CREATE INDEX support_tickets_status_idx  ON public.support_tickets (status, created_at DESC);


-- -------------------------------------------------------------
-- 3-13. legal_documents · 약관 / 정책 (모든 페이지 푸터)
-- -------------------------------------------------------------
CREATE TABLE public.legal_documents (
  slug       text        PRIMARY KEY,     -- terms, privacy, marketing ...
  title      text        NOT NULL,
  body       text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- -------------------------------------------------------------
-- 3-14. password_reset_tokens · 비밀번호 찾기 링크 (login.html)
-- -------------------------------------------------------------
CREATE TABLE public.password_reset_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  token      text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens (user_id);
CREATE INDEX password_reset_tokens_exp_idx  ON public.password_reset_tokens (expires_at);


-- =============================================================
-- 4. updated_at 트리거
-- =============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'profiles', 'fixed_expenses', 'monthly_plans', 'transactions',
    'savings_goals', 'faqs', 'support_tickets', 'legal_documents'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated
         BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      t, t
    );
  END LOOP;
END;
$$;


-- =============================================================
-- 5. RLS (Supabase 는 기본적으로 RLS 를 켜 둡니다)
--    · 내 데이터는 본인만 읽고 쓸 수 있어요
--    · FAQ / 약관은 누구나 읽어요
--    · 비밀번호 재설정 토큰은 서버(service_role)만 만듭니다
-- =============================================================
ALTER TABLE public.users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_expenses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_deposits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_snapshots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens  ENABLE ROW LEVEL SECURITY;

-- users
CREATE POLICY users_self ON public.users
  FOR ALL
  USING (auth_uid IS NOT NULL AND auth_uid = auth.uid())
  WITH CHECK (auth_uid IS NOT NULL AND auth_uid = auth.uid());

-- 본인 소유 테이블 (같은 규칙 반복)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'categories', 'fixed_expenses', 'monthly_plans', 'transactions',
    'savings_goals', 'savings_deposits', 'asset_snapshots', 'notifications'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %1$I_own ON public.%1$I
         FOR ALL
         USING (user_id = public.current_app_user_id())
         WITH CHECK (user_id = public.current_app_user_id());',
      t
    );
  END LOOP;
END;
$$;

-- 공개 읽기
CREATE POLICY faqs_read ON public.faqs
  FOR SELECT USING (is_published = true);

CREATE POLICY legal_documents_read ON public.legal_documents
  FOR SELECT USING (true);

-- 문의: 본인 것 + 비회원(user_id NULL) 접수
CREATE POLICY support_tickets_own ON public.support_tickets
  FOR ALL
  USING (user_id IS NULL OR user_id = public.current_app_user_id())
  WITH CHECK (user_id IS NULL OR user_id = public.current_app_user_id());

-- password_reset_tokens: 정책 없음 → 서버(service_role)만 접근


-- =============================================================
-- 6. 서비스 계정 생성용 함수
--    (users + profiles 를 한 번에 만들어요)
-- =============================================================
CREATE OR REPLACE FUNCTION public.create_app_user(
  p_email text,
  p_password_hash text DEFAULT NULL,
  p_name text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.users (email, password_hash)
  VALUES (lower(p_email), p_password_hash)
  RETURNING id INTO v_id;

  INSERT INTO public.profiles (user_id, name, email)
  VALUES (v_id, p_name, lower(p_email));

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_app_user(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id()           TO anon, authenticated;

-- =============================================================
-- 끝. 확인 쿼리 예시
-- =============================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' ORDER BY table_name;
