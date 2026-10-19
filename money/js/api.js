/* =============================================================
   월여유 API 클라이언트  (모든 페이지에서 window.WY 로 사용해요)

   사용 예)
     WY.post('/auth/login', { email, password })   → /api/auth/login
     WY.get('/profile')                            → /api/profile
     WY.del('/transactions/' + id)

   · 같은 오리진(Express가 money 폴더를 서빙)이면 BASE 는 공백이에요
   · vite 등 다른 포트에서 열 때는 <script>window.WY_API_BASE='http://localhost:4000'</script>
     를 api.js 보다 위에 넣으면 됩니다
   ============================================================= */
(function () {
  var TOKEN_KEY = 'wolyeoyu-token';
  var REFRESH_KEY = 'wolyeoyu-refresh';
  var BASE = (typeof window !== 'undefined' && window.WY_API_BASE) || '';

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function setToken(token, keep) {
    try {
      var store = keep === false ? sessionStorage : localStorage;
      var other = keep === false ? localStorage : sessionStorage;
      store.setItem(TOKEN_KEY, token);
      other.removeItem(TOKEN_KEY);
    } catch (e) { /* 사파리 프라이빗 모드 등 */ }
  }

  function clearToken() {
    try {
      [localStorage, sessionStorage].forEach(function (s) {
        s.removeItem(TOKEN_KEY);
        s.removeItem(REFRESH_KEY);
      });
    } catch (e) {}
  }

  function request(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(BASE + '/api' + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (!res.ok) {
          var err = new Error(data.error || ('요청에 실패했어요 (' + res.status + ')'));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  window.WY = {
    get: function (path) { return request(path); },
    post: function (path, body) { return request(path, { method: 'POST', body: body }); },
    put: function (path, body) { return request(path, { method: 'PUT', body: body }); },
    patch: function (path, body) { return request(path, { method: 'PATCH', body: body }); },
    del: function (path) { return request(path, { method: 'DELETE' }); },
    token: getToken,
    setToken: setToken,
    clearToken: clearToken,
    loggedIn: function () { return !!getToken(); },
    /* 로그인 유지 정보를 페이지 공통 키에 맞춰 정리 (로그아웃할 때) */
    signOut: function () {
      clearToken();
      try {
        ['wolyeoyu-login', 'wolyeoyu-name', 'wolyeoyu-mail', 'wolyeoyu-setup'].forEach(function (k) {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
      } catch (e) {}
    }
  };
})();
