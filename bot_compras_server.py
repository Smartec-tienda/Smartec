# ============================================================
# SMARTEC · BOT COMPRAS — Servidor local
# Corre en tu PC, expone una API en http://localhost:8000
# ============================================================

import asyncio
import json
import re
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import uvicorn

# Importar Playwright de forma diferida (solo cuando se use)
from playwright.async_api import async_playwright

# ============================================================
# CONFIGURACIÓN
# ============================================================

TIENDAS_VTEX = {
    "jumbo":    "https://www.jumbocolombia.com",
    "exito":    "https://www.exito.com",
    "olimpica": "https://www.olimpica.com",
    "easy":     "https://www.easy.com.co",
}

TIENDAS_SCRAPING = {
    "homecenter": "https://www.homecenter.com.co/homecenter-co/search?Ntt={query}",
    "alkosto":    "https://www.alkosto.com/search?text={query}",
    "falabella":  "https://www.falabella.com.co/falabella-co/search?Ntt={query}",
}

ESTRATEGIA_SCRAPING = {
    "homecenter": {
        "sel_tarjeta": [
            "div.product",
            "div[class*='product-container']",
            "div[class*='ie11-product-container']",
            "article",
        ],
        "sel_titulo": [
            "h2.product-title",
            "h2[class*='product-title']",
            "#title-pdp-link h2",
            "h3", "h2",
        ],
        "sel_precio": [
            "span.parsedPrice:not(.label)",
            "div.main span.parsedPrice",
            "span[class*='parsedPrice']",
        ],
    },
    "alkosto": {
        "sel_tarjeta": ["li[class*='product']", "article[class*='product']"],
        "sel_titulo":  ["h3", "h2", "a[class*='name']", "a[class*='title']"],
        "sel_precio":  ["span.price", "p.product__price", "span[class*='price']"],
    },
    "falabella": {
        "sel_tarjeta": [
            "div[id^='testId-pod-']",
            "div[class*='pod-summary']",
        ],
        "sel_titulo":  [
            "b[id^='testId-pod-displaySubTitle']",
            "b[class*='pod-subTitle']",
            "b[class*='subTitle']",
            "h3", "h2", "b",
        ],
        "sel_precio":  [
            "span[class*='copy10']",
            "li[class*='prices-0'] span",
            "span[class*='price']",
        ],
    },
}

# ============================================================
# ESTADO EN MEMORIA (historial de búsquedas)
# ============================================================

BUSQUEDAS = {}   # { id: { status, terminos, resultados, started_at, ... } }

# ============================================================
# UTILIDADES
# ============================================================

def coincide_terminos(titulo, terminos):
    if not titulo or not terminos:
        return False
    norm = lambda s: re.sub(r"[\s\-_/\.]", "", s.upper())
    return all(norm(t) in norm(titulo) for t in terminos)

def fmt_cop(v):
    return f"${v:,.0f}".replace(",", ".")

def parsear_numero(txt):
    nums = re.findall(r"[\d.,]+", txt or "")
    if not nums:
        return 0.0
    n = nums[0]
    if "," in n and "." in n:
        n = n.replace(".", "").replace(",", ".") if n.rfind(",") > n.rfind(".") else n.replace(",", "")
    elif "," in n:
        partes = n.split(",")
        n = n.replace(",", "") if len(partes[-1]) == 3 else n.replace(",", ".")
    elif "." in n:
        partes = n.split(".")
        if len(partes[-1]) == 3:
            n = n.replace(".", "")
    try:
        return float(n)
    except ValueError:
        return 0.0

def nombre_tarjeta(nombre_promo: str) -> str:
    if not nombre_promo:
        return ""
    n = nombre_promo.upper()
    if "TMC" in n or "CENCOSUD" in n or "METRO" in n:
        return "Tarjeta Cencosud / Metro"
    if "COD" in n or "CODENSA" in n:
        return "Tarjeta Codensa"
    if "OLIMPICA" in n or "OLÍMPICA" in n:
        return "Tarjeta Olímpica"
    if "CMR" in n or "FALABELLA" in n:
        return "Tarjeta CMR Falabella"
    return nombre_promo.strip()

def detectar_tarjeta_en_texto(texto: str) -> str:
    if not texto:
        return ""
    t = texto.lower()
    patrones = [
        (r"con\s+tu\s+tarjeta\s+cmr", "Tarjeta CMR Falabella"),
        (r"tarjeta\s+cmr\s+falabella", "Tarjeta CMR Falabella"),
        (r"con\s+tu\s+tarjeta\s+cencosud", "Tarjeta Cencosud / Metro"),
        (r"tarjeta\s+cencosud", "Tarjeta Cencosud / Metro"),
        (r"con\s+tu\s+tarjeta\s+olimpica", "Tarjeta Olímpica"),
        (r"tarjeta\s+olimpica", "Tarjeta Olímpica"),
        (r"con\s+tu\s+tarjeta\s+metro", "Tarjeta Cencosud / Metro"),
    ]
    for patron, nombre in patrones:
        if re.search(patron, t):
            return nombre
    return ""

# ============================================================
# SCRAPERS (adaptados de tu script original)
# ============================================================

async def leer_precio_tarjeta_olimpica(page, url_producto):
    try:
        resp = await page.goto(url_producto, timeout=30000, wait_until="domcontentloaded")
        if not resp or resp.status != 200:
            return 0.0, ""
        await page.wait_for_timeout(3000)
        await page.evaluate("window.scrollBy(0, 800)")
        await page.wait_for_timeout(1500)

        html = await page.content()

        m = re.search(
            r'currencyContainer[^>]*>(.*?)</span>\s*(?:<div|<a|<img)',
            html, re.DOTALL
        )
        if m:
            digitos = re.findall(r'currencyInteger[^>]*>(\d+)<', m.group(1))
            if digitos:
                precio = float("".join(digitos))
                if 100000 < precio < 100000000:
                    return precio, "Tarjeta Olímpica"

        try:
            el = await page.query_selector("[class*='currencyContainer']")
            if el:
                txt = await el.inner_text()
                m2 = re.search(r"\$\s*([\d.,]+)", txt)
                if m2:
                    precio = parsear_numero(m2.group(1))
                    if 100000 < precio < 100000000:
                        return precio, "Tarjeta Olímpica"
        except Exception:
            pass

        idx = html.find("Tarjeta Olímpica")
        if idx == -1:
            idx = html.find("tarjetaolimpica")
        if idx != -1:
            fragmento = html[max(0, idx - 3000):idx + 500]
            precios = re.findall(r'\$\s*([\d.]{7,})', fragmento)
            for p_str in precios:
                precio = parsear_numero(p_str)
                if 100000 < precio < 100000000:
                    return precio, "Tarjeta Olímpica"

        return 0.0, ""
    except Exception:
        return 0.0, ""


async def leer_precio_exito_producto(page, url_producto, terminos):
    try:
        resp = await page.goto(url_producto, timeout=30000, wait_until="domcontentloaded")
        if not resp or resp.status != 200:
            return 0.0, ""
        await page.wait_for_timeout(4000)

        precio_tarjeta = 0.0
        for sel in [
            "span[data-fs-price='true'][data-variant='selling']",
            "span[data-fs-price='true']",
            "span[data-testid='store-price']",
        ]:
            els = await page.query_selector_all(sel)
            for el in els:
                try:
                    clase = await el.get_attribute("class") or ""
                    if "label" in clase.lower() or "crossed" in clase.lower():
                        continue
                    txt = (await el.inner_text()).strip()
                    m = re.search(r"\$\s*([\d.,]+)", txt)
                    if m:
                        n = parsear_numero(m.group(1))
                        if 100000 < n < 100000000:
                            if precio_tarjeta == 0 or n < precio_tarjeta:
                                precio_tarjeta = n
                except Exception:
                    continue
            if precio_tarjeta > 0:
                break

        precio_normal = 0.0
        for sel in [
            "span[data-fs-price='true'][data-variant='list']",
            "s", "span[class*='crossed']", "span[class*='label']",
        ]:
            els = await page.query_selector_all(sel)
            for el in els:
                try:
                    txt = (await el.inner_text()).strip()
                    m = re.search(r"\$\s*([\d.,]+)", txt)
                    if m:
                        n = parsear_numero(m.group(1))
                        if n > precio_tarjeta > 0:
                            precio_normal = n
                            break
                except Exception:
                    continue
            if precio_normal > 0:
                break

        html = await page.content()
        html_lower = html.lower()
        hay_tarjeta_exito = False

        if ("tarjeta éxito" in html_lower or
            "tarjeta exito" in html_lower or
            "tarjeta de crédito éxito" in html_lower or
            "tarjeta de credito exito" in html_lower):
            hay_tarjeta_exito = True

        if not hay_tarjeta_exito:
            for marcador in ["alliedmain", "imageallied", "filewidget-root_allied", "thirdprice"]:
                if marcador in html_lower:
                    hay_tarjeta_exito = True
                    break

        if hay_tarjeta_exito and precio_tarjeta > 0 and precio_normal > precio_tarjeta:
            return precio_tarjeta, "Tarjeta Éxito"
        if precio_normal > 0 and precio_tarjeta > 0 and precio_tarjeta < precio_normal:
            return precio_tarjeta, "Tarjeta Éxito"

        precios = [p for p in [precio_tarjeta, precio_normal] if p > 0]
        if not precios:
            return 0.0, ""
        return min(precios), ""
    except Exception:
        return 0.0, ""


async def leer_precio_falabella_producto(page, url_producto, terminos):
    try:
        resp = await page.goto(url_producto, timeout=45000, wait_until="domcontentloaded")
        if not resp or resp.status != 200:
            return 0.0, "", ""
        await page.wait_for_timeout(5000)

        html = await page.content()
        nums = []

        try:
            els_cmr = await page.query_selector_all("span.copy12")
            for el in els_cmr:
                txt = (await el.inner_text()).strip()
                m = re.search(r"\$\s*([\d.]+)", txt)
                if m:
                    n = parsear_numero(m.group(1))
                    if 100000 < n < 100000000:
                        nums.append(n)
        except Exception:
            pass

        if not nums:
            try:
                els_int = await page.query_selector_all("span.copy10")
                for el in els_int:
                    txt = (await el.inner_text()).strip()
                    m = re.search(r"\$\s*([\d.]+)", txt)
                    if m:
                        n = parsear_numero(m.group(1))
                        if 100000 < n < 100000000:
                            nums.append(n)
            except Exception:
                pass

        if not nums:
            precios = re.findall(r"\$\s*([\d.]{7,})", html)
            for p in precios:
                n = parsear_numero(p)
                if 100000 < n < 100000000:
                    nums.append(n)

        if not nums:
            return 0.0, "", ""

        precio_min = min(nums)

        titulo = ""
        try:
            h1 = await page.query_selector("h1")
            if h1:
                titulo = (await h1.inner_text()).strip()
            if not titulo:
                m = re.search(r'<meta property="og:title" content="([^"]+)"', html)
                if m:
                    titulo = m.group(1)
        except Exception:
            titulo = terminos[0] if terminos else "Producto"

        return precio_min, titulo, url_producto
    except Exception:
        return 0.0, "", ""


async def buscar_vtex(page, tienda, base_url, terminos):
    resultados = []
    query = " ".join(terminos)
    url = f"{base_url}/api/catalog_system/pub/products/search?ft={query}"

    try:
        resp = await page.goto(url, timeout=30000, wait_until="domcontentloaded")
        if not resp or resp.status != 200:
            return resultados
        body = await page.evaluate("() => document.body.innerText")
        data = json.loads(body)
    except Exception:
        return resultados

    if not isinstance(data, list):
        return resultados

    for prod in data:
        try:
            nombre = prod.get("productName", "")
            if not coincide_terminos(nombre, terminos):
                continue

            link = prod.get("link", "")
            if tienda == "exito" and "tienda.exito.com" in link:
                link = link.replace("tienda.exito.com", "www.exito.com")
            elif tienda == "exito" and link.startswith("/"):
                link = f"https://www.exito.com{link}"

            items = prod.get("items", [])
            if not items:
                continue

            todos_precios = []
            for item in items:
                for seller in item.get("sellers", []) or []:
                    oferta = seller.get("commertialOffer", {}) or {}
                    p = float(oferta.get("Price", 0) or 0)
                    if p > 100000:
                        todos_precios.append(p)

            if not todos_precios:
                continue

            precio_venta = min(todos_precios)

            mejor_pct = 0.0
            mejor_nombre = ""
            for cid, cnombre in (prod.get("clusterHighlights") or {}).items():
                if not cnombre:
                    continue
                m = re.search(r"(\d+(?:[.,]\d+)?)", cnombre)
                if not m:
                    continue
                pct = float(m.group(1).replace(",", "."))
                if 0 < pct <= 90 and pct > mejor_pct:
                    mejor_pct = pct
                    mejor_nombre = cnombre

            if mejor_pct > 0:
                precio_final = precio_venta * (1 - mejor_pct / 100.0)
                tarjeta = nombre_tarjeta(mejor_nombre)
            else:
                precio_final = precio_venta
                tarjeta = ""

            if tienda == "olimpica" and link:
                precio_tarjeta, tarjeta_nombre = await leer_precio_tarjeta_olimpica(page, link)
                if precio_tarjeta > 0 and precio_tarjeta < precio_final:
                    precio_final = precio_tarjeta
                    if tarjeta_nombre:
                        tarjeta = tarjeta_nombre

            if tienda == "exito" and link:
                precio_real, tarjeta_exito = await leer_precio_exito_producto(page, link, terminos)
                if precio_real > 0:
                    if precio_real <= precio_final:
                        precio_final = precio_real
                    if tarjeta_exito:
                        tarjeta = tarjeta_exito

            resultados.append({
                "tienda": tienda,
                "titulo": nombre,
                "precio": precio_final,
                "tarjeta_requerida": tarjeta,
                "url": link,
            })
        except Exception:
            continue

    return resultados


async def cerrar_modales(page):
    for sel in [
        "button.cc-nb-okagree",
        "button:has-text('Aceptar')",
        "button:has-text('Acepto')",
        "button:has-text('Entendido')",
    ]:
        try:
            btn = await page.query_selector(sel)
            if btn and await btn.is_visible():
                await btn.click(timeout=1500)
                await page.wait_for_timeout(800)
                return
        except Exception:
            continue


async def buscar_scraping(page, tienda, url, terminos):
    resultados = []
    estrategia = ESTRATEGIA_SCRAPING.get(tienda, {})
    try:
        await page.goto(url, timeout=45000, wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        await cerrar_modales(page)

        for _ in range(3):
            await page.evaluate("window.scrollBy(0, document.body.scrollHeight / 3)")
            await page.wait_for_timeout(800)

        tarjetas, sel_usado = [], None
        for sel in estrategia.get("sel_tarjeta", []):
            tarjetas = await page.query_selector_all(sel)
            if len(tarjetas) > 0:
                sel_usado = sel
                break

        vistos = set()
        for card in tarjetas:
            try:
                titulo = ""
                for sel_t in estrategia.get("sel_titulo", []):
                    el = await card.query_selector(sel_t)
                    if el:
                        txt = (await el.inner_text()).strip()
                        if txt and len(txt) > 5:
                            titulo = txt
                            break

                if not titulo or not coincide_terminos(titulo, terminos):
                    card_txt_full = (await card.inner_text()).strip()
                    if coincide_terminos(card_txt_full, terminos):
                        titulo = card_txt_full.split("\n")[0][:150]

                if not titulo or not coincide_terminos(titulo, terminos):
                    continue

                precio_num = 0.0
                tarjeta = ""

                for sel_p in estrategia.get("sel_precio", []):
                    els = await card.query_selector_all(sel_p)
                    for el in els:
                        try:
                            clase = await el.get_attribute("class") or ""
                            if "label" in clase.lower() or "crossed" in clase.lower():
                                continue
                            txt = (await el.inner_text()).strip()
                            if txt and any(c.isdigit() for c in txt):
                                precio_num = parsear_numero(txt)
                                if precio_num > 0:
                                    break
                        except Exception:
                            continue
                    if precio_num > 0:
                        break

                if precio_num <= 0:
                    card_txt = await card.inner_text()
                    matches = re.findall(r"\$\s*[\d.,]{5,}", card_txt)
                    nums = [parsear_numero(m) for m in matches]
                    nums_validos = [n for n in nums if n >= 100000]
                    if nums_validos:
                        precio_num = min(nums_validos)

                if precio_num < 100000:
                    continue

                clave = (titulo[:60], precio_num)
                if clave in vistos:
                    continue
                vistos.add(clave)

                link_el = await card.query_selector("a")
                href = await link_el.get_attribute("href") if link_el else ""
                if href and href.startswith("/"):
                    href = "/".join(url.split("/")[:3]) + href

                if not tarjeta and tienda not in ("homecenter", "falabella"):
                    card_txt = await card.inner_text()
                    tarjeta = detectar_tarjeta_en_texto(card_txt)

                resultados.append({
                    "tienda": tienda,
                    "titulo": titulo,
                    "precio": precio_num,
                    "tarjeta_requerida": tarjeta,
                    "url": href or url,
                })
            except Exception:
                continue
    except Exception:
        pass
    return resultados


# ============================================================
# ORQUESTADOR
# ============================================================

async def ejecutar_busqueda(busqueda_id: str, terminos: list):
    """Corre todos los scrapers y actualiza BUSQUEDAS[busqueda_id] en tiempo real."""
    estado = BUSQUEDAS[busqueda_id]
    estado["status"] = "buscando"
    estado["progreso"] = []   # lista de {tienda, status, count}

    todas_tiendas = list(TIENDAS_VTEX.keys()) + list(TIENDAS_SCRAPING.keys())
    for t in todas_tiendas:
        estado["progreso"].append({"tienda": t, "status": "pendiente", "count": 0})

    resultados = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)   # ← SIN VENTANA
        ctx = await browser.new_context(
            locale="es-CO",
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/122.0 Safari/537.36"),
            viewport={"width": 1366, "height": 900},
            extra_http_headers={"Accept-Language": "es-CO,es;q=0.9"},
        )
        page = await ctx.new_page()

        # VTEX
        for tienda, base_url in TIENDAS_VTEX.items():
            prog = next(p for p in estado["progreso"] if p["tienda"] == tienda)
            prog["status"] = "buscando"
            try:
                r = await buscar_vtex(page, tienda, base_url, terminos)
                prog["status"] = "ok"
                prog["count"] = len(r)
                resultados.extend(r)
            except Exception as e:
                prog["status"] = "error"
                prog["error"] = str(e)

        # Scraping
        for tienda, plantilla in TIENDAS_SCRAPING.items():
            prog = next(p for p in estado["progreso"] if p["tienda"] == tienda)
            prog["status"] = "buscando"
            try:
                url = plantilla.format(query=" ".join(terminos).replace(" ", "%20"))
                r = await buscar_scraping(page, tienda, url, terminos)
                prog["status"] = "ok"
                prog["count"] = len(r)
                resultados.extend(r)
            except Exception as e:
                prog["status"] = "error"
                prog["error"] = str(e)

        await browser.close()

    # Mejor por tienda
    mejores = {}
    for r in resultados:
        t = r["tienda"]
        if t not in mejores or r["precio"] < mejores[t]["precio"]:
            mejores[t] = r

    lista = sorted(mejores.values(), key=lambda x: x["precio"])

    estado["resultados"] = lista
    estado["total_productos"] = len(resultados)
    estado["status"] = "completado"
    estado["finished_at"] = datetime.now().isoformat()


# ============================================================
# API FASTAPI
# ============================================================

app = FastAPI(title="Smartec Bot Compras")

# CORS: permitir peticiones desde GitHub Pages, localhost, etc.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # en producción, cambiar por tu dominio
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BusquedaRequest(BaseModel):
    terminos: list[str]


@app.get("/")
async def root():
    return {
        "status": "ok",
        "servicio": "Smartec Bot Compras",
        "version": "1.0"
    }


@app.post("/buscar")
async def crear_busqueda(req: BusquedaRequest):
    """Inicia una búsqueda en background."""
    if not req.terminos or not any(t.strip() for t in req.terminos):
        raise HTTPException(status_code=400, detail="Debes enviar al menos un término")

    terminos = [t.strip() for t in req.terminos if t.strip()]
    busqueda_id = str(uuid.uuid4())[:8]

    BUSQUEDAS[busqueda_id] = {
        "id": busqueda_id,
        "terminos": terminos,
        "status": "iniciando",
        "progreso": [],
        "resultados": [],
        "total_productos": 0,
        "started_at": datetime.now().isoformat(),
    }

    # Lanzar tarea en background
    asyncio.create_task(ejecutar_busqueda(busqueda_id, terminos))

    return {"id": busqueda_id, "status": "iniciando"}


@app.get("/buscar/{busqueda_id}")
async def obtener_busqueda(busqueda_id: str):
    """Consulta el estado/resultados de una búsqueda."""
    if busqueda_id not in BUSQUEDAS:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    return BUSQUEDAS[busqueda_id]


@app.get("/historial")
async def historial():
    """Devuelve las últimas 20 búsquedas."""
    items = list(BUSQUEDAS.values())
    items.sort(key=lambda x: x["started_at"], reverse=True)
    return items[:20]


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print("  🤖 SMARTEC · BOT COMPRAS")
    print("=" * 60)
    print(f"  Servidor corriendo en puerto: {port}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")