# -*- coding: utf-8 -*-
"""TokenPool — đệm token reCAPTCHA đúc sẵn, bọc quanh bộ mint sẵn có.

VÌ SAO CÓ FILE NÀY
------------------
`image_gen._mint()` gọi `minter.get(1)` cho TỪNG cảnh, và mỗi lần `get(1)` là
một lượt `page.goto(<trang project>)` + giả thao tác chuột + `grecaptcha
.execute()`. Tức là mỗi cảnh phải trả 3–6 giây CHỜ CAPTCHA trước khi gửi được
request tạo video. Trên mẻ 100 cảnh, riêng khoản này đã là 5–10 phút chết.

SuperVeo không nhanh hơn vì nhiều luồng — trần song song là của Google, ai
cũng như ai. Nó nhanh vì **captcha không nằm trên đường tới hạn**: sidecar đúc
sẵn một rổ token (`prefetchTokens` → `tokenPool` → `consumeToken`), lúc bấm
generate chỉ việc lấy ra dùng. File này làm đúng việc đó.

HAI THỨ KHÔNG ĐƯỢC QUÊN
-----------------------
1. **Token reCAPTCHA sống 120 giây.** Đệm to là tự bắn vào chân: token quá
   hạn vẫn ăn ngân sách `execute()` của trang mà không dùng được. Nên đệm nhỏ
   (`TARGET`), có TTL, và hết hạn thì vứt.
2. **Trang mint rớt điểm sau ~16 lần `execute()`** (số đo ghi trong
   `RecaptchaMinter.MINT_MAX_TOKENS`). Đúc theo lô KHÔNG làm giảm ngân sách
   đó — một lô 3 token vẫn là 3 lần `execute()`. Cái nó tiết kiệm là số lần
   `goto()`: 3 token trên 1 lần tải trang thay vì 3 lần tải. Vì vậy
   `flow_api._serve()` đã được sửa để đếm ĐÚNG n thay vì đếm 1 mỗi lệnh.

Đệm được KEO THEO ACTION (`IMAGE_GENERATION` / `VIDEO_GENERATION`) — token
mint sai action bị backend Flow từ chối, không dùng lẫn được.

CHỈ ĐÚC KHI CÓ NGƯỜI XIN
------------------------
Luồng nạp không chạy nền suốt buổi. Nó chỉ nạp cho action nào vừa có `get()`
trong vòng `IDLE_STOP` giây. Đúc không công thì vừa phí token vừa đốt ngân
sách trang, kéo lúc bị Google chấm rớt tới sớm hơn.

TẮT ĐI / CHỈNH
--------------
    set CAPCUT_TOKEN_POOL=0            # bỏ hẳn pool, về hành vi cũ
    set CAPCUT_TOKEN_POOL_SIZE=3       # số token giữ sẵn mỗi action
    set CAPCUT_TOKEN_POOL_BATCH=3      # đúc mỗi lô bấy nhiêu
    set CAPCUT_TOKEN_TTL=95            # giây, phải < 120
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(str(os.environ.get(name, "") or default).strip())
    except Exception:
        v = default
    return max(lo, min(hi, v))


def enabled() -> bool:
    """Pool bật hay không (mặc định bật)."""
    return (os.environ.get("CAPCUT_TOKEN_POOL", "1") or "1").strip().lower() \
        not in ("0", "off", "no", "false")


class TokenPool:
    """Bọc một minter bất kỳ, thêm đệm đúc sẵn. Giao diện y hệt minter.

    Thả thẳng vào chỗ `RecaptchaMinter` / `PuppeteerMinter`:
    `start / stop / get / set_project / request_reset / ready / dead / error`.
    """

    #: Action mặc định — trùng minter, để caller không truyền cũng chạy.
    ACTION = "IMAGE_GENERATION"

    def __init__(self, minter, logger=None):
        self.m = minter
        self._log_fn = logger or (lambda m: print(m))
        # ── 30/08: TRẢ VỀ 3, và hạ TTL 95 -> 45 ──
        #
        # Sáng nay đã thử nâng đệm 3 -> 6 để chống 403. Đo trên ba mẻ thật thì
        # nó làm TỆ HƠN, đúng như phần đầu file này đã cảnh báo:
        #
        #   đệm 3 (Luồng 12) : chạy sạch 13 cảnh rồi mới 403
        #   đệm 6 (Luồng 8)  : chạy sạch 10 cảnh
        #   đệm 6 + trần token 10 (Luồng 8) : vẫn 10 cảnh
        #
        # Hạ luồng không đổi gì, bật trần token không đổi gì. Thứ DUY NHẤT có
        # tương quan là kích thước đệm — và nó tương quan NGƯỢC.
        #
        # Cách giải thích khớp cả ba số: token reCAPTCHA sống 120 giây, và
        # điểm của nó tính theo lúc SINH. Đệm càng to thì token nằm chờ càng
        # lâu, tới lúc đem dùng đã già — Google chấm một token 90 giây tuổi
        # khác hẳn một token vừa đúc.
        #
        # Nên: đệm NHỎ vừa đủ khỏi phải chờ, và TTL ngắn để không bao giờ đem
        # dùng token già. 45s là nửa đời token — còn dư chỗ cho việc gửi.
        self.TARGET = _env_int("CAPCUT_TOKEN_POOL_SIZE", 3, 1, 12)
        self.BATCH = _env_int("CAPCUT_TOKEN_POOL_BATCH", 2, 1, 6)
        self.TTL = float(_env_int("CAPCUT_TOKEN_TTL", 45, 20, 115))
        # 29/09 IMAGE FAST: giu dem am (TARGET≥2–3, TTL ngan) de canh sau
        # khong doi full remint. Prefetch Cookie Flow tokens; FRESH mac dinh OFF.
        self.TARGET_IMAGE = _env_int("CAPCUT_TOKEN_POOL_SIZE_IMAGE", 3, 1, 5)
        self.BATCH_IMAGE = _env_int("CAPCUT_TOKEN_POOL_BATCH_IMAGE", 2, 1, 5)
        self.TTL_IMAGE = float(_env_int("CAPCUT_TOKEN_TTL_IMAGE", 35, 15, 60))
        # 0 = dung dem ngan (prefetch); 1 = IMAGE luon mint moi.
        self.IMAGE_FRESH = (os.environ.get("CAPCUT_IMAGE_MINT_FRESH") or "0").strip().lower() not in (
            "0", "off", "no", "false")
        self.IDLE_STOP = 90.0

        self._buf: dict = {}          # action -> deque[(token, lúc_đúc)]
        self._demand: dict = {}       # action -> lần cuối có người xin
        self._lock = threading.Lock()         # bảo vệ _buf / _demand
        self._mint_lock = threading.Lock()    # mỗi lúc chỉ một lệnh mint
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._filler = None
        # thống kê để in lúc tắt
        self._n_hit = 0        # lấy được từ đệm, không phải chờ
        self._n_miss = 0       # đệm rỗng, phải đúc tại chỗ
        self._n_expired = 0    # đúc ra nhưng quá hạn trước khi dùng

    # ------------------------------------------------------------------
    # cầu nối sang minter thật
    # ------------------------------------------------------------------
    @property
    def ready(self):
        return self.m.ready

    @property
    def dead(self):
        return self.m.dead

    @property
    def error(self):
        return getattr(self.m, "error", None)

    @error.setter
    def error(self, v):
        try:
            self.m.error = v
        except Exception:
            pass

    def log(self, msg: str) -> None:
        try:
            self._log_fn(f"[pool] {msg}")
        except Exception:
            pass

    def set_cookies(self, cookie_str: str) -> None:
        fn = getattr(self.m, "set_cookies", None)
        if callable(fn):
            fn(cookie_str)

    def set_skip_inject(self, skip: bool = True) -> None:
        fn = getattr(self.m, "set_skip_inject", None)
        if callable(fn):
            fn(skip)

    def set_profile_dir(self, path: str) -> None:
        """Chuyển tiếp xuống bộ mint (hồ sơ Chrome thật của tài khoản)."""
        fn = getattr(self.m, "set_profile_dir", None)
        if callable(fn):
            fn(path)

    def set_alt_projects(self, pids) -> None:
        fn = getattr(self.m, "set_alt_projects", None)
        if callable(fn):
            fn(pids)

    def dat_van_tay(self, van_tay: str, email: str = "") -> None:
        """Chuyen tiep: phien Google cua TK dang chay (+ email log lech)."""
        fn = getattr(self.m, "dat_van_tay", None)
        if not callable(fn):
            return
        cu = getattr(self, "_van_tay_cu", "")
        try:
            fn(van_tay, email=email)
        except TypeError:
            fn(van_tay)
        if van_tay and cu and van_tay != cu:
            self._flush("doi tai khoan (phien Google khac)")
        self._van_tay_cu = van_tay

    def available(self) -> bool:
        """Tiện ích / minter nền đang sẵn sàng cho need_rpc."""
        fn = getattr(self.m, "available", None)
        if callable(fn):
            try:
                return bool(fn())
            except Exception:
                return False
        # MintKep không có available cũ: nhìn .ext
        ext = getattr(self.m, "ext", None)
        fn2 = getattr(ext, "available", None) if ext is not None else None
        try:
            return bool(callable(fn2) and fn2())
        except Exception:
            return False

    def goi_rpc(self, rpcid: str, f_req: str, timeout: float = 120.0) -> tuple:
        """Chuyển tiếp: nhờ tiện ích gửi RPC ngay trong tab Flow."""
        fn = getattr(self.m, "goi_rpc", None)
        return fn(rpcid, f_req, timeout=timeout) if callable(fn) else (0, "")

    def co_dung_chrome(self) -> bool:
        fn = getattr(self.m, "co_dung_chrome", None)
        return bool(callable(fn) and fn())

    @property
    def khac_phien(self) -> bool:
        """Chrome đang mở ≠ phiên tài khoản đang chạy (chuyển tiếp từ MintKep)."""
        return bool(getattr(self.m, "khac_phien", False))

    def lay_wiz(self, project_id: str = "", timeout: float = 60.0) -> dict:
        """Chuyển tiếp: hỏi at/cookie tươi từ trình duyệt mint."""
        fn = getattr(self.m, "lay_wiz", None)
        return fn(project_id=project_id, timeout=timeout) if callable(fn) else {}

    # ------------------------------------------------------------------
    # vòng đời
    # ------------------------------------------------------------------
    def fetch_api(self, url: str, headers=None, body=None,
                  timeout: float = 90.0):
        """Chuyển tiếp: POST trong Chrome mint (cùng phiên token).

        Không trả None — None làm _post_via_mint_browser skip im → Node 403.
        """
        fn = getattr(self.m, "fetch_api", None)
        if not callable(fn):
            return {
                "ok": False, "status": 0, "body": "",
                "error": f"TokenPool.m={type(self.m).__name__} thiếu fetch_api",
            }
        return fn(url, headers=headers, body=body, timeout=timeout)

    def start(self) -> None:
        self.m.start()
        # Filler Thread: khong start() lai object cu (RuntimeError).
        # Song → giu; chet/None → Thread MOI moi lan batch.
        alive = False
        if self._filler is not None:
            try:
                alive = bool(self._filler.is_alive())
            except Exception:
                alive = False
            if not alive:
                self._filler = None
        if self._filler is None:
            try:
                self._stop.clear()
            except Exception:
                self._stop = threading.Event()
            self._filler = threading.Thread(
                target=self._fill_loop, daemon=True, name="token-pool")
            self._filler.start()
        self.log(
            f"đệm token bật (giữ {self.TARGET}/action, lô {self.BATCH}, "
            f"hạn {self.TTL:.0f}s | IMAGE target={self.TARGET_IMAGE} "
            f"batch={self.BATCH_IMAGE} ttl={self.TTL_IMAGE:.0f}s "
            f"fresh={int(bool(self.IMAGE_FRESH))})")

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._report()
        try:
            self.bao_dung()
        except Exception:
            pass
        try:
            self.m.stop()
        except Exception:
            pass

    def bao_dung(self) -> None:
        """Bam Dung: ngung prefetch + huy waiter mint ben duoi."""
        self._stop.set()
        self._wake.set()
        m = getattr(self, "m", None)
        if m is None:
            return
        fn = getattr(m, "bao_dung", None)
        if callable(fn):
            try:
                fn()
            except Exception:
                pass
        else:
            for attr in ("ext", "_srv", "cu"):
                obj = getattr(m, attr, None)
                if obj is None:
                    continue
                fn2 = getattr(obj, "bao_dung", None)
                if callable(fn2):
                    try:
                        fn2()
                    except Exception:
                        pass

    def tiep_tuc(self) -> None:
        """Me moi: cho pool + mint nhan token lai."""
        try:
            self._stop.clear()
        except Exception:
            self._stop = __import__("threading").Event()
        m = getattr(self, "m", None)
        if m is None:
            return
        fn = getattr(m, "tiep_tuc", None)
        if callable(fn):
            try:
                fn()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # đổi ngữ cảnh → đệm cũ phải vứt
    # ------------------------------------------------------------------
    def set_project(self, project_id=None) -> None:
        """Đổi project = đổi trang mint. Token đúc ở trang cũ điểm thấp hơn."""
        old = getattr(self.m, "_project_id", None)
        try:
            self.m.set_project(project_id)
        except Exception:
            return
        if getattr(self.m, "_project_id", None) != old:
            self._flush("đổi project")

    def bo_token(self, why: str = "403") -> None:
        """Vứt token đang giữ NHƯNG GIỮ NGUYÊN trình duyệt mint.

        Dùng cho 403 lẻ: token vừa bị từ chối có thể kéo theo vài cái cùng lô
        cũng điểm thấp, nên bỏ đi cho chắc. Nhưng dựng lại cả Chrome thì quá
        tay — trình duyệt vừa dựng lại chính là thứ cho token điểm thấp.
        """
        self._flush(why)

    def request_reset(self, reason: str = "", hard=None) -> None:
        """Dựng lại Chrome mint. Token đang giữ thuộc phiên sắp bỏ → vứt.

        `hard=True` chuyển thẳng xuống bộ mint puppeteer: GIẾT sidecar và dựng
        cái mới (xem `PuppeteerMinter.request_reset`). Bộ mint cũ không nhận
        tham số này thì gọi như trước.

        Lệch phiên: đừng flush/reset liên tục — chỉ tổ spam log (27/09).
        """
        if getattr(self.m, "khac_phien", False):
            return
        self._flush(reason or "dựng lại phiên")
        try:
            if hard is None:
                self.m.request_reset(reason)
            else:
                try:
                    self.m.request_reset(reason, hard=hard)
                except TypeError:
                    self.m.request_reset(reason)
        except Exception:
            pass

    def _flush(self, why: str) -> None:
        with self._lock:
            n = sum(len(d) for d in self._buf.values())
            self._buf.clear()
        if n:
            self.log(f"bỏ {n} token đang giữ ({why})")

    # ------------------------------------------------------------------
    # lấy token
    # ------------------------------------------------------------------
    def _is_image_action(self, act: str) -> bool:
        return "IMAGE" in (act or "").upper()

    def _ttl_for(self, act: str) -> float:
        return self.TTL_IMAGE if self._is_image_action(act) else self.TTL

    def _target_for(self, act: str) -> int:
        return self.TARGET_IMAGE if self._is_image_action(act) else self.TARGET

    def get(self, n=1, timeout=90, action=None) -> list:
        if self._stop.is_set():
            return []
        act = action or self.ACTION
        # IMAGE: uu tien mint-per-request (tranh reuse token diem thap)
        if self.IMAGE_FRESH and self._is_image_action(act):
            with self._lock:
                self._demand[act] = time.time()
                if act in self._buf:
                    self._buf[act].clear()
            self._mint_into_buf(act, max(1, int(n)), float(timeout))
            out = []
            with self._lock:
                d = self._buf.get(act)
                now = time.time()
                ttl = self._ttl_for(act)
                while d and len(out) < n:
                    tok, born = d.popleft()
                    if now - born <= ttl:
                        out.append(tok)
                    else:
                        self._n_expired += 1
                self._n_miss += 1
            # HARD-STOP token cut
            try:
                from puppeteer_minter import TOKEN_DAI_BINH_THUONG as _MIN
            except Exception:
                _MIN = 1500
            ok = [x for x in out if x and len(x) >= int(_MIN)]
            if out and not ok:
                try:
                    self.log(
                        "[pool] HARD-STOP IMAGE fresh: token cut — KHONG dua")
                except Exception:
                    pass
            return ok

        now = time.time()
        with self._lock:
            self._demand[act] = now
        self._wake.set()

        out = []
        deadline = now + max(1.0, float(timeout))
        while len(out) < n:
            if self._stop.is_set():
                break
            # Mỗi token chỉ được tính MỘT lần: lấy thẳng từ đệm là "hit",
            # phải dừng lại đúc mới có là "miss". Đừng cộng cả hai cho cùng
            # một token, không thì tỉ lệ in ra đẹp hơn sự thật.
            tok = self._pop(act)
            if tok:
                out.append(tok)
                self._n_hit += 1
                continue
            remain = deadline - time.time()
            if remain <= 0:
                break
            # Đệm rỗng → tự đúc tại chỗ (đúng hành vi cũ), tiện thể đúc luôn
            # phần dự trữ cho cảnh sau.
            want = max(n - len(out), self._target_for(act))
            if not self._mint_into_buf(act, min(self._batch_for(act), want),
                                       timeout=remain):
                break
            tok = self._pop(act)
            if not tok:
                break
            out.append(tok)
            self._n_miss += 1
        # HARD-STOP token cut — IMAGE/VIDEO 403 neu gui token ~538.
        try:
            from puppeteer_minter import TOKEN_DAI_BINH_THUONG as _MIN
        except Exception:
            _MIN = 1500
        ok = [x for x in out if x and len(x) >= int(_MIN)]
        if out and not ok:
            _dai = max(len(x or "") for x in out)
            try:
                self.log(
                    f"[pool] HARD-STOP: token cut {_dai} < {_MIN} — "
                    "KHONG dua IMAGE/VIDEO")
            except Exception:
                pass
        return ok

    def _pop(self, act: str):
        """Lấy một token còn hạn ra khỏi đệm. Quá hạn thì bỏ và đếm."""
        now = time.time()
        with self._lock:
            d = self._buf.get(act)
            while d:
                tok, born = d.popleft()
                if now - born <= self._ttl_for(act):
                    return tok
                self._n_expired += 1
        return None

    def _live(self, act: str) -> int:
        """Số token còn hạn trong đệm (dọn luôn cái quá hạn ở đầu hàng)."""
        now = time.time()
        with self._lock:
            d = self._buf.get(act)
            if not d:
                return 0
            while d and now - d[0][1] > self._ttl_for(act):
                d.popleft()
                self._n_expired += 1
            return len(d)

    def _batch_for(self, act: str) -> int:
        """Cỡ lô theo action.

        IMAGE (28/09 img403): BATCH_IMAGE=1 — tranh dut nhieu token diem thap.
        VIDEO: do that — lo 2 de thua nhip execute (tranh 429).
        """
        if "IMAGE" in (act or "").upper():
            return max(1, int(getattr(self, "BATCH_IMAGE", 1) or 1))
        if "VIDEO" in (act or "").upper():
            return max(1, min(self.BATCH, 2))
        return self.BATCH

    def _mint_into_buf(self, act: str, count: int, timeout: float) -> int:
        """Gọi minter thật một lô, nhét kết quả vào đệm. Trả số token nhận."""
        if self._stop.is_set():
            return 0
        count = max(1, min(int(count), self._batch_for(act)))
        with self._mint_lock:
            if self._stop.is_set():
                return 0
            # Luồng khác có thể vừa nạp xong trong lúc mình chờ khoá.
            if self._live(act) > 0:
                return 1
            try:
                toks = self.m.get(max(1, int(count)),
                                  timeout=max(5.0, float(timeout)),
                                  action=act) or []
            except Exception as e:
                self.log(f"đúc hỏng: {e}")
                return 0
            if not toks:
                # Lệch phiên: đánh dấu demand hết hạn để fill_loop ngừng đúc.
                if getattr(self.m, "khac_phien", False):
                    with self._lock:
                        self._demand.pop(act, None)
                return 0
            born = time.time()
            with self._lock:
                d = self._buf.setdefault(act, deque())
                for t in toks:
                    d.append((t, born))
            return len(toks)

    # ------------------------------------------------------------------
    # luồng nạp nền
    # ------------------------------------------------------------------
    def _fill_loop(self) -> None:
        while not self._stop.is_set():
            # Ngủ tới khi có người xin token, hoặc soát lại sau 1 giây.
            self._wake.wait(timeout=1.0)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                if self.dead.is_set() or not self.ready.is_set():
                    continue
            except Exception:
                continue
            now = time.time()
            with self._lock:
                acts = [a for a, t in self._demand.items()
                        if now - t <= self.IDLE_STOP]
            for act in acts:
                if self._stop.is_set():
                    break
                # Chrome ≠ tài khoản đang chạy → đừng đúc nền nữa (spam log).
                if getattr(self.m, "khac_phien", False):
                    with self._lock:
                        self._demand.clear()
                    break
                thieu = self._target_for(act) - self._live(act)
                if thieu <= 0:
                    continue
                # Đúc bù, nhưng không quá một lô — để vòng sau còn xét lại
                # xem người dùng có còn tiêu token nữa không.
                self._mint_into_buf(act, min(self._batch_for(act), thieu), timeout=90)

    # ------------------------------------------------------------------
    def prime(self, action=None) -> None:
        """Bảo pool nạp trước (gọi lúc bắt đầu mẻ, cho đỡ hụt ở cảnh đầu)."""
        with self._lock:
            self._demand[action or self.ACTION] = time.time()
        self._wake.set()

    def stats(self) -> dict:
        return {"hit": self._n_hit, "miss": self._n_miss,
                "expired": self._n_expired}

    def _report(self) -> None:
        tot = self._n_hit + self._n_miss
        if not tot:
            return
        pct = 100.0 * self._n_hit / tot
        self.log(f"tổng kết: {self._n_hit}/{tot} token lấy sẵn từ đệm "
                 f"({pct:.0f}% không phải chờ), {self._n_expired} token quá hạn")
