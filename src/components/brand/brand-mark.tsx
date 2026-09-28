/**
 * LOGO npp.sale — chữ "n" khối, nền xanh bo góc (chủ nhà 28/09/2026: "Tối ưu và thay logo này vào,
 * cả icon khi tạo icon ngoài màn hình"). Vẽ bằng SVG ngay trong trang: không tải ảnh, nét ở mọi
 * cỡ. Bộ icon ngoài màn hình sinh từ `public/icons/logo.svg` — `node scripts/tao-icon.mjs`.
 *
 * `dao`: nền trắng, chữ xanh — đặt trên nền xanh (khung trái màn đăng nhập).
 */
export const LOGO_N_PATHS = [
  "M357 404L494 333Q510 325 528 330L695 376L548 455Q535 462 520 458Z",
  "M337 442Q337 418 360 426L503 478Q520 486 520 506L520 895Q520 920 495 920L362 920Q337 920 337 895Z",
  "M545 476L694 396Q710 386 730 388C820 395 890 470 890 570L890 895Q890 920 865 920L731 920Q706 920 706 895L706 612C706 555 670 520 625 505Z",
] as const

export function BrandMark({ className, dao = false, title }: { className?: string; dao?: boolean; title?: string }) {
  return (
    <svg
      viewBox="115 118 1025 1025"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="115" y="118" width="1025" height="1025" rx="235" fill={dao ? "#ffffff" : "#2563EB"} />
      <g fill={dao ? "#2563EB" : "#ffffff"}>
        {LOGO_N_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
