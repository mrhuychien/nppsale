-- ====================================================================
-- 100 — Bảng snapshot hoá đơn kéo từ MISA về
--
-- VÌ SAO CẦN
-- Toàn bộ luồng hiện tại đi MỘT CHIỀU: app đẩy hoá đơn lên MISA rồi hỏi
-- lại đúng những tờ mình đã đẩy (qua misa_ref_id). Hệ quả: hoá đơn phát
-- hành THẲNG trên web MISA — kế toán tự lập, hoá đơn thay thế do MISA
-- sinh, hoá đơn của người khác trong cùng MST — là VÔ HÌNH với sổ. Đó
-- đúng loại hoá đơn ngoài sổ mà kiểm toán sẽ hỏi.
--
-- Bảng này là bản sao ĐỌC-VỀ của danh sách hoá đơn bên MISA. Nó KHÔNG
-- phải nguồn sự thật của sổ; nó là thứ để đối chiếu hai chiều:
--   • hoá đơn có trên MISA mà không có trong sổ  → "Chỉ có trên MISA"
--   • hoá đơn có trong sổ mà không có trên MISA  → tra ngược bằng ref_id
--
-- KHOÁ TỰ NHIÊN
-- (org_id, ref_id) — RefID là GUID do MISA quản lý, duy nhất tuyệt đối.
-- Thêm chỉ mục phụ trên (org_id, inv_series_norm, inv_no_norm) vì đối
-- soát dữ liệu CŨ phải dựa vào ký hiệu + số: hoá đơn có sẵn trên MISA
-- không mang RefID do app này sinh, nên tầng khớp theo ref_id không bao
-- giờ trúng với chúng. Đã đo trên 30 hoá đơn thật: khoá (ký hiệu, số đã
-- chuẩn hoá) là DUY NHẤT.
--
-- CHUẨN HOÁ KHI SO, GIỮ NGUYÊN KHI LƯU
-- inv_no / inv_series giữ NGUYÊN VĂN chuỗi MISA trả về (số hoá đơn thật
-- là '00007140', 8 chữ số). Hai cột `*_norm` là bản đã chuẩn hoá, sinh
-- tự động, chỉ dùng để khớp — không hiển thị, không xuất báo cáo.
-- ====================================================================

CREATE TABLE IF NOT EXISTS misa_invoice_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- --- Định danh bên MISA ------------------------------------------
  ref_id text NOT NULL,
  inv_series text,
  inv_no text,
  inv_date date,
  transaction_id text,
  invoice_code text,

  -- --- Người mua ----------------------------------------------------
  buyer_tax_code text,
  buyer_name text,

  -- --- Tiền ---------------------------------------------------------
  -- CÓ THỂ ÂM: hoá đơn điều chỉnh giảm mang số chênh âm (đã đo trên dữ
  -- liệu thật). Mọi phép so tiền phải xử dấu.
  total_amount numeric,
  amount_before_vat numeric,
  vat_amount numeric,

  -- --- Hai trục trạng thái -------------------------------------------
  publish_status integer,
  einvoice_status integer,
  relation text,
  is_deleted boolean NOT NULL DEFAULT false,
  org_ref_id text,

  -- --- Đối soát ------------------------------------------------------
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  match_method text,
  match_confidence text,
  match_status text,
  match_note text,

  -- Bản ghi thô, để tra lại khi phát hiện mình bóc field sai. Không có
  -- nó thì mỗi lần nghi ngờ phải đi kéo lại toàn bộ từ MISA.
  raw jsonb,

  pulled_at timestamptz NOT NULL DEFAULT now(),
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chuẩn hoá để KHỚP. Sinh tự động nên không thể quên cập nhật.
--   số hoá đơn : bỏ khoảng trắng + số 0 ở đầu ('00007140' → '7140');
--                chuỗi toàn số 0 giữ nguyên để không nuốt mất dữ liệu
--   ký hiệu    : bỏ khoảng trắng + viết hoa. KHÔNG bỏ chữ số đầu ở đây —
--                '1C25MHG' và '2C25MHG' là hai MẪU SỐ khác nhau, gộp
--                chúng ở tầng lưu là mất dữ liệu. Việc bỏ chữ số đầu chỉ
--                được làm ở tầng khớp DỰ PHÒNG, có gắn "cần review".
ALTER TABLE misa_invoice_snapshots
  ADD COLUMN IF NOT EXISTS inv_no_norm text
    GENERATED ALWAYS AS (
      CASE
        WHEN inv_no IS NULL THEN NULL
        WHEN regexp_replace(replace(inv_no, ' ', ''), '^0+', '') = '' THEN replace(inv_no, ' ', '')
        ELSE regexp_replace(replace(inv_no, ' ', ''), '^0+', '')
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS inv_series_norm text
    GENERATED ALWAYS AS (upper(replace(COALESCE(inv_series, ''), ' ', ''))) STORED;

-- Một RefID = một hoá đơn. Kéo lại nhiều lần thì UPSERT, không nhân bản.
CREATE UNIQUE INDEX IF NOT EXISTS uq_misa_snapshot_ref
  ON misa_invoice_snapshots (org_id, ref_id);

-- Đường khớp chính cho dữ liệu cũ (ký hiệu + số).
CREATE INDEX IF NOT EXISTS idx_misa_snapshot_no
  ON misa_invoice_snapshots (org_id, inv_series_norm, inv_no_norm);

-- Rổ "chỉ có trên MISA" và các rổ cần xử lý khác.
CREATE INDEX IF NOT EXISTS idx_misa_snapshot_status
  ON misa_invoice_snapshots (org_id, match_status, inv_date DESC);

CREATE INDEX IF NOT EXISTS idx_misa_snapshot_invoice
  ON misa_invoice_snapshots (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Khớp theo mã tra cứu (tầng 2).
CREATE INDEX IF NOT EXISTS idx_misa_snapshot_txn
  ON misa_invoice_snapshots (org_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE misa_invoice_snapshots
  DROP CONSTRAINT IF EXISTS misa_snapshot_match_status_check;
ALTER TABLE misa_invoice_snapshots
  ADD CONSTRAINT misa_snapshot_match_status_check CHECK (
    match_status IS NULL OR match_status IN (
      'matched',        -- khớp, tiền cũng khớp
      'amount_diff',    -- khớp được hoá đơn nhưng lệch tiền
      'misa_only',      -- CHỈ có trên MISA — hoá đơn ngoài sổ
      'cancelled',      -- đã huỷ bên MISA
      'replaced',       -- đã bị thay thế → hết hiệu lực
      'needs_review'    -- khớp bằng suy đoán, người phải xác nhận
    )
  );

ALTER TABLE misa_invoice_snapshots
  DROP CONSTRAINT IF EXISTS misa_snapshot_match_method_check;
ALTER TABLE misa_invoice_snapshots
  ADD CONSTRAINT misa_snapshot_match_method_check CHECK (
    match_method IS NULL OR match_method IN (
      'ref_id',          -- tầng 1 — chắc chắn
      'transaction_id',  -- tầng 2 — chắc chắn
      'inv_no',          -- tầng 3 — chắc chắn (khoá tự nhiên, đã đo là duy nhất)
      'inv_no_loose',    -- tầng 3b — khớp sau khi bỏ chữ số đầu ký hiệu: CẦN REVIEW
      'tax_date_amount', -- tầng 4 — suy đoán, chỉ nhận khi duy nhất: CẦN REVIEW
      'manual'           -- người chốt tay — vòng khớp KHÔNG được đụng vào
    )
  );

COMMENT ON TABLE misa_invoice_snapshots IS
  'Bản sao đọc-về của danh sách hoá đơn bên MISA, để đối soát hai chiều. '
  'KHÔNG phải nguồn sự thật của sổ.';
COMMENT ON COLUMN misa_invoice_snapshots.match_method IS
  'Cách khớp được. ''manual'' = người chốt tay, vòng khớp tự động phải bỏ qua.';
COMMENT ON COLUMN misa_invoice_snapshots.total_amount IS
  'CÓ THỂ ÂM (hoá đơn điều chỉnh giảm). Mọi phép so tiền phải xử dấu.';
COMMENT ON COLUMN misa_invoice_snapshots.inv_no IS
  'Số hoá đơn NGUYÊN VĂN MISA trả về (thường 8 chữ số, vd 00007140). '
  'Bản chuẩn hoá để khớp nằm ở inv_no_norm.';

-- --- RLS -------------------------------------------------------------
-- Đây là dữ liệu hoá đơn thuế: cùng mức nhạy cảm với bảng invoices, nên
-- cùng bộ vai trò. Không mở cho sales/warehouse/driver.
ALTER TABLE misa_invoice_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View misa snapshots" ON misa_invoice_snapshots;
CREATE POLICY "View misa snapshots" ON misa_invoice_snapshots FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));

DROP POLICY IF EXISTS "Manage misa snapshots" ON misa_invoice_snapshots;
CREATE POLICY "Manage misa snapshots" ON misa_invoice_snapshots FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON misa_invoice_snapshots TO authenticated;
