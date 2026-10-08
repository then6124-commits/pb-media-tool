# -*- coding: utf-8 -*-
"""Bộ mint dùng TIỆN ÍCH CHROME (kiểu SuperVeo) — cùng giao diện với bộ mint cũ.

`make_minter()` trong `flow_api` trả về vật thể có: start / stop / get /
set_cookies / set_project / request_reset / ready / dead / error. Lớp dưới đây
giữ nguyên bộ mặt đó nhưng ruột là `mint_ws.MayChuMint`: token do tiện ích đúc
trong Chrome THẬT của người dùng.

MÁY CHỦ LÀ DÙNG CHUNG, MỞ MỘT LẦN RỒI ĐỂ ĐÓ
-------------------------------------------
Bản đầu mở máy chủ lúc bắt đầu mẻ rồi đóng luôn nếu chờ 6 giây không thấy
tiện ích. Log thật cho thấy đúng cái bẫy đó:

    11:48:10  [minter] chờ tiện ích … cổng 3458
    11:48:16  [minter] tiện ích chưa nối — dùng cách cũ
    11:48:19  [mint-ws] tiện ích Chrome đã nối
    11:48:19  [mint-ws] tiện ích Chrome đã ngắt      ← chính tool đóng cổng

Service worker của Chrome ngủ khi rảnh, đánh thức rồi dò cổng nên chậm hơn 6
giây là thường. Vì vậy:

  · máy chủ mở MỘT lần cho cả tiến trình (`may_chu()`), không ai đóng giữa mẻ;
  · `khoi_dong_som()` gọi ngay lúc mở tool để tiện ích có thời gian nối;
  · nối muộn vẫn dùng được — `flow_api.MintKep` hỏi lại lúc cần token, chứ
    không chốt một lần lúc bắt đầu mẻ.
"""
from __future__ import annotations

import os
import threading
import time

try:
    from mint_ws import MayChuMint
except Exception:               # nạp lẻ (test) vẫn chạy
    MayChuMint = None

# ── máy chủ dùng chung cho cả tiến trình ──
_SRV = None
_KHOA = threading.Lock()


def may_chu(log=None):
    """Máy chủ mint dùng chung. Mở lần đầu, các lần sau trả lại cái đang chạy."""
    global _SRV
    with _KHOA:
        if _SRV is None:
            if MayChuMint is None:
                return None
            s = MayChuMint(log=log or (lambda m: None))
            if not s.start():
                return None
            _SRV = s
        elif log is not None:
            # Cho log chảy về cửa sổ đang chạy mẻ.
            _SRV.log = log
        return _SRV


def khoi_dong_som(log=None) -> bool:
    """Mở cổng ngay lúc tool khởi động để tiện ích kịp nối trước mẻ đầu."""
    if (os.environ.get("CAPCUT_MINT_EXT") or "1").strip() in ("0", "off", "no"):
        return False
    return may_chu(log) is not None


def da_noi() -> bool:
    """Tiện ích có đang nối không (dùng cho nhãn trạng thái ở giao diện)."""
    return bool(_SRV and _SRV.da_noi)


class MintTienIch:
    #: Chờ tiện ích nối vào bao lâu trước khi coi như chưa có (giây).
    #: Chỉ là thời gian chờ ở ĐẦU mẻ — nối muộn vẫn được dùng, xem MintKep.
    CHO_NOI = float(os.environ.get("CAPCUT_MINT_EXT_CHO") or 0.0)

    def __init__(self, logger=None, project_id: str = ""):
        self.log = logger or (lambda m: None)
        self.ready = threading.Event()
        self.dead = threading.Event()
        self.error = ""
        self._project_id = (project_id or "").strip()
        #: Phiên Google của tài khoản ĐANG CHẠY (12 ký tự băm SAPISID).
        #: Dùng để chọn đúng Chrome lúc đúc token — xem `MayChuMint.xin_token`.
        self._van_tay = ""
        self._email_dang = ""  # email TK dang chay (log lech phien)
        self._srv = may_chu(self.log)

    # ---------- vòng đời ----------
    def start(self) -> None:
        if self._srv is None:
            self.error = "không mở được cổng cho tiện ích"
            self.dead.set()
            return
        if self._srv.da_noi:                    # đã nối từ lúc mở tool
            self.ready.set()
            return
        # 29/09: mặc định CHO_NOI=0 — primary=ext khi Connected; sidecar backup.
        if self.CHO_NOI <= 0:
            self.error = "tiện ích chưa nối"
            return
        self.log(f"[minter] chờ tiện ích Cookie Flow nối vào cổng "
                 f"{self._srv.cong} (Chrome phải đang mở)…")
        t0 = time.time()
        while time.time() - t0 < self.CHO_NOI:
            if self._srv.da_noi:
                self.ready.set()
                self.log("[minter] tiện ích Chrome đã sẵn sàng — token sẽ đúc "
                         "trong trình duyệt THẬT của bạn.")
                return
            time.sleep(0.2)
        self.error = "tiện ích chưa nối"
        self.log("[minter] tiện ích Cookie Flow chưa nối — dùng sidecar hồ sơ "
                 "bền (kiểu SuperVeo). Ext nối muộn vẫn dùng được nếu "
                 "CAPCUT_MINT_PRIMARY=ext.")

    def stop(self) -> None:
        """KHÔNG đóng máy chủ dùng chung — tiện ích còn phải nối cho mẻ sau."""
        self.dead.set()
        try:
            self.bao_dung()
        except Exception:
            pass

    def bao_dung(self) -> None:
        """Bam Dung: huy waiter mint-ws, giu server."""
        srv = getattr(self, "_srv", None)
        fn = getattr(srv, "bao_dung", None) if srv is not None else None
        if callable(fn):
            fn()

    def tiep_tuc(self) -> None:
        """Me moi: cho mint-ws nhan token lai."""
        try:
            self.dead.clear()
        except Exception:
            pass
        srv = getattr(self, "_srv", None)
        fn = getattr(srv, "tiep_tuc", None) if srv is not None else None
        if callable(fn):
            fn()

    def available(self) -> bool:
        return bool(self._srv and self._srv.da_noi)

    @property
    def khac_phien(self) -> bool:
        """Lần xin token vừa rồi trượt vì KHÔNG Chrome nào đúng phiên."""
        return "không Chrome nào" in (getattr(self._srv, "loi_cuoi", "") or "")

    @property
    def ua(self) -> str:
        """UA của Chrome đang đúc token (rỗng nếu chưa nối)."""
        return getattr(self._srv, "ua", "") or ""

    # ---------- lấy token ----------
    def dat_van_tay(self, van_tay: str, email: str = "") -> None:
        """Chốt phiên Google của tài khoản đang chạy (băm SAPISID)."""
        self._van_tay = (van_tay or "").strip()
        if email:
            self._email_dang = (email or "").strip()

    def co_dung_chrome(self) -> bool:
        return bool(self._srv and self._srv.co_van_tay(self._van_tay))

    def get(self, n=1, timeout=90, action=None):
        """Trả list token (giống bộ mint cũ)."""
        if not self._srv:
            return []
        if self.dead.is_set():
            return []
        srv = self._srv
        if getattr(srv, "_phai_dung", lambda: False)():
            return []
        ra = []
        for _ in range(max(1, int(n))):
            if self.dead.is_set() or getattr(srv, "_phai_dung", lambda: False)():
                break
            _pid = (self._project_id or "").strip()
            if not _pid:
                import os as _os
                _pid = (_os.environ.get("CAPCUT_FLOW_PROJECT_ID") or "").strip()
            # Khong ep 5fd07654 — de trong neu TK/env chua co.
            t = self._srv.xin_token(action or "VIDEO_GENERATION",
                                    timeout=float(timeout),
                                    van_tay=self._van_tay,
                                    project_id=_pid,
                                    email=getattr(self, "_email_dang", "") or "")
            if not t:
                break
            ra.append(t)
        return ra

    # ---------- mấy hàm cho đủ bộ mặt ----------
    def set_cookies(self, cookie_str: str) -> None:
        """Không cần: tiện ích chạy trong Chrome đã đăng nhập sẵn."""

    def set_project(self, project_id=None) -> None:
        self._project_id = (project_id or "").strip()

    def set_profile_dir(self, path: str) -> None:
        """Không dùng — tiện ích nằm trong hồ sơ Chrome của chính người dùng."""

    def request_reset(self, reason: str = "") -> None:
        """Không có trình duyệt riêng để dựng lại; token sau vẫn là token mới."""

    def lay_wiz(self, project_id: str = "", timeout: float = 60.0) -> dict:
        """{at, fsid, bl, cookies} hỏi thẳng Chrome THẬT qua tiện ích."""
        if not self._srv:
            return {}
        return self._srv.xin_cookie(timeout=float(timeout)) or {}

    def nap_lai_tab(self) -> bool:
        """Dọn cookie grecaptcha + dựng lại tab Flow (SuperVeo: `reload_tab`)."""
        return bool(self._srv and self._srv.nap_lai_tab())

    def goi_rpc(self, rpcid: str, f_req: str, timeout: float = 120.0,
                project_id: str = "") -> tuple:
        """Gửi batchexecute NGAY TRONG tab Flow của Chrome thật."""
        if not self._srv:
            return 0, ""
        return self._srv.goi_rpc(rpcid, f_req, timeout=timeout,
                                 van_tay=self._van_tay,
                                 project_id=project_id or "")


class _CoDieuKien:
    """Giả `threading.Event` nhưng trạng thái TÍNH LẠI mỗi lần hỏi.

    `image_gen` chờ `minter.ready.wait(90)` và `token_pool` soát
    `ready.is_set()`. Bộ mint kép không có một cờ cố định — sẵn sàng hay chưa
    tuỳ lúc đó tiện ích có nối không. Gói thành vật thể này thì hai chỗ gọi cũ
    không phải sửa gì.
    """

    def __init__(self, ham):
        self._ham = ham

    def is_set(self) -> bool:
        try:
            return bool(self._ham())
        except Exception:
            return False

    def wait(self, timeout=None) -> bool:
        han = time.time() + (float(timeout) if timeout is not None else 1e9)
        while True:
            if self.is_set():
                return True
            if time.time() >= han:
                return False
            time.sleep(0.2)

    def set(self) -> None:          # người gọi cũ có chỗ gán — cho qua
        pass

    def clear(self) -> None:
        pass


class MintKep:
    """Hai bộ mint: Cookie Flow / Chrome thật (primary) + sidecar (backup).

    29/09 — USER: Force BOTH IMAGE và VIDEO qua Chrome / Cookie Flow;
    sidecar chỉ backup khi extension disconnected / timeout.

    · ``CAPCUT_MINT_PRIMARY=ext`` (mặc định): ưu tiên tiện ích khi Connected
      (VIDEO + IMAGE). Log: ``mint primary=ext (Chrome/Cookie Flow)``.
    · ``CAPCUT_MINT_PRIMARY=auto``: Connected → ext; chưa nối → sidecar.
    · ``CAPCUT_MINT_PRIMARY=sidecar``: ép sidecar trước (cũ SuperVeo).
    · ``CAPCUT_IMAGE_MINT_PRIMARY=ext`` (mặc định): IMAGE giữ cùng ưu tiên ext.
    · ``CAPCUT_MINT_EXT_TRY``: giây thử ext ngắn trước 1 lần sidecar (mặc định 15).
    · ``CAPCUT_MINT_EXT_CHO_XIN``: giây chờ ext lúc xin (mặc định 0 = không chờ).
    """

    def __init__(self, ext: MintTienIch, cu, logger=None, dat_ua=None):
        self.ext = ext
        self.cu = cu
        self.log = logger or (lambda m: None)
        #: Hàm chốt UA cho tầng HTTP (flow_api.set_runtime_ua). Xem `_chot_ua`.
        self._dat_ua = dat_ua
        self._ua_da_chot = ""
        self._cu_bat = False
        #: True = CHỈ đúc trong Chrome hồ sơ của tool, bỏ qua mọi tiện ích.
        #: Bật khi hồ sơ riêng của tài khoản đang tick đã đăng nhập sẵn —
        #: xem `flow_api.nap_mint_profile_tu_pool`.
        self.chi_sidecar = False
        self._dang_dung_ext = None          # None = chưa nói gì
        self.ready = _CoDieuKien(
            lambda: self.ext.available() or
            (self._cu_bat and self.cu.ready.is_set()))
        self.dead = _CoDieuKien(
            lambda: (not self.ext.available()) and self._cu_bat
            and self.cu.dead.is_set())

    def dat_chi_sidecar(self, bat: bool = True) -> None:
        """Bật/tắt chế độ CHỈ đúc trong Chrome hồ sơ của tool."""
        self.chi_sidecar = bool(bat)
        if bat:
            try:
                self._bat_cu()
            except Exception:
                pass

    # ---------- vòng đời ----------
    def _tao_cu_moi(self, cu_cu):
        """Thread da start+stop khong start() lai duoc — tao PuppeteerMinter moi, giu profile/cookie."""
        try:
            from puppeteer_minter import PuppeteerMinter as _PM
        except Exception:
            _PM = type(cu_cu)
        logger = getattr(cu_cu, "_log", None) or self.log
        visible = bool(getattr(cu_cu, "visible", False))
        pid = getattr(cu_cu, "_project_id", None) or ""
        moi = _PM(logger=logger, visible=visible, project_id=pid or None)
        for attr, setter in (
            ("_profile_dir", "set_profile_dir"),
            ("_alt_pids", "set_alt_projects"),
            ("_cookies", "set_cookies"),
            ("_skip_inject", "set_skip_inject"),
        ):
            val = getattr(cu_cu, attr, None)
            fn = getattr(moi, setter, None)
            if not callable(fn):
                continue
            try:
                if attr == "_skip_inject":
                    fn(bool(val))
                elif attr == "_alt_pids":
                    fn(list(val or []))
                elif val:
                    fn(val)
            except Exception:
                pass
        for attr in ("_cookies_jar", "_cookie_mismatch", "_mismatch_about_fail",
                     "_mismatch_stop_rebuild", "_mismatch_temp_once",
                     "_cookie_mismatch_count", "_profile_dir_orig"):
            if hasattr(cu_cu, attr):
                try:
                    setattr(moi, attr, getattr(cu_cu, attr))
                except Exception:
                    pass
        return moi

    def _bat_cu(self) -> None:
        """Mo sidecar 1 lan. Thread da start khong start() lai — song thi dung, chet thi thay instance moi."""
        cu = getattr(self, "cu", None)
        if cu is None:
            return
        try:
            if callable(getattr(cu, "is_alive", None)) and cu.is_alive():
                self._cu_bat = True
                return
        except Exception:
            pass
        # Chua bao gio start (ident is None) → start binh thuong
        try:
            never = getattr(cu, "ident", None) is None
        except Exception:
            never = True
        if never:
            self._cu_bat = True
            try:
                cu.start()
                return
            except RuntimeError as e:
                if "started once" not in str(e).lower():
                    self._cu_bat = False
                    raise
                # fall through: tao moi
            except Exception:
                self._cu_bat = False
                raise
        # Da start+stop → thay Thread moi (khong reuse)
        try:
            moi = self._tao_cu_moi(cu)
            self.cu = moi
            self._cu_bat = True
            moi.start()
            self.log("[minter] sidecar Thread moi (tranh threads can only be started once)")
        except Exception as e:
            self._cu_bat = False
            self.log(f"[minter] _bat_cu recreate fail: {e}")
            raise

    def _primary_sidecar(self, action=None) -> bool:
        """True = mint bằng sidecar; False = mint ext (Chrome/Cookie Flow).

        29/09: mặc định CAPCUT_MINT_PRIMARY=ext — VIDEO+IMAGE qua Cookie Flow
        khi Connected. Sidecar chỉ backup khi chưa Connected / ext fail.

        CookieMismatch /about / temp: luôn ưu tiên Cookie Flow nếu Connected
        (KHÔNG mở dual Chrome cùng profile).
        """
        # 01/10 — CAPCUT_MINT_ABOUT=1: nguoi dung CHON duc bang Chrome ho so
        # tam tren /about (kieu SuperVeo). Khong di qua tien ich nua, tru khi
        # ho con set han CAPCUT_MINT_PRIMARY=ext.
        if (os.environ.get("CAPCUT_MINT_ABOUT") or "").strip().lower() in (
                "1", "yes", "on", "true"):
            _p_ab = (os.environ.get("CAPCUT_MINT_PRIMARY") or "").strip().lower()
            if _p_ab not in ("ext", "extension", "tienich", "tiện",
                             "cookieflow", "cf"):
                if not getattr(self, "_da_bao_mint_about", False):
                    self._da_bao_mint_about = True
                    self.log("[minter] CAPCUT_MINT_ABOUT=1 — duc token tren "
                             "flow.google.com/about bang ho so TAM (kieu "
                             "SuperVeo), bo qua tien ich Cookie Flow.")
                return True

        # CHỈ dùng Chrome của tool: chốt trước mọi luật khác.
        #
        # Máy người dùng có nhiều Chrome cùng cắm tiện ích Cookie Flow (Chrome
        # thật + 3 trình duyệt GPM Login = 8 client, đo 30/09). Tool không có
        # cách nào biết client nào là phiên nào, nên cứ chọn nhầm rồi từ chối
        # đúc. Hồ sơ riêng của tài khoản đã đăng nhập sẵn thì đúc ngay trong đó
        # là chắc chắn đúng phiên — khỏi phụ thuộc người dùng mở Chrome nào.
        if getattr(self, "chi_sidecar", False):
            # 30/09: Cookie Flow Connected + primary=ext/auto → dung ext
            # (tranh false fallback sidecar + threads can only be started once).
            _p_cs = (os.environ.get("CAPCUT_MINT_PRIMARY") or "ext").strip().lower()
            _img_cs = (os.environ.get("CAPCUT_IMAGE_MINT_PRIMARY") or "ext").strip().lower()
            _act_cs = (action or "").strip().upper()
            _ext_ok = False
            try:
                _ext_ok = bool(self.ext.available())
            except Exception:
                _ext_ok = False
            _want_ext_cs = _p_cs in (
                "ext", "extension", "tienich", "tiện", "cookieflow", "cf",
                "auto", "ext-auto", "ext_auto")
            if _act_cs in ("IMAGE", "IMAGE_GENERATION") and _img_cs in (
                    "ext", "extension", "tienich", "tiện", "cookieflow", "cf"):
                _want_ext_cs = True
            if _want_ext_cs and _ext_ok:
                if not getattr(self, "_da_bao_chi_sidecar_nhuong_ext", False):
                    self._da_bao_chi_sidecar_nhuong_ext = True
                    self.log(
                        "[minter] chi_sidecar nhuong Cookie Flow Connected "
                        "(CAPCUT_MINT_PRIMARY=ext) — mint qua ext.")
                return False
            if not getattr(self, "_da_bao_chi_sidecar", False):
                self._da_bao_chi_sidecar = True
                self.log("[minter] CHỈ dùng Chrome hồ sơ của tool (đã đăng "
                         "nhập sẵn) — bỏ qua mọi tiện ích Cookie Flow từ "
                         "Chrome khác. Tắt: CAPCUT_CHI_SIDECAR=0")
            return True
        # CookieMismatch / /about hard fail → ép ext ngay khi Connected
        _mm = bool(getattr(self.cu, "_cookie_mismatch", False)
                   or getattr(self.cu, "_mismatch_about_fail", False)
                   or getattr(self.cu, "_mismatch_stop_rebuild", False))
        if _mm and self.ext.available():
            if not getattr(self, "_da_bao_mismatch_ext", False):
                self._da_bao_mismatch_ext = True
                self.log(
                    "[minter] CookieMismatch(/about) — chuyen "
                    "CAPCUT_MINT_PRIMARY=ext auto (Cookie Flow Connected).")
                try:
                    if not self.cu.dead.is_set():
                        self.cu.stop()
                except Exception:
                    pass
            return False
        # IMAGE override (CAPCUT_IMAGE_MINT_PRIMARY; mặc định ext — cùng VIDEO)
        _act = (action or "").strip().upper()
        if _act in ("IMAGE", "IMAGE_GENERATION"):
            img_p = (os.environ.get("CAPCUT_IMAGE_MINT_PRIMARY") or "ext").strip().lower()
            if img_p in ("ext", "extension", "tienich", "tiện", "cookieflow", "cf"):
                if self.ext.available():
                    if not getattr(self, "_da_bao_img_ext", False):
                        self._da_bao_img_ext = True
                        self.log(
                            "[minter] IMAGE mint primary=ext (Chrome/Cookie Flow) "
                            "— CAPCUT_IMAGE_MINT_PRIMARY=ext Connected.")
                    return False
            elif img_p in ("sidecar", "puppeteer", "chrome"):
                pass  # ép IMAGE sidecar — fall through global
        # VIDEO + global: mặc định ext (29/09 USER CHOICE)
        p = (os.environ.get("CAPCUT_MINT_PRIMARY") or "ext").strip().lower()
        if p in ("auto", "ext-auto", "ext_auto"):
            # auto → ext khi Cookie Flow Connected; chưa nối → sidecar
            if self.ext.available():
                if not getattr(self, "_da_bao_auto_ext", False):
                    self._da_bao_auto_ext = True
                    self.log(
                        "[minter] mint primary=ext (Chrome/Cookie Flow) "
                        "(CAPCUT_MINT_PRIMARY=auto → Connected).")
                return False
            return True
        if p in ("ext", "extension", "tienich", "tiện", "cookieflow", "cf"):
            return False
        return True  # sidecar / puppeteer / chrome / khác

    def _mismatch_ext_lock(self) -> bool:
        """Sau CookieMismatch/temp/about — CẤM fallback sidecar Cookie_10."""
        cu = getattr(self, "cu", None)
        if cu is None:
            return bool(getattr(self, "_da_bao_mismatch_ext", False))
        return bool(
            getattr(self, "_da_bao_mismatch_ext", False)
            or getattr(cu, "_cookie_mismatch", False)
            or getattr(cu, "_mismatch_about_fail", False)
            or getattr(cu, "_mismatch_stop_rebuild", False)
            or getattr(cu, "_mismatch_temp_once", False)
            or (callable(getattr(cu, "_mismatch_lock", None)) and cu._mismatch_lock())
        )

    def start(self) -> None:
        # 29/09: VIDEO+IMAGE — Cookie Flow Connected + primary=ext/auto
        # → SKIP sidecar warmup/rebuild (tránh dual Chrome cùng profile).
        _p = (os.environ.get("CAPCUT_MINT_PRIMARY") or "ext").strip().lower()
        _img_p = (os.environ.get("CAPCUT_IMAGE_MINT_PRIMARY") or "ext").strip().lower()
        _mode = (os.environ.get("CAPCUT_BATCH_MODE") or "").strip().lower()
        _ext_words = ("ext", "extension", "tienich", "tiện", "cookieflow", "cf",
                      "auto", "ext-auto", "ext_auto")
        _want_ext = _p in _ext_words
        if _mode in ("t2i", "image") and _img_p in (
                "ext", "extension", "tienich", "tiện", "cookieflow", "cf"):
            _want_ext = True
        if _want_ext and self.ext.available():
            if not getattr(self, "_da_bao_skip_sc", False):
                self._da_bao_skip_sc = True
                self.log(
                    "[minter] mint primary=ext (Chrome/Cookie Flow) — "
                    "SKIP sidecar warmup/rebuild (tranh dual Chrome).")
            # Connected + primary=ext thang chi_sidecar (gan tu profile) —
            # tranh get() ep sidecar roi _bat_cu start() lai Thread chet.
            if getattr(self, "chi_sidecar", False):
                self.chi_sidecar = False
                self.log(
                    "[minter] Cookie Flow Connected + primary=ext — "
                    "tat chi_sidecar, mint qua ext.")
            try:
                if self._cu_bat:
                    try:
                        if not self.cu.dead.is_set():
                            self.cu.stop()
                    except Exception:
                        pass
                    self._cu_bat = False
            except Exception:
                pass
            return
        # Primary sidecar (env=sidecar hoặc chưa Connected): dựng hồ sơ bền.
        if self._primary_sidecar():
            self.log("[minter] fallback sidecar — mở hồ sơ bền "
                     "(Cookie Flow chua Connected / CAPCUT_MINT_PRIMARY=sidecar).")
            self._bat_cu()
            return
        if self.ext.available():
            self.log("[minter] mint primary=ext (Chrome/Cookie Flow) — "
                     "CHUA can mo Chrome tu dong.")
            return
        # Chưa Connected + primary=ext → 1 lần sidecar backup
        self.log("[minter] fallback sidecar — Cookie Flow chua Connected.")
        self._bat_cu()

    def stop(self) -> None:
        try:
            self.bao_dung()
        except Exception:
            pass
        try:
            self.ext.stop()
        finally:
            if self._cu_bat:
                self.cu.stop()

    def bao_dung(self) -> None:
        """Bam Dung: huy waiter mint (ext + cu), khong tat cong dung chung."""
        for obj in (getattr(self, "ext", None), getattr(self, "cu", None)):
            if obj is None:
                continue
            fn = getattr(obj, "bao_dung", None)
            if callable(fn):
                try:
                    fn()
                except Exception:
                    pass
            else:
                # puppeteer: dat dead neu co
                d = getattr(obj, "dead", None)
                if d is not None and hasattr(d, "set"):
                    try:
                        d.set()
                    except Exception:
                        pass

    def tiep_tuc(self) -> None:
        for obj in (getattr(self, "ext", None), getattr(self, "cu", None)):
            if obj is None:
                continue
            fn = getattr(obj, "tiep_tuc", None)
            if callable(fn):
                try:
                    fn()
                except Exception:
                    pass
            d = getattr(obj, "dead", None)
            if d is not None and hasattr(d, "clear"):
                try:
                    d.clear()
                except Exception:
                    pass

    @property
    def error(self):
        return getattr(self.cu, "error", None) or self.ext.error

    @error.setter
    def error(self, v):
        try:
            self.cu.error = v
        except Exception:
            pass

    @property
    def khac_phien(self) -> bool:
        """Chuyển tiếp: lần mint vừa rồi trượt vì Chrome khác phiên."""
        return bool(getattr(self.ext, "khac_phien", False))

    def _ua_cua_sidecar(self) -> str:
        """UA của Chrome sidecar — dò qua cả tầng bọc.

        `self.cu` có thể là `TokenPool`, nó giữ minter thật ở `.m`
        (token_pool.py:76). Đọc thẳng `self.cu.ua` sẽ ra rỗng.
        """
        _xem, _thay = [getattr(self, "cu", None)], set()
        while _xem:
            _o = _xem.pop(0)
            if _o is None or id(_o) in _thay:
                continue
            _thay.add(id(_o))
            _u = str(getattr(_o, "ua", "") or "").strip()
            if _u:
                return _u
            for _at in ("m", "minter", "cu", "_m"):
                try:
                    _xem.append(getattr(_o, _at, None))
                except Exception:
                    pass
        return ""

    def _chot_ua(self) -> None:
        """Bắt tầng HTTP khai ĐÚNG UA của Chrome vừa đúc token.

        Soi Veo3Studio 1.8.1 (`veo3HttpClient.js`) thì đây là điều kiện sống
        còn, họ viết thẳng trong mã:

            "The reCAPTCHA token is minted INSIDE that real Chrome (via the
             extension); forcing the submit sec-ch-ua + UA to the same major
             keeps mint-vs-submit consistent — a mismatch scores the submit as
             bot → 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY."

        Tức là token đúc trong Chrome 141 mà nộp với UA Chrome 131 thì Google
        coi là bot, dù token hoàn toàn thật. `set_runtime_ua` còn chọn lại vân
        tay TLS (curl_cffi impersonate) cho khớp bản Chrome đó.
        """
        if not callable(self._dat_ua):
            return
        # 01/10 — UA phải là của trình duyệt THẬT SỰ đang đúc token. Đi
        # đường sidecar thì lấy UA của Chrome sidecar, không phải UA của
        # Chrome có tiện ích (xem ghi chú đầu bản vá).
        ua = ""
        try:
            if self._primary_sidecar():
                ua = self._ua_cua_sidecar()
        except Exception:
            ua = ""
        if not ua:
            ua = self.ext.ua
        if not ua or ua == self._ua_da_chot:
            return
        try:
            if self._dat_ua(ua, log=self.log, uu_tien=True):
                self._ua_da_chot = ua
        except Exception as e:
            self.log(f"[minter] không chốt được UA: {str(e)[:80]}")

    #: Lần xin token ĐẦU TIÊN của mẻ: chờ tiện ích nối thêm bấy nhiêu giây
    #: trước khi chịu rơi về Chrome tự động (giây).
    # 28/09 — NÂNG 15s → 120s, và nói rõ phải làm gì trong lúc chờ.
    #
    # Phép đo cùng ngày, hai mẻ liền nhau, cùng tài khoản, cùng máy:
    #   • token của TIỆN ÍCH (Chrome thật)  → video dựng xong (08:08–08:09)
    #   • token của Chrome TỰ ĐỘNG          → 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY
    #     ngay cảnh đầu, DÙ token dài bình thường và đúc ngay trên trang
    #     flow.google.com/project/<pid> (17:48:31 «grecaptcha OK», 17:48:46 403).
    #
    # Nên độ dài token KHÔNG phải thứ quyết định — TRÌNH DUYỆT mới là. Chrome
    # do puppeteer điều khiển bị reCAPTCHA chấm rớt bất kể đúc ở trang nào.
    # SuperVeo cũng không đúc bằng Chrome ẩn danh: hồ sơ `_sidecar` của nó đã
    # đăng nhập Google sẵn (có SAPISID trong jar).
    #
    # Vậy rơi về Chrome tự động = chắc chắn hỏng mẻ. Chờ người dùng mở tab Flow
    # / nạp lại tiện ích rẻ hơn nhiều. Muốn về mốc cũ: CAPCUT_MINT_EXT_CHO_XIN=15
    CHO_NOI_LUC_XIN = float(os.environ.get("CAPCUT_MINT_EXT_CHO_XIN") or 0.0)

    def _cho_ext_noi_lan_dau(self) -> None:
        """Chờ tiện ích nối ở lần xin token đầu mẻ.

        Vì sao cần: `start()` chỉ chờ `CHO_NOI` giây lúc khởi động, mà tiện ích
        thường nối MUỘN HƠN vài giây (người dùng còn phải mở tab Flow). Log thật
        27/09: start() bỏ cuộc lúc 10:41:48, tiện ích nối lúc 10:41:54 — nhưng
        token cho cảnh 1 đã xin lúc 10:41:51 bằng Chrome tự động, mất 9,3 giây
        rồi ăn 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY và mẻ chết với đúng 1 cảnh.

        Chờ thêm mươi giây rẻ hơn hẳn: token Chrome tự động gần như luôn bị
        Google chấm thấp (xem ghi chú ở `get()`), nên rơi về đó là hỏng cảnh
        chứ không phải "chậm hơn một chút".

        Chỉ chờ MỘT LẦN cho cả mẻ — không cài tiện ích thì các cảnh sau chạy
        thẳng, không phải đợi lại.
        """
        if getattr(self, "_da_cho_ext", False):
            return
        self._da_cho_ext = True
        srv = getattr(self.ext, "_srv", None)
        if srv is None or self.CHO_NOI_LUC_XIN <= 0:
            return
        _cong = ""
        try:
            _cong = str(getattr(srv, "cong", "") or getattr(srv, "port", "") or "")
        except Exception:
            _cong = ""
        self.log(f"[minter] ⏸ CHỜ TIỆN ÍCH Cookie Flow "
                 f"(tối đa {self.CHO_NOI_LUC_XIN:g}s)"
                 + (f" — cổng {_cong}" if _cong else "") + ".")
        self.log("   Token của Chrome tự động bị Google chặn 100% (đo 28/09), "
                 "nên chờ vẫn hơn chạy hỏng. Làm 2 việc này là xong:")
        self.log("   1) Mở 1 tab https://flow.google.com/project/<pid TK> "
                 "trong Chrome THẬT (đóng tab project khác).")
        self.log("   2) Vừa khởi động lại tool thì tiện ích còn bám cổng cũ — "
                 "vào chrome://extensions bấm Reload «Cookie Flow», "
                 "đợi Connected.")
        t0 = time.time()
        _nhac = t0
        while time.time() - t0 < self.CHO_NOI_LUC_XIN:
            if time.time() - _nhac >= 30:
                _nhac = time.time()
                self.log(f"[minter] … vẫn chờ tiện ích "
                         f"({time.time() - t0:.0f}s / "
                         f"{self.CHO_NOI_LUC_XIN:g}s)")
            if self.ext.available():
                self.log(f"[minter] tiện ích Chrome đã nối sau "
                         f"{time.time() - t0:.1f}s — dùng trình duyệt THẬT.")
                try:
                    self.ext.ready.set()
                except Exception:
                    pass
                return
            time.sleep(0.3)
        self.log("[minter] ⚠ HẾT GIỜ CHỜ TIỆN ÍCH — đúc bằng Chrome tự động. "
                 "Đường này đo được là Google chặn 100% (403 "
                 "PUBLIC_ERROR_UNUSUAL_ACTIVITY), nhiều khả năng mẻ này hỏng.")

    # ---------- lấy token ----------
    def so_cookie_flow_clients(self) -> int:
        """So client Cookie Flow Connected (0 = chua noi)."""
        try:
            srv = getattr(self.ext, "_srv", None)
            if srv is None:
                return 0
            fn = getattr(srv, "so_tien_ich", None)
            if callable(fn):
                return int(fn() or 0)
            return len(getattr(srv, "_clis", []) or [])
        except Exception:
            return 0

    def get(self, n=1, timeout=90, action=None):
        # ── Primary sidecar (mặc định) — không chờ Cookie Flow ──
        if self._primary_sidecar(action=action):
            self._bat_cu()
            if self._dang_dung_ext is not False:
                self._dang_dung_ext = False
                self.log("[minter] fallback sidecar — đúc token bằng "
                         "puppeteer-real-browser + Cookie_*/…_sidecar "
                         "(Cookie Flow chua Connected / primary=sidecar).")
            # Neu da CookieMismatch/about — fallback Cookie Flow TRUOC khi cho ready
            # (tranh treo 60s trong luc sidecar rebuild temp /about).
            _mm_now = bool(getattr(self.cu, "_cookie_mismatch", False)
                           or getattr(self.cu, "_mismatch_about_fail", False)
                           or getattr(self.cu, "_mismatch_stop_rebuild", False))
            if _mm_now and self.ext.available() and not self.chi_sidecar:
                self._chot_ua()
                self._dang_dung_ext = True
                try:
                    if not self.cu.dead.is_set():
                        self.cu.stop()
                except Exception:
                    pass
                self.log("[minter] sidecar CookieMismatch/about — fallback Cookie Flow "
                         "(CAPCUT_MINT_PRIMARY=ext auto) NGAY.")
                return self._loc_token_dai(
                    self.ext.get(n=n, timeout=timeout, action=action) or [])
            try:
                self.cu.ready.wait(timeout=60)
            except Exception:
                pass
            # Neu sidecar chet vi CookieMismatch trong luc cho ready
            _mm_now = bool(getattr(self.cu, "_cookie_mismatch", False)
                           or getattr(self.cu, "_mismatch_about_fail", False)
                           or getattr(self.cu, "_mismatch_stop_rebuild", False))
            if _mm_now and self.ext.available() and not self.chi_sidecar:
                self._chot_ua()
                self._dang_dung_ext = True
                try:
                    if not self.cu.dead.is_set():
                        self.cu.stop()
                except Exception:
                    pass
                self.log("[minter] sidecar CookieMismatch/about — fallback Cookie Flow "
                         "(CAPCUT_MINT_PRIMARY=ext auto).")
                return self._loc_token_dai(
                    self.ext.get(n=n, timeout=timeout, action=action) or [])
            ra = self.cu.get(n=n, timeout=timeout, action=action)
            ra = self._loc_token_dai(ra)
            if ra:
                return ra
            # Fallback: tiện ích khi ĐÃ Connected — ưu tiên nếu CookieMismatch
            if self.ext.available() and not self.chi_sidecar:
                self._chot_ua()
                _why = ("CookieMismatch/about — "
                        if _mm_now or getattr(self.cu, "_cookie_mismatch", False)
                        else "sidecar trống token — ")
                self.log(f"[minter] {_why}fallback Cookie Flow (đã Connected).")
                return self._loc_token_dai(
                    self.ext.get(n=n, timeout=timeout, action=action) or [])
            return []

        # ── Primary=ext (cũ): chờ CHO_NOI_LUC_XIN rồi mới sidecar ──
        if self.chi_sidecar or not self.ext.available():
            self._cho_ext_noi_lan_dau()
        if self.ext.available() and not self.chi_sidecar:
            self._chot_ua()
            if self._dang_dung_ext is not True:
                self._dang_dung_ext = True
                self.log("[minter] mint primary=ext (Chrome/Cookie Flow) — "
                         "duc token trong trinh duyet THAT.")
            # Short try ext (CAPCUT_MINT_EXT_TRY, mặc định 15s) rồi 1 sidecar
            # backup — trừ khi CookieMismatch-lock (cấm dual Chrome).
            try:
                _ext_try = float(os.environ.get("CAPCUT_MINT_EXT_TRY") or "15")
            except Exception:
                _ext_try = 15.0
            _ext_to = min(float(timeout or 90), max(3.0, _ext_try))
            _ext_tries = 2 if self._mismatch_ext_lock() else 1
            ra = []
            for _et in range(_ext_tries):
                ra = self._loc_token_dai(
                    self.ext.get(n=n, timeout=_ext_to, action=action))
                if ra:
                    return ra
                if getattr(self.ext, "khac_phien", False):
                    break
                if self._mismatch_ext_lock() and _et + 1 < _ext_tries:
                    _ncli = 0
                    try:
                        _ncli = len(getattr(
                            getattr(self.ext, "_srv", None), "_clis", []) or [])
                    except Exception:
                        _ncli = 0
                    self.log(
                        "[minter] ⛔ tiện ích hết giờ/không đúc — "
                        f"thu lai ({_et + 2}/{_ext_tries}). "
                        + (f"Dang co {_ncli} Cookie Flow Connected — "
                           if _ncli > 1 else "")
                        + "CHI GIU 1 tab Flow project + 1 Connected "
                        "(dong tab/extension thua), roi doi.")
                    time.sleep(2.0)
            if getattr(self.ext, "khac_phien", False):
                now = time.time()
                if now - getattr(self, "_nhac_khac_phien", 0) > 20:
                    self._nhac_khac_phien = now
                    self.log("[minter] Chrome mo != phien TK dang chay (selected=" + (getattr(self, "_email_dang", "") or "?") + ") — TU CHOI mint; mo dung profile email do / Reload Cookie Flow Connected.")
                return []
            if self._mismatch_ext_lock():
                _ncli = 0
                try:
                    _ncli = len(getattr(
                        getattr(self.ext, "_srv", None), "_clis", []) or [])
                except Exception:
                    _ncli = 0
                self.log(
                    "[minter] ⛔ CookieMismatch → CAPCUT_MINT_PRIMARY=ext: "
                    "tiện ích không đúc được — KHONG fallback sidecar "
                    "Cookie_10 (van lech). "
                    + (f"Hien {_ncli} client Connected. " if _ncli else "")
                    + "Dong het tab Flow thua → chi 1 Connected, Reload "
                    "Cookie Flow, chay lai.")
                return []
            self.log("[minter] fallback sidecar — tien ich timeout/fail "
                     f"(da thu {_ext_to:g}s); 1 lan sidecar.")
        elif self._dang_dung_ext is not False:
            self._dang_dung_ext = False
            if self._mismatch_ext_lock():
                self.log(
                    "[minter] ⛔ CookieMismatch/temp: tiện ích chưa nối — "
                    "KHONG mo sidecar Cookie_10. Mo 1 tab Flow + Reload "
                    "Cookie Flow (doi Connected).")
                return []
            self.log("[minter] fallback sidecar — Cookie Flow chua Connected.")
        if self._mismatch_ext_lock():
            self.log(
                "[minter] ⛔ mismatch-lock: bo sidecar Cookie_10 "
                "(dung Cookie Flow ext).")
            return []
        self._bat_cu()
        try:
            self.cu.ready.wait(timeout=60)
        except Exception:
            pass
        return self._loc_token_dai(
            self.cu.get(n=n, timeout=timeout, action=action))

    def _loc_token_dai(self, toks):
        """Bo token < ~1500 ky tu — khong gui IMAGE voi token cut (538=403)."""
        if not toks:
            return []
        try:
            from puppeteer_minter import TOKEN_DAI_BINH_THUONG as _MIN
        except Exception:
            _MIN = 1500
        ok = [t for t in toks if t and len(t) >= int(_MIN)]
        if toks and not ok:
            _dai = max(len(t or "") for t in toks)
            self.log(
                f"[minter] ⛔ HARD-STOP: BO token cut {_dai} ky tu (< {_MIN}) — "
                "KHONG gui IMAGE/VIDEO (tranh 403 UNUSUAL_ACTIVITY). "
                "Can mint flow.google.com + Cookie_10 da login.")
        return ok

    def prime(self, action=None):
        fn = getattr(self.cu, "prime", None)
        if not callable(fn):
            return None
        if self._primary_sidecar(action=action) or not self.ext.available():
            self._bat_cu()
            return fn(action)

    # ---------- chuyển tiếp ----------
    def set_cookies(self, cookie_str: str) -> None:
        self._goi_cu("set_cookies", cookie_str)

    def set_skip_inject(self, skip: bool = True) -> None:
        self._goi_cu("set_skip_inject", skip)

    def set_project(self, project_id=None) -> None:
        self.ext.set_project(project_id)
        self._goi_cu("set_project", project_id)

    def available(self) -> bool:
        """Tiện ích Cookie Flow đang nối (cho need_rpc / goi_rpc).

        Chốt lệch phiên (CAPCUT_CHAY_KHI_LECH) tự đọc hồ sơ sidecar riêng
        trong image_gen — không gộp vào đây kẻo Lite tưởng ext Connected.
        """
        fn = getattr(self.ext, "available", None)
        return bool(callable(fn) and fn())

    def sidecar_ready(self) -> bool:
        """Sidecar hồ sơ bền đã start + ready (đường SuperVeo)."""
        try:
            return bool(self._cu_bat and self.cu.ready.is_set())
        except Exception:
            return False

    def goi_rpc(self, rpcid: str, f_req: str, timeout: float = 120.0,
                project_id: str = "") -> tuple:
        """Chuyển tiếp: nhờ tiện ích gửi RPC trong trang."""
        fn = getattr(self.ext, "goi_rpc", None)
        if not callable(fn):
            return 0, ""
        try:
            return fn(rpcid, f_req, timeout=timeout, project_id=project_id or "")
        except TypeError:
            return fn(rpcid, f_req, timeout=timeout)

    def dat_van_tay(self, van_tay: str, email: str = "") -> None:
        """Chuyển tiếp xuống bộ mint tiện ích (chọn đúng Chrome)."""
        fn = getattr(self.ext, "dat_van_tay", None)
        if callable(fn):
            try:
                fn(van_tay, email=email)
            except TypeError:
                fn(van_tay)

    def co_dung_chrome(self) -> bool:
        fn = getattr(self.ext, "co_dung_chrome", None)
        return bool(callable(fn) and fn())

    def set_profile_dir(self, path: str) -> None:
        self._goi_cu("set_profile_dir", path)

    def set_alt_projects(self, pids) -> None:
        self._goi_cu("set_alt_projects", pids)

    def request_reset(self, reason: str = "", hard=None) -> None:
        """Token bị từ chối liên tiếp.

        Tiện ích đang nối thì KHÔNG dựng lại Chrome tự động (vô ích, token
        không lấy từ đó) — nhờ tiện ích dọn cookie grecaptcha rồi nạp lại tab
        Flow, đúng việc SuperVeo làm.

        Lệch phiên (Chrome mở ≠ tài khoản đang chạy): đừng nạp lại tab —
        chỉ spam log «Dừng cảnh này» rồi vẫn trống token (log 27/09).
        """
        if getattr(self.ext, "khac_phien", False):
            return
        # mismatch4: sau CookieMismatch — CẤM hard-reset sidecar Cookie_10
        if self._mismatch_ext_lock() and hard is True:
            try:
                self.log(
                    f"[minter] BO request_reset(hard) ({reason or ''}) — "
                    "CookieMismatch/temp: KHONG mo lai Cookie_10; "
                    "nap lai tab Cookie Flow neu dang Connected.")
            except Exception:
                pass
            if self.ext.available():
                try:
                    self.ext.nap_lai_tab()
                except Exception:
                    pass
            return
        if self.ext.available() and hard is not True:
            self.ext.nap_lai_tab()
            return
        fn = getattr(self.cu, "request_reset", None)
        if callable(fn):
            try:
                fn(reason, hard=hard)
            except TypeError:
                fn(reason)

    def bo_token(self, why: str = "403") -> None:
        self._goi_cu("bo_token", why)

    def lay_wiz(self, project_id: str = "", timeout: float = 60.0) -> dict:
        """Ưu tiên hỏi Chrome THẬT — khỏi phải dựng Chrome điều khiển chỉ để
        lấy `at` + cookie."""
        if self.ext.available():
            d = self.ext.lay_wiz(project_id=project_id, timeout=timeout)
            if d.get("cookies") or d.get("at"):
                return d
            self.log("[minter] tiện ích không trả được cookie — thử Chrome tự động")
        fn = getattr(self.cu, "lay_wiz", None)
        if not callable(fn):
            return {}
        self._bat_cu()
        return fn(project_id=project_id, timeout=timeout)

    def fetch_api(self, url: str, headers=None, body=None, timeout: float = 90.0):
        """POST aisandbox trong Chrome mint (sidecar) khi đã sẵn.

        29/09: primary=ext + Cookie Flow Connected → KHÔNG mở sidecar chỉ để
        fetch (tránh dual Chrome cùng profile). Khi đó trả skip →
        `_post_create` dùng Node/HTTP với token Cookie Flow.
        Nếu sidecar đã ready (fallback) → fetch trong context đó.
        """
        _sc_ready = False
        try:
            _sc_ready = bool(self._cu_bat and self.cu.ready.is_set())
        except Exception:
            _sc_ready = False
        if not _sc_ready:
            # Đừng mở dual Chrome khi đang mint qua Cookie Flow
            if self.ext.available() and not self._primary_sidecar():
                return {
                    "ok": False, "status": 0, "body": "",
                    "error": (
                        "skip: mint primary=ext (Chrome/Cookie Flow) — "
                        "khong mo dual Chrome sidecar cho fetch; dung Node/HTTP"
                    ),
                }
            if self._mismatch_ext_lock():
                return {
                    "ok": False, "status": 0, "body": "",
                    "error": (
                        "skip: CookieMismatch-lock — khong mo sidecar fetch; "
                        "dung Cookie Flow / Node"
                    ),
                }
            self._bat_cu()
        fn = getattr(self.cu, "fetch_api", None)
        if not callable(fn):
            return {
                "ok": False, "status": 0, "body": "",
                "error": (
                    f"MintKep.cu={type(self.cu).__name__} thiếu fetch_api "
                    "(cần PuppeteerMinter/mint_sidecar — không phải Playwright)"
                ),
            }
        try:
            self.cu.ready.wait(timeout=min(30.0, float(timeout)))
        except Exception:
            pass
        return fn(url, headers=headers, body=body, timeout=timeout)

    def _goi_cu(self, ten: str, *a):
        fn = getattr(self.cu, ten, None)
        if callable(fn):
            try:
                return fn(*a)
            except Exception:
                return None


# ══════════════════════════════════════════════════════════════════════
#  Chép tiện ích ra CHỖ CỐ ĐỊNH
# ══════════════════════════════════════════════════════════════════════
#  Chrome nạp tiện ích theo ĐƯỜNG DẪN. Trỏ thẳng vào thư mục tool thì:
#    · đổi tên / dời / cài lại tool là Chrome báo «tiện ích đã bị xoá»
#    · thư mục tool có cả chục file .bak_*, nạp vào Chrome vừa bẩn vừa dễ nhầm
#  Còn đặt trong thư mục cài của app khác (SuperVeo) thì bản cập nhật của app
#  đó dọn sạch — mất tiện ích giữa chừng mà không hiểu vì sao.
#
#  Nên: một chỗ của riêng tool, %LOCALAPPDATA%\PB_MEDIA_SRT\TIEN_ICH_COOKIE_FLOW.
#  Mỗi lần mở tool tự chép đè khi có bản mới, nên người dùng trỏ Chrome MỘT lần
#  rồi thôi — cập nhật sau chỉ cần bấm «Tải lại» ở chrome://extensions.

def thu_muc_tien_ich_goc() -> str:
    """Thư mục tiện ích đi kèm tool (nguồn)."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "TIEN_ICH_COOKIE_FLOW")


def thu_muc_tien_ich() -> str:
    """Chỗ cố định để trỏ Chrome vào."""
    goc = (os.environ.get("LOCALAPPDATA")
           or os.path.expanduser("~"))
    return os.path.join(goc, "PB_MEDIA_SRT", "TIEN_ICH_COOKIE_FLOW")


def _ban_tien_ich(thu_muc: str) -> str:
    try:
        import json
        with open(os.path.join(thu_muc, "manifest.json"), encoding="utf-8") as f:
            return str(json.load(f).get("version") or "")
    except Exception:
        return ""


def dong_bo_tien_ich(log=None) -> str:
    """Chép tiện ích ra chỗ cố định nếu bản ở đó cũ hơn. Trả về đường dẫn đó.

    Chỉ chép file thật của tiện ích — bỏ mọi `.bak_*` và rác lập trình.
    """
    log = log or (lambda m: None)
    goc, dich = thu_muc_tien_ich_goc(), thu_muc_tien_ich()
    if not os.path.isdir(goc):
        return dich if os.path.isdir(dich) else ""
    ban_goc, ban_dich = _ban_tien_ich(goc), _ban_tien_ich(dich)
    if ban_goc and ban_goc == ban_dich:
        return dich
    import shutil
    try:
        os.makedirs(dich, exist_ok=True)
        n = 0
        for ten in os.listdir(goc):
            if ".bak" in ten or ten.endswith(("~", ".pyc")):
                continue
            nguon = os.path.join(goc, ten)
            if not os.path.isfile(nguon):
                continue
            shutil.copy2(nguon, os.path.join(dich, ten))
            n += 1
        # File thừa của bản cũ (đổi tên giữa các bản) thì dọn đi.
        for ten in os.listdir(dich):
            if not os.path.isfile(os.path.join(goc, ten)):
                try:
                    os.remove(os.path.join(dich, ten))
                except Exception:
                    pass
        log(f"[tiện ích] đã cập nhật bản {ban_goc or '?'} tại {dich} "
            f"({n} file) — vào chrome://extensions bấm «Tải lại».")
    except Exception as e:
        log(f"[tiện ích] không chép được ra chỗ cố định: {str(e)[:80]}")
        return dich if os.path.isdir(dich) else ""
    return dich
