"""
台股 JSON 股價更新工具
=====================
功能：
  1. 選擇 JSON 檔（tkinter 視窗）
  2. 自動抓取所有台股現價（yfinance）
  3. 計算技術指標：MA20/60/120、RSI14、支撐/壓力、趨勢文字
  4. 更新 price、updatedAt、detail.technical、_meta.lastUpdate
  5. 存成 原檔名_YYYY-MM-DD.json

安裝依賴：
  pip install yfinance pandas
"""

import json
import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from datetime import date, datetime
import threading

# ── 依賴檢查 ─────────────────────────────────────────────────────────────────
try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(
        "缺少套件",
        "請先安裝依賴套件：\n\npip install yfinance pandas\n\n安裝後再重新執行。"
    )
    sys.exit(1)


# ── 技術指標計算 ──────────────────────────────────────────────────────────────

def calc_ma(closes: pd.Series, period: int):
    """計算移動平均，若資料不足回傳 None"""
    if len(closes) < period:
        return None
    return round(float(closes.tail(period).mean()), 1)


def calc_rsi(closes: pd.Series, period: int = 14):
    """計算 RSI，若資料不足回傳 None"""
    if len(closes) < period + 1:
        return None
    delta = closes.diff().dropna()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.tail(period).mean()
    avg_loss = loss.tail(period).mean()
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def calc_support_resistance(closes: pd.Series, window: int = 20):
    """
    用最近 window 根 K 線的最低/最高點估算支撐與壓力。
    回傳 (support_str, resistance_str)
    """
    if len(closes) < window:
        return None, None
    recent = closes.tail(window)
    low = recent.min()
    high = recent.max()
    # 取整到「好看」的數字（百位或十位）
    def fmt(v):
        if v >= 1000:
            step = 50
        elif v >= 100:
            step = 10
        elif v >= 10:
            step = 1
        else:
            step = 0.5
        lo = round(v - (v % step) - step, 2)
        hi = round(v - (v % step), 2)
        return f"{lo}─{hi}"
    return fmt(low), fmt(high)


def calc_trend(price, ma20, ma60, ma120, rsi):
    """用均線與 RSI 自動產生一行趨勢描述"""
    parts = []
    if ma20 and ma60:
        if price > ma20 > ma60:
            parts.append("多頭排列（站上MA20/MA60）")
        elif price < ma20 < ma60:
            parts.append("空頭排列（跌破MA20/MA60）")
        elif price > ma20:
            parts.append("站上MA20，MA60仍承壓")
        else:
            parts.append("跌破MA20，短線偏弱")
    if rsi:
        if rsi >= 70:
            parts.append(f"RSI {rsi} 超買區")
        elif rsi <= 30:
            parts.append(f"RSI {rsi} 超賣區（反彈可期）")
        else:
            parts.append(f"RSI {rsi} 中性")
    return "；".join(parts) if parts else "資料不足，無法判斷"


# ── 單支股票更新 ──────────────────────────────────────────────────────────────

def fetch_and_update(stock: dict, today_str: str, log_fn):
    """
    查詢 yfinance，更新 stock dict。
    成功回傳 True，失敗回傳 False（stock 不動）。
    """
    code = stock.get("code", "")
    ticker_symbol = f"{code}.TW"
    name = stock.get("name", code)

    try:
        ticker = yf.Ticker(ticker_symbol)

        # ── Layer 1：現價 ───────────────────────────────
        info = ticker.fast_info
        price = None
        try:
            price = info.last_price
            if price is None or price != price:   # NaN guard
                raise ValueError("last_price is None/NaN")
            price = round(float(price), 2)
        except Exception:
            # fallback：用前收盤
            try:
                price = round(float(info.previous_close), 2)
            except Exception:
                pass

        if price is None:
            log_fn(f"  ⚠️  {name}（{code}）查無價格，跳過")
            return False

        stock["price"] = price
        stock["updatedAt"] = today_str
        log_fn(f"  ✅ {name}（{code}）現價 {price}")

        # ── Layer 2：技術指標 ────────────────────────────
        hist = ticker.history(period="6mo", interval="1d", auto_adjust=True)
        if hist.empty or "Close" not in hist.columns:
            log_fn(f"     ↳ {name} 無歷史資料，略過技術指標")
            return True

        closes = hist["Close"].dropna()

        ma20  = calc_ma(closes, 20)
        ma60  = calc_ma(closes, 60)
        ma120 = calc_ma(closes, 120)
        rsi14 = calc_rsi(closes, 14)
        support, resistance = calc_support_resistance(closes, 20)
        trend = calc_trend(price, ma20, ma60, ma120, rsi14)

        # 準備寫入 detail.technical
        if "detail" not in stock or not isinstance(stock["detail"], dict):
            stock["detail"] = {}
        if "technical" not in stock["detail"] or not isinstance(stock["detail"]["technical"], dict):
            stock["detail"]["technical"] = {}

        tech = stock["detail"]["technical"]
        if ma20  is not None: tech["ma20"]  = f"約{ma20}元"
        if ma60  is not None: tech["ma60"]  = f"約{ma60}元"
        if ma120 is not None: tech["ma120"] = f"約{ma120}元"
        if rsi14 is not None: tech["rsi14"] = f"約{rsi14}（自動計算）"
        if support    : tech["support"]    = f"{support}元（近20日低點估算）"
        if resistance : tech["resistance"] = f"{resistance}元（近20日高點估算）"
        tech["trend"]     = trend
        tech["updatedAt"] = today_str

        log_fn(f"     ↳ MA20={ma20} MA60={ma60} RSI14={rsi14} trend={trend}")
        return True

    except Exception as e:
        log_fn(f"  ❌ {name}（{code}）發生錯誤：{e}")
        return False


# ── GUI ───────────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("台股 JSON 股價更新工具")
        self.geometry("680x500")
        self.resizable(True, True)
        self._build_ui()

    def _build_ui(self):
        pad = {"padx": 12, "pady": 6}

        # ── 標題 ─────────────────────────────────────
        tk.Label(self, text="台股 JSON 股價更新工具",
                 font=("微軟正黑體", 16, "bold")).pack(**pad)

        # ── 檔案選擇 ──────────────────────────────────
        frame_file = tk.Frame(self)
        frame_file.pack(fill="x", **pad)
        tk.Label(frame_file, text="JSON 檔案：", width=10, anchor="w").pack(side="left")
        self.path_var = tk.StringVar()
        tk.Entry(frame_file, textvariable=self.path_var, state="readonly",
                 width=52).pack(side="left", padx=(0, 6))
        tk.Button(frame_file, text="選擇檔案",
                  command=self._choose_file).pack(side="left")

        # ── 更新選項 ──────────────────────────────────
        frame_opt = tk.LabelFrame(self, text="更新項目", padx=8, pady=4)
        frame_opt.pack(fill="x", padx=12, pady=4)
        self.var_price = tk.BooleanVar(value=True)
        self.var_tech  = tk.BooleanVar(value=True)
        tk.Checkbutton(frame_opt, text="現價 + updatedAt + _meta.lastUpdate",
                       variable=self.var_price, state="disabled").pack(anchor="w")
        tk.Checkbutton(frame_opt, text="技術指標（MA20/60/120、RSI14、支撐/壓力、趨勢）",
                       variable=self.var_tech).pack(anchor="w")

        # ── 執行按鈕 ──────────────────────────────────
        self.btn_run = tk.Button(self, text="▶  開始更新", font=("微軟正黑體", 12, "bold"),
                                 bg="#2563eb", fg="white", padx=10, pady=4,
                                 command=self._run)
        self.btn_run.pack(**pad)

        # ── 進度條 ────────────────────────────────────
        self.progress = ttk.Progressbar(self, mode="determinate", length=640)
        self.progress.pack(padx=12, pady=2)
        self.lbl_progress = tk.Label(self, text="", font=("Consolas", 9))
        self.lbl_progress.pack()

        # ── 日誌 ──────────────────────────────────────
        frame_log = tk.Frame(self)
        frame_log.pack(fill="both", expand=True, padx=12, pady=(4, 12))
        scrollbar = tk.Scrollbar(frame_log)
        scrollbar.pack(side="right", fill="y")
        self.log_box = tk.Text(frame_log, height=10, font=("Consolas", 9),
                               state="disabled", yscrollcommand=scrollbar.set,
                               bg="#1e1e1e", fg="#d4d4d4", insertbackground="white")
        self.log_box.pack(fill="both", expand=True)
        scrollbar.config(command=self.log_box.yview)

    # ── 事件 ──────────────────────────────────────────

    def _choose_file(self):
        path = filedialog.askopenfilename(
            title="選擇 JSON 檔案",
            filetypes=[("JSON 檔案", "*.json"), ("所有檔案", "*.*")]
        )
        if path:
            self.path_var.set(path)

    def _log(self, msg: str):
        """執行緒安全的日誌寫入"""
        self.after(0, self._append_log, msg)

    def _append_log(self, msg: str):
        self.log_box.config(state="normal")
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        self.log_box.config(state="disabled")

    def _set_progress(self, value: int, maximum: int, label: str = ""):
        self.after(0, lambda: self._update_progress(value, maximum, label))

    def _update_progress(self, value, maximum, label):
        self.progress["maximum"] = maximum
        self.progress["value"]   = value
        self.lbl_progress.config(text=label)

    def _run(self):
        path = self.path_var.get()
        if not path:
            messagebox.showwarning("提示", "請先選擇 JSON 檔案！")
            return
        if not os.path.isfile(path):
            messagebox.showerror("錯誤", "找不到指定的檔案，請重新選擇。")
            return

        # 避免重複點擊
        self.btn_run.config(state="disabled")
        self.log_box.config(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.config(state="disabled")

        update_tech = self.var_tech.get()
        threading.Thread(target=self._worker,
                         args=(path, update_tech), daemon=True).start()

    def _worker(self, path: str, update_tech: bool):
        today_str = date.today().isoformat()   # e.g. "2026-03-25"
        self._log(f"🚀 開始更新：{os.path.basename(path)}")
        self._log(f"📅 今日日期：{today_str}")
        self._log("─" * 60)

        # 讀入 JSON
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            self._log(f"❌ 無法讀取 JSON：{e}")
            self.after(0, lambda: self.btn_run.config(state="normal"))
            return

        stocks = data.get("stocks", [])
        total = len(stocks)
        if total == 0:
            self._log("⚠️  JSON 中沒有 stocks 資料！")
            self.after(0, lambda: self.btn_run.config(state="normal"))
            return

        self._log(f"📋 共 {total} 支股票，開始逐一查詢…\n")

        warnings = []
        success  = 0

        for i, stock in enumerate(stocks, 1):
            name = stock.get("name", "—")
            code = stock.get("code", "—")
            self._set_progress(i, total, f"{i}/{total}  {name}（{code}）")

            ok = fetch_and_update(stock, today_str, self._log)
            if ok:
                success += 1
                # 若不要技術指標，把 detail.technical 那層清除掉剛剛加的
                if not update_tech and "detail" in stock:
                    tech = stock["detail"].get("technical", {})
                    for key in ["ma20","ma60","ma120","rsi14","support","resistance","trend"]:
                        tech.pop(key, None)
            else:
                warnings.append(f"{name}（{code}）")

        # 更新 _meta
        if "_meta" in data:
            data["_meta"]["lastUpdate"] = f"股價自動更新：{today_str} by stock_updater.py"
            data["_meta"]["version"]    = today_str

        # 輸出檔名
        base_name = os.path.splitext(os.path.basename(path))[0]
        out_dir   = os.path.dirname(path)
        out_name  = f"{base_name}_{today_str}.json"
        out_path  = os.path.join(out_dir, out_name)

        try:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self._log(f"\n❌ 儲存失敗：{e}")
            self.after(0, lambda: self.btn_run.config(state="normal"))
            return

        # 結果摘要
        self._log("\n" + "─" * 60)
        self._log(f"✅ 成功更新：{success} / {total} 支")
        if warnings:
            self._log(f"\n⚠️  以下 {len(warnings)} 支未能更新（保留原始價格）：")
            for w in warnings:
                self._log(f"   • {w}")
        self._log(f"\n💾 已儲存至：{out_path}")
        self._set_progress(total, total, f"完成！{success}/{total} 支更新成功")

        self.after(0, lambda: messagebox.showinfo(
            "完成",
            f"更新完成！\n\n✅ 成功：{success} / {total} 支\n"
            + (f"⚠️  失敗：{len(warnings)} 支\n" if warnings else "")
            + f"\n💾 已儲存：\n{out_path}"
        ))
        self.after(0, lambda: self.btn_run.config(state="normal"))


# ── 進入點 ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
