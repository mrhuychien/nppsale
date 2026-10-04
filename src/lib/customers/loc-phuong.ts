import { WARDS_HAI_PHONG } from "@/lib/constants/wards-hai-phong"

/**
 * Bộ lọc PHƯỜNG/XÃ của danh sách khách (chủ nhà 04/10/2026: "mất 1 số bộ lọc tuyến, phường, Phụ trách").
 * Lựa chọn = 114 phường/xã Hải Phòng sau sáp nhập (cùng danh sách ô nhập khi tạo khách), lọc `ward` trên máy chủ.
 * Phường ghi tay khác danh sách thì dùng Bộ lọc nâng cao → Phường/xã.
 */
export const CHUA_CO_PHUONG = "_chua_phuong"
export const DS_PHUONG_LOC: readonly string[] = WARDS_HAI_PHONG
