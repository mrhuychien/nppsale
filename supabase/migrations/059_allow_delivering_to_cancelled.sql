-- ====================================================================
-- Fix: handover RPC fails when failed orders are still in 'delivering'.
--
-- The check_order_status_transition trigger from mig 008 blocked
--   delivering → cancelled
-- which made confirm_driver_handover (mig 047) raise:
--   "Không thể chuyển từ đang giao sang cancelled"
-- whenever the user marked at least one order as giao thất bại on
-- the bàn-giao-lại screen.
--
-- The handover-back flow is exactly that semantic: driver returns,
-- order didn't deliver, status flips to 'cancelled' +
-- current_workflow_stage = 'delivery_failed'. Allow it.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  auto_threshold numeric := 20000000;
  manager_threshold numeric := 50000000;
BEGIN
  -- Only check when status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  caller_role := public.user_role();

  -- Validate transitions
  IF OLD.status = 'draft' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ nháp sang %', NEW.status;
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('picking', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đã duyệt sang %', NEW.status;
  END IF;
  IF OLD.status = 'picking' AND NEW.status NOT IN ('delivering', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đang lấy sang %', NEW.status;
  END IF;
  -- delivering → delivered (giao thành công) hoặc cancelled (giao thất bại,
  -- bàn giao lại). Cả hai đều hợp lệ trong nghiệp vụ.
  IF OLD.status = 'delivering' AND NEW.status NOT IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Không thể chuyển từ đang giao sang %', NEW.status;
  END IF;
  IF OLD.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Đơn đã hoàn tất/hủy, không thể đổi trạng thái';
  END IF;

  -- Approval check: draft → confirmed
  IF OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    IF OLD.total >= manager_threshold AND caller_role != 'owner' THEN
      RAISE EXCEPTION 'Đơn >= 50 triệu cần Chủ NPP duyệt';
    END IF;
    IF OLD.total >= auto_threshold AND caller_role NOT IN ('owner', 'manager') THEN
      RAISE EXCEPTION 'Đơn >= 20 triệu cần Quản lý hoặc Chủ NPP duyệt';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
