// npp.sale service worker — cho phép mở app khi mất mạng (cold start).
// Chiến lược thận trọng:
//   - Tài sản tĩnh bất biến (/_next/static, logo): cache-first.
//   - Điều hướng trang: network-first, offline thì trả bản đã cache.
//   - TUYỆT ĐỐI không cache: /api, /login, /qr-login, và mọi request
//     khác origin (Supabase). Chỉ cache GET trả về 200.
// Bump CACHE_VERSION mỗi lần đổi logic SW để dọn cache cũ.
// (23/10/2026 bật tải trước điều hướng — KHÔNG bump: thứ trong cache không đổi nghĩa, dọn đi chỉ bắt
// mọi máy tải lại toàn bộ JS lần sau.)
const CACHE_VERSION = "npp-v2" // v2 (28/09/2026): logo mới — bỏ bản /logo.svg cũ trong bộ nhớ
const STATIC_CACHE = `${CACHE_VERSION}-static`
const PAGE_CACHE = `${CACHE_VERSION}-pages`

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      /* ⚠ TẢI TRƯỚC ĐIỀU HƯỚNG (chủ nhà 23/10/2026 "load trang chậm lắm"). Không bật thì mỗi lần mở trang
         cứng, trình duyệt phải ĐÁNH THỨC service worker xong mới được gửi yêu cầu trang — trên điện thoại
         mất cả trăm mili giây trước khi máy chủ nhận được gì. Bật thì yêu cầu trang đi song song lúc SW
         thức dậy (`event.preloadResponse`). Trình duyệt không có thì thôi — chạy như cũ. */
      try {
        if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      } catch (e) {
        /* bỏ qua — chỉ là chậm hơn một chút */
      }
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

function isCacheableNav(url) {
  return (
    !url.pathname.startsWith("/api") &&
    !url.pathname.startsWith("/login") &&
    !url.pathname.startsWith("/qr-login") &&
    !url.pathname.startsWith("/debug")
  )
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // bỏ qua Supabase & CDN ngoài

  // Tài sản tĩnh bất biến — cache-first (tên file có hash, an toàn).
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const clone = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put(req, clone))
            }
            return res
          })
      )
    )
    return
  }

  // Điều hướng trang — network-first, fallback cache khi offline.
  if (req.mode === "navigate" && isCacheableNav(url)) {
    event.respondWith(
      // Bản tải trước (đã đi song song lúc SW thức dậy); không có thì tự tải như cũ.
      Promise.resolve(event.preloadResponse)
        .then((pre) => pre || fetch(req))
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(req, clone))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(req)
          if (cached) return cached
          // Fallback cuối: trang bất kỳ đã cache (giữ được vỏ app).
          const anyPage = await caches.open(PAGE_CACHE).then((c) => c.keys())
          if (anyPage.length > 0) {
            const fallback = await caches.match(anyPage[0])
            if (fallback) return fallback
          }
          return new Response(
            "<h1>Ngoại tuyến</h1><p>Mở lại khi có mạng để tải trang này lần đầu.</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
          )
        })
    )
  }
})
