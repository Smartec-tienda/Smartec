/* ============================================================
   SMARTEC · pdf-generator.js
   Genera PDFs de remisión, tirilla y media carta usando jsPDF.
   Sube los PDFs a Firebase Storage y guarda las URLs en la venta.

   Requiere:
   - jsPDF (window.jspdf)
   - jspdf-autotable (extiende jsPDF con .autoTable)
   - Firebase Storage (uploadBytes, getDownloadURL, ref)
   - Firestore (doc, updateDoc, serverTimestamp)

   Uso:
     await SmartecPdf.generateAndUploadAll(sale, settings, {
       storage, ref, uploadBytes, getDownloadURL,
       db, doc, updateDoc, serverTimestamp
     });
============================================================ */

(function () {
  'use strict';

  /**
   * 🆕 Obtiene jsPDF de forma robusta.
   * - Si ya está cargado → lo devuelve directo
   * - Si no está cargado → intenta cargarlo bajo demanda
   * - Si no puede → lanza error descriptivo
   *
   * IMPORTANTE: no hacemos `const { jsPDF } = window.jspdf` al inicio
   * porque pdf-generator.js se carga ANTES que jsPDF (que es lazy).
   */
  async function _getJsPDF() {
    // 1. Si ya está disponible → devolverlo
    if (window.jspdf && window.jspdf.jsPDF) {
      return window.jspdf.jsPDF;
    }

    // 2. Intentar cargarlo bajo demanda
    if (typeof window.loadLazyLibs === 'function') {
      try {
        await window.loadLazyLibs('jspdf');
      } catch (e) {
        console.warn('[PDF] No se pudo cargar jsPDF bajo demanda:', e);
      }
    }

    // 3. Verificar de nuevo
    if (window.jspdf && window.jspdf.jsPDF) {
      return window.jspdf.jsPDF;
    }

    // 4. Fallar con mensaje claro
    throw new Error(
      'jsPDF no está disponible. ' +
      'Verifica que loadLazyLibs("jspdf") se haya llamado antes de generar PDFs.'
    );
  }

  /* ============================================================
     HELPERS
  ============================================================ */

  const fmt = n => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');

  const fmtDate = ts => {
    if (!ts) return '-';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleString('es-CO', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const fmtDateShort = ts => {
    if (!ts) return '-';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const fmtTime = ts => {
    if (!ts) return '-';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  function getCompanyInfo(sale, settings) {
    return {
      razonSocial: settings.companyRazonSocial || 'Smartec',
      nit: settings.companyNit || '—',
      regimen: settings.companyRegimen || '',
      address: settings.companyAddress || '',
      phone: settings.companyPhone || settings.whatsapp || '',
      email: settings.companyEmail || '',
      storeName: sale.storeName || '',
    };
  }

    /* 🆕 Detecta si la venta es mayorista y devuelve datos resumidos */
  function getWholesaleInfo(sale) {
    if (!sale || sale.saleMode !== 'wholesale') return null;
    const w = sale.wholesaleCustomer || {};
    return {
      isWholesale: true,
      companyName: w.companyName || sale.customer?.name || 'Sin nombre',
      nit: w.nit || '',
      contactName: w.contactName || sale.customer?.name || '',
      paymentTerms: w.paymentTerms || null,
      discountBase: Number(w.discountBase || 0),
      customerId: w.customerId || null
    };
  }

  /* ============================================================
     1. PDF REMISIÓN (Carta 216×279mm)
  ============================================================ */
  async function generateRemisionPDF(sale, settings) {
    const jsPDF = await _getJsPDF();
    const doc = new jsPDF('p', 'mm', 'letter');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 15;                // margen lateral
    const CW = pageW - 2 * M;    // ancho útil

    const c = getCompanyInfo(sale, settings);
    const docNumber = sale.documentNumber || 'SIN-NÚMERO';

    let y = M;

    // ===== Helpers locales =====
    const dashedLine = (yy, x1 = M, x2 = pageW - M) => {
      doc.setLineDashPattern([1, 1], 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.15);
      doc.line(x1, yy, x2, yy);
      doc.setLineDashPattern([], 0);
    };

    const solidLine = (yy, x1 = M, x2 = pageW - M, width = 0.4) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(width);
      doc.line(x1, yy, x2, yy);
    };

    // ============ CABECERA ============
    // Barra azul superior
    doc.setFillColor(0, 113, 227);
    doc.rect(0, 0, pageW, 4, 'F');

    // 🆕 Logo (imagen) o texto SMARTEC como respaldo
    const logoUrl = settings.logoUrl || settings.faviconUrl || null;
    let logoRendered = false;

    if (logoUrl) {
      try {
        const imgData = await loadImageAsDataURL(logoUrl);
        if (imgData) {
          const probe = await loadImageElement(logoUrl);
          let logoW = 50;
          let logoH = 14;

          if (probe && probe.naturalWidth && probe.naturalHeight) {
            const ratio = probe.naturalWidth / probe.naturalHeight;
            // Alto máximo 14mm, ancho máximo 60mm
            logoH = 14;
            logoW = logoH * ratio;
            if (logoW > 60) {
              logoW = 60;
              logoH = logoW / ratio;
            }
          }

          doc.addImage(imgData, 'PNG', M, y + 2, logoW, logoH);
          logoRendered = true;
          y += logoH + 4;
        }
      } catch (e) {
        console.warn('[PDF] No se pudo agregar logo a la remisión:', e);
      }
    }

    if (!logoRendered) {
      // Respaldo: texto SMARTEC
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(0, 113, 227);
      doc.text('SMART', M, y + 8);
      const smartWidth = doc.getTextWidth('SMART');
      doc.setTextColor(29, 29, 31);
      doc.text('EC', M + smartWidth, y + 8);
      y += 12;
    }

    // Razón social (debajo del logo)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(29, 29, 31);
    doc.text((c.razonSocial || '').toUpperCase(), M, y);
    y += 4;

    // Info empresa (izquierda)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    doc.text(`NIT: ${c.nit}${c.regimen ? ' · ' + c.regimen : ''}`, M, y);
    y += 4;
    if (c.address) { doc.text(c.address, M, y); y += 4; }
    if (c.phone) { doc.text(`Tel: ${c.phone}`, M, y); y += 4; }
    if (c.email) { doc.text(`Email: ${c.email}`, M, y); y += 4; }

    let infoY = y;

    // Tipo de documento (derecha)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(29, 29, 31);
    doc.text('REMISIÓN', pageW - M, M + 8, { align: 'right' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`No. ${docNumber}`, pageW - M, M + 15, { align: 'right' });

    doc.setFontSize(8);
    doc.setTextColor(110, 110, 115);
    doc.text(fmtDate(sale.createdAt), pageW - M, M + 20, { align: 'right' });
    if (c.storeName) {
      doc.text(`Sede: ${c.storeName}`, pageW - M, M + 25, { align: 'right' });
    }

    // 🆕 Badge MAYORISTA (si aplica)
    const wInfo = getWholesaleInfo(sale);
    let extraHeaderHeight = 0;
    if (wInfo) {
      // Caja morada debajo del tipo de documento (a la derecha)
      const boxW = 85;
      const boxH = wInfo.nit ? 14 : 10;
      const boxX = pageW - M - boxW;
      const boxY = M + 30;

      doc.setFillColor(245, 235, 255); // morado muy suave
      doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'F');
      doc.setDrawColor(10, 42, 74);
      doc.setLineWidth(0.4);
      doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(10, 42, 74);
      doc.text('🏢 VENTA MAYORISTA', boxX + 4, boxY + 5.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(85, 85, 85);
      doc.text(wInfo.companyName.substring(0, 45), boxX + 4, boxY + 10);

      if (wInfo.nit) {
        doc.setFontSize(7);
        doc.setTextColor(110, 110, 115);
        doc.text(`NIT: ${wInfo.nit}`, boxX + 4, boxY + 13.5);
      }

      extraHeaderHeight = boxH + 4;
    }

    // Línea separadora (usa el max entre infoY y el badge)
    y = Math.max(infoY, M + 30 + extraHeaderHeight) + 4;

    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.6);
    doc.line(M, y, pageW - M, y);
    y += 8;

    // ============ DATOS DEL CLIENTE ============
    // Título de sección con línea decorativa
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 113, 227);
    doc.text('DATOS DEL CLIENTE', M, y);
    y += 1;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.3);
    doc.line(M, y, M + 55, y);
    y += 6;

    // Nombre del cliente en negrita y más grande
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(29, 29, 31);
    doc.text(sale.customer?.name || '-', M, y);
    y += 6;

    // Datos secundarios
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(85, 85, 85);
    if (sale.customer?.phone) { doc.text(`📞 Teléfono: ${sale.customer.phone}`, M, y); y += 4.5; }
    if (sale.customer?.email) { doc.text(`✉️ Email: ${sale.customer.email}`, M, y); y += 4.5; }
    if (sale.customer?.address) {
      const dir = sale.customer.address + (sale.customer.city ? ', ' + sale.customer.city : '');
      const dirLines = doc.splitTextToSize(`📍 Dirección: ${dir}`, CW);
      dirLines.forEach(l => { doc.text(l, M, y); y += 4.5; });
    }
    y += 4;

    // ============ TABLA DE PRODUCTOS ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 113, 227);
    doc.text('PRODUCTOS', M, y);
    y += 1;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.3);
    doc.line(M, y, M + 55, y);
    y += 6;

    const items = (sale.items || []).map(it => {
      const variantParts = [];
      if (it.colorName) variantParts.push(it.colorName);
      if (it.size) variantParts.push(it.size);

      // Marcar el producto con ⚠️ si tiene excepción
      const nameDisplay = it.priceException
        ? `⚠️ ${it.name || '-'}`
        : (it.name || '-');

      // Mostrar precio con * si tiene excepción
      const priceDisplay = it.priceException
        ? `${fmt(it.unitPrice)}*`
        : fmt(it.unitPrice);

      return [
        it.sku || '-',
        nameDisplay,
        variantParts.join(' · ') || '—',
        String(it.qty || 0),
        priceDisplay,
        fmt((it.qty || 0) * (it.unitPrice || 0))
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['SKU', 'Producto', 'Variante', 'Cant.', 'V. Unit.', 'Subtotal']],
      body: items,
      theme: 'striped',
      headStyles: {
        fillColor: [0, 113, 227],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: 3,
      },
      bodyStyles: {
        fontSize: 8.5,
        cellPadding: 3,
        textColor: [51, 51, 51],
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 22 },
        2: { cellWidth: 32 },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 26, halign: 'right' },
        5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: M, right: M },
    });

    y = doc.lastAutoTable.finalY + 8;

    // 🆕 Nota al pie sobre excepciones de precio
    if (sale.hasPriceExceptions && Array.isArray(sale.priceExceptions) && sale.priceExceptions.length) {
      const exLines = sale.priceExceptions.map(ex => {
        return `   • ${ex.name}: mín ${fmt(ex.minPrice)} → ${fmt(ex.finalPrice)} (-${fmt(Math.abs(ex.difference))}, ${ex.differencePct.toFixed(1)}%) · Autorizó: ${ex.authorizedByName || '—'} · Motivo: ${ex.reason || '—'}`;
      });

      // Caja naranja de fondo
      const headerText = '⚠️  EXCEPCIONES DE PRECIO AUTORIZADAS';
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');

      // Calcular altura necesaria
      const exWrapped = [];
      exLines.forEach(line => {
        const wrapped = doc.splitTextToSize(line, CW - 6);
        wrapped.forEach(l => exWrapped.push(l));
      });
      const boxHeight = 6 + exWrapped.length * 3.4 + 3;

      // Fondo de la caja
      doc.setFillColor(255, 249, 240);
      doc.rect(M, y - 4, CW, boxHeight, 'F');
      // Franja naranja a la izquierda
      doc.setFillColor(255, 149, 10);
      doc.rect(M, y - 4, 1.2, boxHeight, 'F');

      // Título de la caja
      doc.setTextColor(255, 149, 10);
      doc.text(headerText, M + 3, y + 1);
      y += 6;

      // Líneas de excepciones
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(85, 85, 85);
      exWrapped.forEach(l => {
        doc.text(l, M + 3, y);
        y += 3.4;
      });

      y += 5;
    }


    // ============ TOTALES ============
    const totals = [
      ['Subtotal', fmt(sale.subtotal)],
    ];
    if (sale.discount) totals.push(['Descuento', `-${fmt(sale.discount)}`]);
    if (sale.shipping) totals.push(['Envío', fmt(sale.shipping)]);
    if (sale.surchargeAmount) totals.push(['Recargo tarjeta', fmt(sale.surchargeAmount)]);

    const totalsW = 80;
    const totalsX = pageW - M - totalsW;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    totals.forEach(([label, value]) => {
      doc.text(label, totalsX, y);
      doc.text(value, pageW - M, y, { align: 'right' });
      y += 5.5;
    });

    // Línea doble y total
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.6);
    doc.line(totalsX, y, pageW - M, y);
    doc.setLineWidth(0.3);
    doc.line(totalsX, y + 1, pageW - M, y + 1);
    y += 7;

    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 113, 227);
    doc.text('TOTAL', totalsX, y);
    doc.setTextColor(29, 29, 31);
    doc.text(fmt(sale.total), pageW - M, y, { align: 'right' });
    y += 12;

    // ============ INFO DE PAGO ============
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 113, 227);
    doc.text('INFORMACIÓN DE PAGO', M, y);
    y += 1;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.3);
    doc.line(M, y, M + 55, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 51, 51);
    doc.text(`💳 Método: `, M, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sale.paymentMethod || '-'}`, M + 22, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.text(`👤 Vendedor: `, M, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sale.sellerName || sale.sellerEmail || '-'}`, M + 22, y);
    y += 10;

    // ============ GARANTÍA LEGAL (Ley 1480/2011) ============
    const garantiaText = 'GARANTÍA LEGAL: Los productos cuentan con la garantía legal mínima establecida en la Ley 1480 de 2011 (Estatuto del Consumidor) y con la garantía adicional otorgada por el fabricante, la cual puede ser superior. La garantía cubre defectos de fábrica y no cubre daños por mal uso, golpes, líquidos o manipulación indebida. Para hacerla efectiva, presente este documento junto con el producto.';

    doc.setFillColor(245, 247, 250);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const garantiaLines = doc.splitTextToSize(garantiaText, CW - 8);
    const garantiaH = (garantiaLines.length * 3.8) + 8;

    doc.rect(M, y, CW, garantiaH, 'F');
    doc.setFillColor(0, 113, 227);
    doc.rect(M, y, 1.5, garantiaH, 'F');

    doc.setTextColor(85, 85, 85);
    doc.text(garantiaLines, M + 5, y + 5);
    y += garantiaH + 12;

    // ============ FIRMAS ============
    if (y > pageH - 50) {
      doc.addPage();
      y = M;
    }

    const firmaW = (pageW - 3 * M) / 2;
    const firmaY = y + 15;

    // Firma cliente
    doc.setDrawColor(51, 51, 51);
    doc.setLineWidth(0.3);
    doc.line(M, firmaY, M + firmaW, firmaY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 115);
    doc.text('FIRMA DEL CLIENTE', M + firmaW / 2, firmaY + 4, { align: 'center' });
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(sale.customer?.name || '', M + firmaW / 2, firmaY + 8, { align: 'center' });

    // Firma vendedor
    const firma2X = pageW - M - firmaW;
    doc.setDrawColor(51, 51, 51);
    doc.setLineWidth(0.3);
    doc.line(firma2X, firmaY, firma2X + firmaW, firmaY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 115);
    doc.text('FIRMA DEL VENDEDOR', firma2X + firmaW / 2, firmaY + 4, { align: 'center' });
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(sale.sellerName || sale.sellerEmail || '', firma2X + firmaW / 2, firmaY + 8, { align: 'center' });

    // ============ FOOTER ============
    const footerY = pageH - 14;

    // Línea decorativa antes del footer
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.3);
    doc.line(M, footerY - 3, pageW - M, footerY - 3);

    // Fila 1: WhatsApp + Email
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(85, 85, 85);

    const contactParts = [];
    if (c.phone) contactParts.push(`📞 ${c.phone}`);
    if (c.email) contactParts.push(`✉️ ${c.email}`);
    if (contactParts.length) {
      doc.text(contactParts.join('  ·  '), pageW / 2, footerY, { align: 'center' });
    }

    // Fila 2: Nota legal
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    const footerText = `Este documento no constituye factura electrónica de venta · ${c.razonSocial || 'Smartec'} · NIT ${c.nit}`;
    doc.text(footerText, pageW / 2, footerY + 4, { align: 'center' });

    // ============ DEVOLVER BLOB ============
    const blob = doc.output('blob');
    return blob;
  }

  /* ============================================================
     2. PDF TIRILLA (58mm de ancho × alto variable)
  ============================================================ */
  async function generateTirillaPDF(sale, settings) {
    const jsPDF = await _getJsPDF();
    const c = getCompanyInfo(sale, settings);
    const docNumber = sale.documentNumber || 'SIN-NÚMERO';

    // Ancho 80mm, alto estimado (se ajusta al final)
    const W = 80;
    const H = 250;
    const doc = new jsPDF('p', 'mm', [W, H]);
    const M = 2.5;              // margen lateral
    const CW = W - 2 * M;       // ancho útil
    let y = 5;

    const dateStr = fmtDateShort(sale.createdAt);
    const timeStr = fmtTime(sale.createdAt);

    // Helper para centrar
    const centerText = (txt, yy, opts = {}) => {
      doc.text(String(txt), W / 2, yy, { align: 'center', ...opts });
    };

    // Helper para línea punteada
    const dashedLine = (yy) => {
      doc.setLineDashPattern([1, 1], 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.15);
      doc.line(M, yy, W - M, yy);
      doc.setLineDashPattern([], 0);
    };

    // Helper para línea sólida
    const solidLine = (yy, width = 0.4) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(width);
      doc.line(M, yy, W - M, yy);
    };

    // 🆕 Helper para línea doble (separa secciones importantes)
    const doubleLine = (yy) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.line(M, yy, W - M, yy);
      doc.setLineWidth(0.3);
      doc.line(M, yy + 0.8, W - M, yy + 0.8);
      return yy + 0.8;
    };

    // ============================================================
    // 🏢 ENCABEZADO
    // ============================================================
    // Barra superior decorativa
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, W, 1.2, 'F');
    y = 6;

    // Nombre SMARTEC grande
    doc.setFont('courier', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    centerText('SMARTEC', y);
    y += 6;

    // Doble línea inferior
    y = doubleLine(y);
    y += 4;

    // Razón social + NIT
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    if (c.razonSocial) {
      const rsLines = doc.splitTextToSize(c.razonSocial, CW);
      rsLines.forEach(l => { centerText(l, y); y += 3.5; });
    }
    centerText(`NIT: ${c.nit}`, y);
    y += 3.5;

    if (c.address) {
      const addrLines = doc.splitTextToSize(c.address, CW);
      addrLines.forEach(l => { centerText(l, y); y += 3; });
    }
    if (c.phone) {
      centerText(`Tel: ${c.phone}`, y);
      y += 3;
    }
    if (c.email) {
      const emLines = doc.splitTextToSize(c.email, CW);
      emLines.forEach(l => { centerText(l, y); y += 3; });
    }

    y += 2;
    dashedLine(y);
    y += 4;

    // ============================================================
    // 🧾 TIPO DE DOCUMENTO (con recuadro)
    // ============================================================
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    const boxH = 6;
    doc.rect(M + 4, y - 4, CW - 8, boxH, 'S');

    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    centerText('COMPROBANTE DE VENTA', y);
    y += 6;

    // Número y fecha
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    centerText(`No. ${docNumber}`, y);
    y += 4;

    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    centerText(`${dateStr}  ·  ${timeStr}`, y);
    y += 3.5;

    if (c.storeName) {
      centerText(`Sede: ${c.storeName}`, y);
      y += 3.5;
    }

    // 🆕 Badge MAYORISTA (si aplica)
    const wInfo = getWholesaleInfo(sale);
    if (wInfo) {
      y += 1;
      solidLine(y);
      y += 4;

      doc.setFont('courier', 'bold');
      doc.setFontSize(9);
      centerText('** VENTA MAYORISTA **', y);
      y += 4;

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      const companyLines = doc.splitTextToSize(wInfo.companyName, CW);
      companyLines.forEach(l => { centerText(l, y); y += 3.2; });

      if (wInfo.nit) {
        centerText(`NIT: ${wInfo.nit}`, y);
        y += 3.2;
      }
      if (wInfo.discountBase > 0) {
        centerText(`Desc. aplicado: -${(wInfo.discountBase * 100).toFixed(1)}%`, y);
        y += 3.2;
      }
    }

    y += 2;
    dashedLine(y);
    y += 4;

    // ============================================================
    // 👤 CLIENTE
    // ============================================================
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.text('CLIENTE', M, y);
    y += 3.5;

    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    const nameLines = doc.splitTextToSize(sale.customer?.name || '-', CW);
    nameLines.forEach(l => { doc.text(l, M, y); y += 3.2; });

    if (sale.customer?.phone) {
      doc.text(`Tel: ${sale.customer.phone}`, M, y);
      y += 3.2;
    }
    if (sale.customer?.address) {
      const addrLines = doc.splitTextToSize(sale.customer.address, CW);
      addrLines.forEach(l => { doc.text(l, M, y); y += 3.2; });
    }

    y += 1;
    dashedLine(y);
    y += 4;

    // ============================================================
    // 📦 PRODUCTOS
    // ============================================================
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.text('PRODUCTOS', M, y);
    y += 3.5;

    // Encabezado de columnas (referencia visual)
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.text('Descripción', M, y);
    doc.text('Importe', W - M, y, { align: 'right' });
    y += 1;
    dashedLine(y);
    y += 3.5;

    (sale.items || []).forEach(it => {
      // Nombre del producto (con ! si tiene excepción)
      const nameDisplay = it.priceException
        ? `! ${it.name || '-'}`
        : (it.name || '-');

      const nameLines = doc.splitTextToSize(nameDisplay, CW);
      nameLines.forEach(l => {
        doc.setFont('courier', 'bold');
        doc.setFontSize(8);
        doc.text(l, M, y);
        y += 3.3;
      });

      // Variante (color / tamaño)
      const variantParts = [];
      if (it.colorName) variantParts.push(it.colorName);
      if (it.size) variantParts.push(it.size);
      if (variantParts.length) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(6.5);
        doc.text(`   ${variantParts.join(' · ')}`, M, y);
        y += 3;
      }

      // Cantidad × Precio + Subtotal
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      const left = `   ${it.qty} × ${fmt(it.unitPrice)}`;
      const right = fmt((it.qty || 0) * (it.unitPrice || 0));
      doc.text(left, M, y);
      doc.setFont('courier', 'bold');
      doc.text(right, W - M, y, { align: 'right' });
      y += 4;

      // Nota de excepción de precio
      if (it.priceException) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(6);
        doc.text(`   (precio autorizado: min ${fmt(it.priceException.minPrice)})`, M, y);
        y += 2.8;
      }

      // Pequeño espacio entre productos
      y += 1;
    });

    y += 1;
    dashedLine(y);
    y += 4;

    // Aviso general de excepciones
    if (sale.hasPriceExceptions && Array.isArray(sale.priceExceptions) && sale.priceExceptions.length) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(6.5);
      const warnLines = doc.splitTextToSize(
        '! PRECIO AUTORIZADO POR ADMINISTRADOR',
        CW
      );
      warnLines.forEach(l => { centerText(l, y); y += 3; });
      y += 1;
      dashedLine(y);
      y += 4;
    }

    // ============================================================
    // 💰 TOTALES
    // ============================================================
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    const addRow = (label, value, bold = false) => {
      doc.setFont('courier', bold ? 'bold' : 'normal');
      doc.text(label, M + 4, y);
      doc.text(value, W - M - 4, y, { align: 'right' });
      y += 4;
    };

    addRow('Subtotal', fmt(sale.subtotal));
    if (sale.discount) addRow('Descuento', `-${fmt(sale.discount)}`);
    if (sale.shipping) addRow('Envío', fmt(sale.shipping));
    if (sale.surchargeAmount) addRow('Rec. tarjeta', fmt(sale.surchargeAmount));

    y += 1;
    y = doubleLine(y);
    y += 6;

    // TOTAL destacado
    doc.setFont('courier', 'bold');
    doc.setFontSize(13);
    centerText(`TOTAL   ${fmt(sale.total)}`, y);
    y += 6;

    y = doubleLine(y);
    y += 5;

    // ============================================================
    // 💳 PAGO
    // ============================================================
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Pago:     ${sale.paymentMethod || '-'}`, M, y);
    y += 3.5;
    const seller = (sale.sellerName || sale.sellerEmail || '-').substring(0, 24);
    doc.text(`Vendedor: ${seller}`, M, y);
    y += 4;

    // Notas del cliente
    if (sale.customer?.notes) {
      dashedLine(y);
      y += 4;
      doc.setFontSize(6.5);
      const notesLines = doc.splitTextToSize(`Nota: ${sale.customer.notes}`, CW);
      notesLines.forEach(l => { doc.text(l, M, y); y += 3; });
      y += 1;
    }

    // ============================================================
    // 🛡️ GARANTÍA (genérica + ley 1480)
    // ============================================================
    y += 1;
    dashedLine(y);
    y += 4;

    doc.setFont('courier', 'bold');
    doc.setFontSize(7);
    centerText('GARANTÍA', y);
    y += 3;

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    const garantiaText = 'Aplica la garantía legal mínima del producto (Ley 1480 de 2011). Conserve este recibo para hacerla efectiva.';
    const gLines = doc.splitTextToSize(garantiaText, CW);
    gLines.forEach(l => { doc.text(l, M, y); y += 3; });

    y += 2;
    y = doubleLine(y);
    y += 5;

    // ============================================================
    // 🙏 CIERRE
    // ============================================================
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    centerText('¡GRACIAS POR SU COMPRA!', y);
    y += 5;

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    centerText('Este documento no es factura electrónica de venta.', y);
    y += 4;

    // ============================================================
    // 🖼️ LOGO AL FINAL (logoUrl → faviconUrl → nada)
    // ============================================================
    const logoUrl = settings.logoUrl || settings.faviconUrl || null;
    if (logoUrl) {
      try {
        const imgData = await loadImageAsDataURL(logoUrl);
        if (imgData) {
          // Cargar la imagen como elemento para conocer proporciones
          const probe = await loadImageElement(logoUrl);
          let finalW = 30;
          let finalH = 30;

          if (probe && probe.naturalWidth && probe.naturalHeight) {
            const ratio = probe.naturalWidth / probe.naturalHeight;
            if (ratio > 1) {
              // Horizontal
              finalH = 30 / ratio;
            } else {
              // Vertical o cuadrada
              finalW = 30 * ratio;
            }
          }

          const finalX = (W - finalW) / 2;
          doc.addImage(imgData, 'PNG', finalX, y, finalW, finalH);
          y += finalH + 3;
        }
      } catch (e) {
        console.warn('[PDF] No se pudo agregar el logo a la tirilla:', e);
      }
    }

    // ============================================================
    // 📞 PIE DE PÁGINA
    // ============================================================
    y += 1;
    solidLine(y);
    y += 4;

    doc.setFont('courier', 'normal');
    doc.setFontSize(7);

    if (c.phone) {
      centerText(`WhatsApp / Tel: ${c.phone}`, y);
      y += 3.2;
    }
    if (c.email) {
      centerText(c.email, y);
      y += 3.2;
    }

    // ============================================================
    // ✂️ RECORTAR ALTO REAL
    // ============================================================
    const realH = y + 3;
    doc.internal.pageSize.height = realH;

    const blob = doc.output('blob');
    return blob;
  }

  /* ============================================================
     🆕 HELPERS AUXILIARES — Carga de imágenes para jsPDF
  ============================================================ */
  function loadImageElement(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function loadImageAsDataURL(url) {
    try {
      const img = await loadImageElement(url);
      if (!img) return null;

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[PDF] Error convirtiendo imagen a DataURL:', e);
      return null;
    }
  }

  /* ============================================================
     3. PDF MEDIA CARTA (140×216mm)
  ============================================================ */
  async function generateMediaCartaPDF(sale, settings) {
    const jsPDF = await _getJsPDF();
    const doc = new jsPDF('p', 'mm', [140, 216]);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 10;
    const CW = pageW - 2 * M;   // ancho útil

    const c = getCompanyInfo(sale, settings);
    const docNumber = sale.documentNumber || 'SIN-NÚMERO';

    let y = M;

    // ===== Helpers locales =====
    const dashedLine = (yy, x1 = M, x2 = pageW - M) => {
      doc.setLineDashPattern([1, 1], 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.15);
      doc.line(x1, yy, x2, yy);
      doc.setLineDashPattern([], 0);
    };

    const solidLine = (yy, x1 = M, x2 = pageW - M, width = 0.4) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(width);
      doc.line(x1, yy, x2, yy);
    };

    // Barra azul superior
    doc.setFillColor(0, 113, 227);
    doc.rect(0, 0, pageW, 3, 'F');

    // 🆕 Logo (imagen) o texto SMARTEC como respaldo
    const logoUrl = settings.logoUrl || settings.faviconUrl || null;
    let logoRendered = false;

    if (logoUrl) {
      try {
        const imgData = await loadImageAsDataURL(logoUrl);
        if (imgData) {
          const probe = await loadImageElement(logoUrl);
          let logoW = 40;
          let logoH = 11;

          if (probe && probe.naturalWidth && probe.naturalHeight) {
            const ratio = probe.naturalWidth / probe.naturalHeight;
            logoH = 11;
            logoW = logoH * ratio;
            if (logoW > 45) {
              logoW = 45;
              logoH = logoW / ratio;
            }
          }

          doc.addImage(imgData, 'PNG', M, y + 2, logoW, logoH);
          logoRendered = true;
          y += logoH + 3;
        }
      } catch (e) {
        console.warn('[PDF] No se pudo agregar logo a media carta:', e);
      }
    }

    if (!logoRendered) {
      // Respaldo: texto SMARTEC
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(0, 113, 227);
      doc.text('SMART', M, y + 6);
      const smartWidth = doc.getTextWidth('SMART');
      doc.setTextColor(29, 29, 31);
      doc.text('EC', M + smartWidth, y + 6);
      y += 10;
    }

    // Razón social (debajo del logo)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(29, 29, 31);
    doc.text((c.razonSocial || '').toUpperCase(), M, y);
    y += 3.5;

    // Info empresa
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(85, 85, 85);
    doc.text(`NIT: ${c.nit}${c.regimen ? ' · ' + c.regimen : ''}`, M, y);
    y += 3.5;
    if (c.address) { doc.text(c.address, M, y); y += 3.5; }
    if (c.phone) { doc.text(`Tel: ${c.phone}`, M, y); y += 3.5; }
    if (c.email) { doc.text(`Email: ${c.email}`, M, y); y += 3.5; }

    let infoY = y;

    // Tipo doc (derecha)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(29, 29, 31);
    doc.text('DOC. COMERCIAL', pageW - M, M + 6, { align: 'right' });

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`No. ${docNumber}`, pageW - M, M + 12, { align: 'right' });

    doc.setFontSize(7);
    doc.setTextColor(110, 110, 115);
    doc.text(fmtDate(sale.createdAt), pageW - M, M + 16.5, { align: 'right' });
    if (c.storeName) {
      doc.text(`Sede: ${c.storeName}`, pageW - M, M + 20.5, { align: 'right' });
    }

    // 🆕 Badge MAYORISTA (si aplica)
    const wInfo = getWholesaleInfo(sale);
    let extraHeaderHeight = 0;
    if (wInfo) {
      const boxW = 60;
      const boxH = wInfo.nit ? 12 : 8;
      const boxX = pageW - M - boxW;
      const boxY = M + 24;

      doc.setFillColor(245, 235, 255);
      doc.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5, 'F');
      doc.setDrawColor(10, 42, 74);
      doc.setLineWidth(0.3);
      doc.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(10, 42, 74);
      doc.text('🏢 MAYORISTA', boxX + 3, boxY + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(85, 85, 85);
      doc.text(wInfo.companyName.substring(0, 32), boxX + 3, boxY + 8.5);

      if (wInfo.nit) {
        doc.setFontSize(6);
        doc.setTextColor(110, 110, 115);
        doc.text(`NIT: ${wInfo.nit}`, boxX + 3, boxY + 11.5);
      }

      extraHeaderHeight = boxH + 4;
    }

    // Línea separadora (usa el max entre infoY y el badge)
    y = Math.max(infoY, M + 24 + extraHeaderHeight) + 4;

    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.5);
    doc.line(M, y, pageW - M, y);
    y += 6;

    // ============ CLIENTE ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 113, 227);
    doc.text('CLIENTE', M, y);
    y += 1;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.2);
    doc.line(M, y, M + 25, y);
    y += 5;

    // Nombre del cliente en negrita
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(29, 29, 31);
    doc.text(sale.customer?.name || '-', M, y);
    y += 5;

    // Datos secundarios
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(85, 85, 85);
    if (sale.customer?.phone) { doc.text(`📞 ${sale.customer.phone}`, M, y); y += 3.8; }
    if (sale.customer?.email) { doc.text(`✉️ ${sale.customer.email}`, M, y); y += 3.8; }
    if (sale.customer?.address) {
      const dir = sale.customer.address + (sale.customer.city ? ', ' + sale.customer.city : '');
      const dirLines = doc.splitTextToSize(`📍 ${dir}`, CW);
      dirLines.forEach(l => { doc.text(l, M, y); y += 3.8; });
    }
    y += 3;

    // ============ TABLA DE PRODUCTOS ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 113, 227);
    doc.text('PRODUCTOS', M, y);
    y += 1;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.25);
    doc.line(M, y, M + 30, y);
    y += 5;

    const items = (sale.items || []).map(it => {
      const variantParts = [];
      if (it.colorName) variantParts.push(it.colorName);
      if (it.size) variantParts.push(it.size);

      const nameBase = (it.name || '-') + (variantParts.length ? '\n' + variantParts.join(' · ') : '');
      const name = it.priceException ? `⚠️ ${nameBase}` : nameBase;

      // Precio con * si tiene excepción
      const priceDisplay = it.priceException
        ? `${fmt(it.unitPrice)}*`
        : fmt(it.unitPrice);

      return [
        it.sku || '-',
        name,
        String(it.qty || 0),
        priceDisplay,
        fmt((it.qty || 0) * (it.unitPrice || 0))
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['SKU', 'Producto', 'Cant.', 'V. Unit.', 'Subtotal']],
      body: items,
      theme: 'striped',
      headStyles: {
        fillColor: [0, 113, 227],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 7.5,
        cellPadding: 2,
      },
      bodyStyles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [51, 51, 51],
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 20 },
        2: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 20, halign: 'right' },
        4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: M, right: M },
    });

    y = doc.lastAutoTable.finalY + 6;

    // 🆕 Nota de excepciones de precio
    if (sale.hasPriceExceptions && Array.isArray(sale.priceExceptions) && sale.priceExceptions.length) {
      const exLines = sale.priceExceptions.map(ex =>
        `   • ${ex.name}: mín ${fmt(ex.minPrice)} → ${fmt(ex.finalPrice)} · Autorizó: ${ex.authorizedByName || '—'}`
      );

      // Caja naranja con franja lateral
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);

      const exWrapped = [];
      exLines.forEach(line => {
        const wrapped = doc.splitTextToSize(line, CW - 6);
        wrapped.forEach(l => exWrapped.push(l));
      });
      const boxHeight = 5 + exWrapped.length * 3.2 + 3;

      // Fondo de la caja
      doc.setFillColor(255, 249, 240);
      doc.rect(M, y - 3, CW, boxHeight, 'F');
      // Franja naranja a la izquierda
      doc.setFillColor(255, 149, 10);
      doc.rect(M, y - 3, 1.2, boxHeight, 'F');

      // Título
      doc.setTextColor(255, 149, 10);
      doc.text('⚠️  EXCEPCIONES DE PRECIO', M + 3, y + 1);
      y += 5;

      // Líneas
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(85, 85, 85);
      exWrapped.forEach(l => {
        doc.text(l, M + 3, y);
        y += 3.2;
      });

      y += 4;
    }

    // ============ TOTALES ============
    const totalsW = 70;
    const totalsX = pageW - M - totalsW;

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);

    const addRow = (label, value) => {
      doc.text(label, totalsX, y);
      doc.text(value, pageW - M, y, { align: 'right' });
      y += 4.5;
    };

    addRow('Subtotal', fmt(sale.subtotal));
    if (sale.discount) addRow('Descuento', `-${fmt(sale.discount)}`);
    if (sale.shipping) addRow('Envío', fmt(sale.shipping));
    if (sale.surchargeAmount) addRow('Rec. tarjeta', fmt(sale.surchargeAmount));

    // Línea doble
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.5);
    doc.line(totalsX, y, pageW - M, y);
    doc.setLineWidth(0.25);
    doc.line(totalsX, y + 1, pageW - M, y + 1);
    y += 6;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 113, 227);
    doc.text('TOTAL', totalsX, y);
    doc.setTextColor(29, 29, 31);
    doc.text(fmt(sale.total), pageW - M, y, { align: 'right' });
    y += 10;

    // ============ PAGO ============
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    doc.text(`💳 Pago: `, M, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sale.paymentMethod || '-'}`, M + 14, y);
    y += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.text(`👤 Vendedor: `, M, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sale.sellerName || sale.sellerEmail || '-'}`, M + 22, y);
    y += 8;

    // ============ GARANTÍA LEGAL (Ley 1480/2011) ============
    const garantiaText = 'GARANTÍA LEGAL: Los productos cuentan con la garantía legal mínima establecida en la Ley 1480 de 2011 (Estatuto del Consumidor) y con la garantía adicional otorgada por el fabricante, la cual puede ser superior. La garantía cubre defectos de fábrica y no cubre daños por mal uso, golpes, líquidos o manipulación indebida. Para hacerla efectiva, presente este documento junto con el producto.';

    doc.setFillColor(245, 247, 250);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const lines = doc.splitTextToSize(garantiaText, CW - 6);
    const gH = lines.length * 3.3 + 6;

    doc.rect(M, y, CW, gH, 'F');
    doc.setFillColor(0, 113, 227);
    doc.rect(M, y, 1.2, gH, 'F');

    doc.setTextColor(85, 85, 85);
    doc.text(lines, M + 4, y + 4);
    y += gH + 10;

    // ============ FIRMAS ============
    if (y > pageH - 45) {
      doc.addPage();
      y = M;
    }

    const firmaW = (pageW - 3 * M) / 2;
    const firmaY = y + 12;

    // Firma cliente
    doc.setDrawColor(51, 51, 51);
    doc.setLineWidth(0.3);
    doc.line(M, firmaY, M + firmaW, firmaY);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 115);
    doc.text('FIRMA DEL CLIENTE', M + firmaW / 2, firmaY + 3.5, { align: 'center' });
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(sale.customer?.name || '', M + firmaW / 2, firmaY + 7, { align: 'center' });

    // Firma vendedor
    const firma2X = pageW - M - firmaW;
    doc.setDrawColor(51, 51, 51);
    doc.setLineWidth(0.3);
    doc.line(firma2X, firmaY, firma2X + firmaW, firmaY);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 115);
    doc.text('FIRMA DEL VENDEDOR', firma2X + firmaW / 2, firmaY + 3.5, { align: 'center' });
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(sale.sellerName || sale.sellerEmail || '', firma2X + firmaW / 2, firmaY + 7, { align: 'center' });

    // ============ FOOTER ============
    const footerY = pageH - 12;

    // Línea decorativa antes del footer
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.25);
    doc.line(M, footerY - 3, pageW - M, footerY - 3);

    // Fila 1: WhatsApp + Email
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(85, 85, 85);

    const contactParts = [];
    if (c.phone) contactParts.push(`📞 ${c.phone}`);
    if (c.email) contactParts.push(`✉️ ${c.email}`);
    if (contactParts.length) {
      doc.text(contactParts.join('  ·  '), pageW / 2, footerY, { align: 'center' });
    }

    // Fila 2: Nota legal
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    const footerText = `Este documento no constituye factura electrónica de venta · ${c.razonSocial || 'Smartec'} · NIT ${c.nit}`;
    doc.text(footerText, pageW / 2, footerY + 3.5, { align: 'center' });

    // ============ DEVOLVER BLOB ============
    const blob = doc.output('blob');
    return blob;
  }

  /* ============================================================
     4. ORQUESTADOR: Generar y subir los 3 PDFs
  ============================================================ */
  async function generateAndUploadAll(sale, settings, ctx) {
    const { storage, ref, uploadBytes, getDownloadURL, db, doc, updateDoc, serverTimestamp } = ctx;

    if (!sale || !sale.id || !sale.storeId) {
      throw new Error('Faltan datos de la venta (id, storeId)');
    }

    const storeId = sale.storeId;
    const saleId = sale.id;
    const basePath = `documents/${storeId}/${saleId}`;

    console.log('[PDF] Generando documentos para venta', saleId);

    // Generar los 3 PDFs en paralelo
    const [remisionBlob, tirillaBlob, mediacartaBlob] = await Promise.all([
      generateRemisionPDF(sale, settings),
      generateTirillaPDF(sale, settings),
      generateMediaCartaPDF(sale, settings),
    ]);

    console.log('[PDF] 3 PDFs generados. Subiendo a Storage...');

    // Subir cada uno
    const uploadOne = async (blob, filename) => {
      const fileRef = ref(storage, `${basePath}/${filename}`);
      await uploadBytes(fileRef, blob, { contentType: 'application/pdf' });
      const url = await getDownloadURL(fileRef);
      return { url, size: blob.size };
    };

    const [remision, tirilla, mediacarta] = await Promise.all([
      uploadOne(remisionBlob, 'remision.pdf'),
      uploadOne(tirillaBlob, 'tirilla.pdf'),
      uploadOne(mediacartaBlob, 'mediacarta.pdf'),
    ]);

    console.log('[PDF] PDFs subidos. Guardando URLs en Firestore...');

    // Guardar en el doc de la venta
    await updateDoc(doc(db, 'sales', saleId), {
      documents: {
        remision: { ...remision, uploadedAt: serverTimestamp() },
        tirilla: { ...tirilla, uploadedAt: serverTimestamp() },
        mediacarta: { ...mediacarta, uploadedAt: serverTimestamp() },
      },
      documentsUploadedAt: serverTimestamp(),
    });

    console.log('[PDF] ✅ Documentos guardados en la venta');

    return { remision, tirilla, mediacarta };
  }

  /* ============================================================
     API PÚBLICA
  ============================================================ */
  window.SmartecPdf = {
    generateRemisionPDF,
    generateTirillaPDF,
    generateMediaCartaPDF,
    generateAndUploadAll,
  };

  console.log('[Smartec] pdf-generator.js cargado');
})();