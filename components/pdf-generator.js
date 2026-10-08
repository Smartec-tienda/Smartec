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

  const { jsPDF } = window.jspdf || {};

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
    const doc = new jsPDF('p', 'mm', 'letter');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 15; // margen

    const c = getCompanyInfo(sale, settings);
    const docNumber = sale.documentNumber || 'SIN-NÚMERO';

    let y = M;

    // ============ CABECERA ============
    // Barra azul superior
    doc.setFillColor(0, 113, 227);
    doc.rect(0, 0, pageW, 4, 'F');

    // Logo / título SMARTEC
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(0, 113, 227);
    doc.text('SMART', M, y + 8);
    const smartWidth = doc.getTextWidth('SMART');
    doc.setTextColor(29, 29, 31);
    doc.text('EC', M + smartWidth, y + 8);

    // Razón social
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 115);
    doc.text((c.razonSocial || '').toUpperCase(), M, y + 14);

    // Info empresa (izquierda)
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    let infoY = y + 20;
    doc.text(`NIT: ${c.nit}${c.regimen ? ' · ' + c.regimen : ''}`, M, infoY);
    if (c.address) { infoY += 4; doc.text(c.address, M, infoY); }
    if (c.phone) { infoY += 4; doc.text(`Tel: ${c.phone}`, M, infoY); }
    if (c.email) { infoY += 4; doc.text(`Email: ${c.email}`, M, infoY); }

    // Tipo de documento (derecha)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(29, 29, 31);
    doc.text('REMISIÓN', pageW - M, y + 8, { align: 'right' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`No. ${docNumber}`, pageW - M, y + 14, { align: 'right' });

    doc.setFontSize(8);
    doc.setTextColor(110, 110, 115);
    doc.text(fmtDate(sale.createdAt), pageW - M, y + 19, { align: 'right' });
    if (c.storeName) {
      doc.text(`Sede: ${c.storeName}`, pageW - M, y + 24, { align: 'right' });
    }

    // 🆕 Badge MAYORISTA (si aplica)
    const wInfo = getWholesaleInfo(sale);
    let extraHeaderHeight = 0;
    if (wInfo) {
      // Caja morada debajo del tipo de documento
      const boxW = 85;
      const boxH = wInfo.nit ? 14 : 10;
      const boxX = pageW - M - boxW;
      const boxY = y + 28;

      doc.setFillColor(245, 235, 255); // morado muy suave
      doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'F');
      doc.setDrawColor(191, 90, 242);   // borde morado
      doc.setLineWidth(0.4);
      doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(191, 90, 242);
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

      extraHeaderHeight = boxH + 2;
    }

    // Línea separadora
    y = Math.max(infoY, y + 26) + 4 + extraHeaderHeight;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.5);
    doc.line(M, y, pageW - M, y);
    y += 6;

    // ============ DATOS DEL CLIENTE ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 113, 227);
    doc.text('DATOS DEL CLIENTE', M, y);
    y += 1;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.2);
    doc.line(M, y, M + 45, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(29, 29, 31);
    doc.text(sale.customer?.name || '-', M, y);
    y += 5;

    doc.setFontSize(9);
    doc.setTextColor(85, 85, 85);
    if (sale.customer?.phone) { doc.text(`Teléfono: ${sale.customer.phone}`, M, y); y += 4; }
    if (sale.customer?.email) { doc.text(`Email: ${sale.customer.email}`, M, y); y += 4; }
    if (sale.customer?.address) {
      const dir = sale.customer.address + (sale.customer.city ? ', ' + sale.customer.city : '');
      doc.text(`Dirección: ${dir}`, M, y);
      y += 4;
    }
    y += 4;

    // ============ TABLA DE PRODUCTOS ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 113, 227);
    doc.text('PRODUCTOS', M, y);
    y += 1;
    doc.line(M, y, M + 30, y);
    y += 4;

    const items = (sale.items || []).map(it => {
      const variantParts = [];
      if (it.colorName) variantParts.push(it.colorName);
      if (it.size) variantParts.push(it.size);

      // 🆕 Marcar el producto con ⚠️ si tiene excepción
      const nameDisplay = it.priceException
        ? `⚠️ ${it.name || '-'}`
        : (it.name || '-');

      // 🆕 Mostrar precio de lista tachado si hay excepción
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
        fontSize: 8,
        cellPadding: 2.5,
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 2.5,
        textColor: [51, 51, 51],
      },
      alternateRowStyles: {
        fillColor: [250, 251, 252],
      },
      columnStyles: {
        0: { cellWidth: 22 },
        2: { cellWidth: 30 },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: M, right: M },
    });

    
    y = doc.lastAutoTable.finalY + 8;
    y = doc.lastAutoTable.finalY + 8;

    // 🆕 Nota al pie sobre excepciones de precio
    if (sale.hasPriceExceptions && Array.isArray(sale.priceExceptions) && sale.priceExceptions.length) {
      const exLines = sale.priceExceptions.map(ex => {
        return `   • ${ex.name}: mín ${fmt(ex.minPrice)} → ${fmt(ex.finalPrice)} (-${fmt(Math.abs(ex.difference))}, ${ex.differencePct.toFixed(1)}%) · Autorizó: ${ex.authorizedByName || '—'} · Motivo: ${ex.reason || '—'}`;
      });

      const headerText = '⚠️ EXCEPCIONES DE PRECIO AUTORIZADAS:';
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 149, 10); // naranja
      doc.text(headerText, M, y);
      y += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      exLines.forEach(line => {
        const wrapped = doc.splitTextToSize(line, pageW - 2 * M);
        wrapped.forEach(l => {
          doc.text(l, M, y);
          y += 3.2;
        });
      });
      y += 3;
    }


    // ============ TOTALES ============
    const totals = [
      ['Subtotal', fmt(sale.subtotal)],
    ];
    if (sale.discount) totals.push(['Descuento', `-${fmt(sale.discount)}`]);
    if (sale.shipping) totals.push(['Envío', fmt(sale.shipping)]);
    if (sale.surchargeAmount) totals.push(['Recargo tarjeta', fmt(sale.surchargeAmount)]);

    const totalsW = 70;
    const totalsX = pageW - M - totalsW;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    totals.forEach(([label, value]) => {
      doc.text(label, totalsX, y);
      doc.text(value, pageW - M, y, { align: 'right' });
      y += 5;
    });

    // Línea y total
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.5);
    doc.line(totalsX, y, pageW - M, y);
    y += 6;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 113, 227);
    doc.text('TOTAL', totalsX, y);
    doc.setTextColor(29, 29, 31);
    doc.text(fmt(sale.total), pageW - M, y, { align: 'right' });
    y += 10;

    // ============ INFO DE PAGO ============
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 113, 227);
    doc.text('INFORMACIÓN DE PAGO', M, y);
    y += 1;
    doc.line(M, y, M + 45, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    doc.text(`Método: ${sale.paymentMethod || '-'}`, M, y);
    y += 4;
    doc.text(`Vendedor: ${sale.sellerName || sale.sellerEmail || '-'}`, M, y);
    y += 8;

    // ============ GARANTÍA ============
    const garantiaText = 'GARANTÍA: Todos los productos cuentan con garantía mínima de 12 meses o la superior otorgada por el fabricante. La garantía cubre defectos de fábrica y no cubre daños por mal uso, golpes, líquidos o manipulación indebida. Para hacer efectiva la garantía, presente este documento junto con el producto.';

    doc.setFillColor(245, 247, 250);
    const garantiaLines = doc.splitTextToSize(garantiaText, pageW - 2 * M - 6);
    const garantiaH = (garantiaLines.length * 3.5) + 6;
    doc.rect(M, y, pageW - 2 * M, garantiaH, 'F');
    doc.setFillColor(0, 113, 227);
    doc.rect(M, y, 1.5, garantiaH, 'F');

    doc.setFontSize(7.5);
    doc.setTextColor(85, 85, 85);
    doc.text(garantiaLines, M + 4, y + 4);
    y += garantiaH + 12;

    // ============ FIRMAS ============
    if (y > pageH - 40) {
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
    doc.setTextColor(110, 110, 115);
    doc.text('FIRMA DEL CLIENTE', M + firmaW / 2, firmaY + 4, { align: 'center' });

    // Firma vendedor
    const firma2X = pageW - M - firmaW;
    doc.line(firma2X, firmaY, firma2X + firmaW, firmaY);
    doc.text('FIRMA DEL VENDEDOR', firma2X + firmaW / 2, firmaY + 4, { align: 'center' });

    // ============ FOOTER ============
    const footerText = `Este documento no constituye factura electrónica de venta. Smartec · ${c.nit}`;
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(footerText, pageW / 2, pageH - 8, { align: 'center' });

    // ============ DEVOLVER BLOB ============
    const blob = doc.output('blob');
    return blob;
  }

  /* ============================================================
     2. PDF TIRILLA (58mm de ancho × alto variable)
  ============================================================ */
  async function generateTirillaPDF(sale, settings) {
    const c = getCompanyInfo(sale, settings);
    const docNumber = sale.documentNumber || 'SIN-NÚMERO';

    // Ancho 58mm, alto estimado (se ajusta después)
    const W = 58;
    const H = 200; // alto inicial, se recorta al final
    const doc = new jsPDF('p', 'mm', [W, H]);
    const M = 3;
    let y = M;

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
      doc.setLineWidth(0.2);
      doc.line(M, yy, W - M, yy);
      doc.setLineDashPattern([], 0);
    };

    // Helper para línea sólida
    const solidLine = (yy) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.4);
      doc.line(M, yy, W - M, yy);
    };

    // ============ CABECERA ============
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    centerText('SMARTEC', y + 4);
    y += 6;

    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    if (c.razonSocial) { centerText(c.razonSocial, y + 3); y += 4; }
    centerText(`NIT: ${c.nit}`, y + 3);
    y += 4;
    if (c.address) {
      const addrLines = doc.splitTextToSize(c.address, W - 2 * M);
      addrLines.forEach(l => { centerText(l, y + 3); y += 3.5; });
    }
    if (c.phone) { centerText(`Tel: ${c.phone}`, y + 3); y += 4; }

    y += 1;
    dashedLine(y);
    y += 4;

    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    centerText('COMPROBANTE DE VENTA', y + 3);
    y += 4;
    centerText(`No. ${docNumber}`, y + 3);
    y += 4;

    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    centerText(`${dateStr} · ${timeStr}`, y + 3);
    y += 4;
    if (c.storeName) {
      centerText(`Sede: ${c.storeName}`, y + 3);
      y += 4;
    }

    // 🆕 Badge MAYORISTA (si aplica)
    const wInfo = getWholesaleInfo(sale);
    if (wInfo) {
      y += 1;
      solidLine(y);
      y += 4;

      doc.setFont('courier', 'bold');
      doc.setFontSize(8);
      centerText('** MAYORISTA **', y + 3);
      y += 4;

      doc.setFont('courier', 'normal');
      doc.setFontSize(7);

      // Nombre de la empresa (con split si es largo)
      const companyLines = doc.splitTextToSize(wInfo.companyName, W - 2 * M);
      companyLines.forEach(l => { centerText(l, y + 3); y += 3.5; });

      if (wInfo.nit) {
        centerText(`NIT: ${wInfo.nit}`, y + 3);
        y += 3.5;
      }

      if (wInfo.discountBase > 0) {
        centerText(`Desc. aplicado: -${(wInfo.discountBase * 100).toFixed(1)}%`, y + 3);
        y += 3.5;
      }

      y += 1;
      dashedLine(y);
      y += 4;
    } else {
      y += 1;
      solidLine(y);
      y += 4;
    }

    // ============ CLIENTE ============
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.text('CLIENTE', M, y + 3);
    y += 4;

    doc.setFont('courier', 'normal');
    const nameLines = doc.splitTextToSize(sale.customer?.name || '-', W - 2 * M);
    nameLines.forEach(l => { doc.text(l, M, y + 3); y += 3.5; });

    if (sale.customer?.phone) {
      doc.text(`Tel: ${sale.customer.phone}`, M, y + 3);
      y += 3.5;
    }
    if (sale.customer?.address) {
      const addrLines = doc.splitTextToSize(sale.customer.address, W - 2 * M);
      addrLines.forEach(l => { doc.text(l, M, y + 3); y += 3.5; });
    }

    y += 1;
    dashedLine(y);
    y += 4;

    // ============ PRODUCTOS ============
    doc.setFont('courier', 'bold');
    doc.text('PRODUCTOS', M, y + 3);
    y += 4;

    doc.setFont('courier', 'normal');
    (sale.items || []).forEach(it => {
      // 🆕 Marcar con ⚠️ si tiene excepción
      const nameDisplay = it.priceException
        ? `! ${it.name || '-'}`
        : (it.name || '-');
      const nameLines = doc.splitTextToSize(nameDisplay, W - 2 * M);
      nameLines.forEach(l => { doc.text(l, M, y + 3); y += 3.5; });

      const variantParts = [];
      if (it.colorName) variantParts.push(it.colorName);
      if (it.size) variantParts.push(it.size);
      if (variantParts.length) {
        doc.setFontSize(6.5);
        doc.text(variantParts.join(' · '), M, y + 3);
        doc.setFontSize(7);
        y += 3.5;
      }

      // Línea de cantidad × precio + subtotal
      const left = `${it.qty} × ${fmt(it.unitPrice)}`;
      const right = fmt((it.qty || 0) * (it.unitPrice || 0));
      doc.text(left, M, y + 3);
      doc.setFont('courier', 'bold');
      doc.text(right, W - M, y + 3, { align: 'right' });
      doc.setFont('courier', 'normal');
      y += 4.5;

      // 🆕 Si tiene excepción, mostrar referencia de mínimo
      if (it.priceException) {
        doc.setFontSize(6);
        doc.text(`  (min ${fmt(it.priceException.minPrice)})`, M, y + 3);
        y += 3;
        doc.setFontSize(7);
      }
    });

    y += 0.5;
    dashedLine(y);
    y += 4;

        y += 0.5;
    dashedLine(y);
    y += 4;

    // 🆕 Aviso de excepción de precio
    if (sale.hasPriceExceptions && Array.isArray(sale.priceExceptions) && sale.priceExceptions.length) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(6.5);
      const warnLines = doc.splitTextToSize(
        '! PRECIO AUTORIZADO POR ADMINISTRADOR',
        W - 2 * M
      );
      warnLines.forEach(l => { centerText(l, y + 3); y += 3; });
      y += 1;
      dashedLine(y);
      y += 4;
    }

    // ============ TOTALES ============
    doc.setFontSize(7.5);
    const addRow = (label, value, isBold = false) => {
      doc.setFont('courier', isBold ? 'bold' : 'normal');
      doc.text(label, M, y + 3);
      doc.text(value, W - M, y + 3, { align: 'right' });
      y += 4;
    };

    addRow('Subtotal', fmt(sale.subtotal));
    if (sale.discount) addRow('Descuento', `-${fmt(sale.discount)}`);
    if (sale.shipping) addRow('Envío', fmt(sale.shipping));
    if (sale.surchargeAmount) addRow('Rec. tarjeta', fmt(sale.surchargeAmount));

    y += 1;
    solidLine(y);
    y += 5;

    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    centerText(`TOTAL ${fmt(sale.total)}`, y + 3);
    y += 5;

    solidLine(y);
    y += 5;

    // ============ PAGO ============
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Pago: ${sale.paymentMethod || '-'}`, M, y + 3);
    y += 4;
    const seller = (sale.sellerName || sale.sellerEmail || '-').substring(0, 20);
    doc.text(`Vendedor: ${seller}`, M, y + 3);
    y += 5;

    // Notas
    if (sale.customer?.notes) {
      dashedLine(y);
      y += 4;
      doc.setFontSize(6.5);
      const notesLines = doc.splitTextToSize(`Nota: ${sale.customer.notes}`, W - 2 * M);
      notesLines.forEach(l => { doc.text(l, M, y + 3); y += 3.5; });
    }

    // ============ GARANTÍA ============
    y += 1;
    dashedLine(y);
    y += 4;

    doc.setFontSize(6);
    const garantiaText = 'GARANTÍA: Garantía mínima de 12 meses o la superior de fábrica. Presente este recibo para hacerla efectiva. No cubre daños por mal uso.';
    const garantiaLines = doc.splitTextToSize(garantiaText, W - 2 * M);
    garantiaLines.forEach(l => { doc.text(l, M, y + 3); y += 3; });

    y += 2;
    solidLine(y);
    y += 4;

    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    centerText('¡GRACIAS POR SU COMPRA!', y + 3);
    y += 4;

    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    centerText('Este documento no es factura electrónica', y + 3);
    y += 5;

    // ============ RECORTAR ALTO REAL ============
    const realH = y + 2;
    doc.internal.pageSize.height = realH;

    const blob = doc.output('blob');
    return blob;
  }

  /* ============================================================
     3. PDF MEDIA CARTA (140×216mm)
  ============================================================ */
  async function generateMediaCartaPDF(sale, settings) {
    const doc = new jsPDF('p', 'mm', [140, 216]);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 10;

    const c = getCompanyInfo(sale, settings);
    const docNumber = sale.documentNumber || 'SIN-NÚMERO';

    let y = M;

    // Barra azul superior
    doc.setFillColor(0, 113, 227);
    doc.rect(0, 0, pageW, 3, 'F');

    // Logo / título
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0, 113, 227);
    doc.text('SMART', M, y + 6);
    const smartWidth = doc.getTextWidth('SMART');
    doc.setTextColor(29, 29, 31);
    doc.text('EC', M + smartWidth, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(110, 110, 115);
    doc.text((c.razonSocial || '').toUpperCase(), M, y + 11);

    // Info empresa
    doc.setFontSize(7);
    doc.setTextColor(85, 85, 85);
    let infoY = y + 16;
    doc.text(`NIT: ${c.nit}${c.regimen ? ' · ' + c.regimen : ''}`, M, infoY);
    if (c.address) { infoY += 3.5; doc.text(c.address, M, infoY); }
    if (c.phone) { infoY += 3.5; doc.text(`Tel: ${c.phone}`, M, infoY); }

    // Tipo doc (derecha)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(29, 29, 31);
    doc.text('DOC. COMERCIAL', pageW - M, y + 6, { align: 'right' });
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`No. ${docNumber}`, pageW - M, y + 11, { align: 'right' });

    doc.setFontSize(7);
    doc.setTextColor(110, 110, 115);
    doc.text(fmtDate(sale.createdAt), pageW - M, y + 15.5, { align: 'right' });
    if (c.storeName) {
      doc.text(`Sede: ${c.storeName}`, pageW - M, y + 19.5, { align: 'right' });
    }

    // 🆕 Badge MAYORISTA (si aplica)
    const wInfo = getWholesaleInfo(sale);
    let extraHeaderHeight = 0;
    if (wInfo) {
      const boxW = 60;
      const boxH = wInfo.nit ? 12 : 8;
      const boxX = pageW - M - boxW;
      const boxY = y + 23;

      doc.setFillColor(245, 235, 255);
      doc.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5, 'F');
      doc.setDrawColor(191, 90, 242);
      doc.setLineWidth(0.3);
      doc.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(191, 90, 242);
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

      extraHeaderHeight = boxH + 2;
    }

    y = Math.max(infoY, y + 21) + 4 + extraHeaderHeight;
    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.4);
    doc.line(M, y, pageW - M, y);
    y += 5;

    // ============ CLIENTE ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 113, 227);
    doc.text('CLIENTE', M, y);
    y += 3.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(29, 29, 31);
    doc.text(sale.customer?.name || '-', M, y);

    doc.setFontSize(7.5);
    doc.setTextColor(85, 85, 85);
    if (sale.customer?.phone) {
      doc.text(`Tel: ${sale.customer.phone}`, pageW - M, y, { align: 'right' });
    }
    y += 4;

    if (sale.customer?.address) {
      doc.text(sale.customer.address + (sale.customer.city ? ', ' + sale.customer.city : ''), M, y);
      y += 4;
    }
    y += 3;

    // ============ TABLA ============
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 113, 227);
    doc.text('PRODUCTOS', M, y);
    y += 3;

    const items = (sale.items || []).map(it => {
      const variantParts = [];
      if (it.colorName) variantParts.push(it.colorName);
      if (it.size) variantParts.push(it.size);

      const nameBase = (it.name || '-') + (variantParts.length ? '\n' + variantParts.join(' · ') : '');
      const name = it.priceException ? `⚠️ ${nameBase}` : nameBase;

      return [
        it.sku || '-',
        name,
        String(it.qty || 0),
        fmt(it.unitPrice),
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
        fontSize: 7,
        cellPadding: 1.5,
      },
      bodyStyles: {
        fontSize: 7,
        cellPadding: 1.5,
        textColor: [51, 51, 51],
      },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: {
        0: { cellWidth: 18 },
        2: { cellWidth: 10, halign: 'center' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: M, right: M },
    });

    y = doc.lastAutoTable.finalY + 4;

        y = doc.lastAutoTable.finalY + 4;

    // 🆕 Nota de excepciones de precio
    if (sale.hasPriceExceptions && Array.isArray(sale.priceExceptions) && sale.priceExceptions.length) {
      const exNote = sale.priceExceptions.map(ex =>
        `⚠️ ${ex.name}: ${fmt(ex.finalPrice)} (mín ${fmt(ex.minPrice)}) · ${ex.authorizedByName || '—'}`
      ).join('\n');

      doc.setFillColor(255, 245, 230);
      const wrapped = doc.splitTextToSize(exNote, pageW - 2 * M - 4);
      const h = wrapped.length * 3 + 5;
      doc.rect(M, y, pageW - 2 * M, h, 'F');
      doc.setFillColor(255, 149, 10);
      doc.rect(M, y, 1.2, h, 'F');
      doc.setFontSize(6);
      doc.setTextColor(180, 100, 0);
      doc.text(wrapped, M + 3, y + 3.5);
      y += h + 3;
    }

    // ============ TOTALES ============
    const totalsW = 60;
    const totalsX = pageW - M - totalsW;

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);

    const addRow = (label, value) => {
      doc.text(label, totalsX, y);
      doc.text(value, pageW - M, y, { align: 'right' });
      y += 4;
    };

    addRow('Subtotal', fmt(sale.subtotal));
    if (sale.discount) addRow('Descuento', `-${fmt(sale.discount)}`);
    if (sale.shipping) addRow('Envío', fmt(sale.shipping));
    if (sale.surchargeAmount) addRow('Rec. tarjeta', fmt(sale.surchargeAmount));

    doc.setDrawColor(0, 113, 227);
    doc.setLineWidth(0.4);
    doc.line(totalsX, y, pageW - M, y);
    y += 5;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 113, 227);
    doc.text('TOTAL', totalsX, y);
    doc.setTextColor(29, 29, 31);
    doc.text(fmt(sale.total), pageW - M, y, { align: 'right' });
    y += 8;

    // ============ PAGO ============
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    doc.text(`Pago: ${sale.paymentMethod || '-'} · Vendedor: ${sale.sellerName || sale.sellerEmail || '-'}`, M, y);
    y += 6;

    // ============ GARANTÍA ============
    const garantiaText = 'GARANTÍA: Productos con garantía mínima de 12 meses o la superior de fábrica. No cubre daños por mal uso. Presente este documento para hacerla efectiva.';
    doc.setFillColor(245, 247, 250);
    const lines = doc.splitTextToSize(garantiaText, pageW - 2 * M - 4);
    const gH = lines.length * 3 + 5;
    doc.rect(M, y, pageW - 2 * M, gH, 'F');
    doc.setFillColor(0, 113, 227);
    doc.rect(M, y, 1.2, gH, 'F');
    doc.setFontSize(6.5);
    doc.setTextColor(85, 85, 85);
    doc.text(lines, M + 3, y + 3.5);
    y += gH + 8;

    // ============ FIRMAS ============
    if (y > pageH - 35) {
      doc.addPage();
      y = M;
    }

    const firmaW = (pageW - 3 * M) / 2;
    const firmaY = y + 12;

    doc.setDrawColor(51, 51, 51);
    doc.setLineWidth(0.3);
    doc.line(M, firmaY, M + firmaW, firmaY);
    doc.setFontSize(7);
    doc.setTextColor(110, 110, 115);
    doc.text('FIRMA DEL CLIENTE', M + firmaW / 2, firmaY + 3.5, { align: 'center' });

    const firma2X = pageW - M - firmaW;
    doc.line(firma2X, firmaY, firma2X + firmaW, firmaY);
    doc.text('FIRMA DEL VENDEDOR', firma2X + firmaW / 2, firmaY + 3.5, { align: 'center' });

    // Footer
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Documento no válido como factura electrónica · Smartec · ${c.nit}`,
      pageW / 2,
      pageH - 6,
      { align: 'center' }
    );

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