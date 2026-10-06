/* ============================================================
   lib/puc.js
   Plan Único de Cuentas (PUC) - Colombia
   Decreto 2650 de 1993 · Estructura jerárquica oficial
   ------------------------------------------------------------
   Estructura de niveles:
     1 → Clase        (1 dígito)   ej: 1 = Activo
     2 → Grupo        (2 dígitos)  ej: 11 = Disponible
     3 → Cuenta       (4 dígitos)  ej: 1105 = Caja
     4 → Subcuenta    (6 dígitos)  ej: 110505 = Caja general
     5 → Auxiliar     (8+ dígitos) ej: 11050501 = Caja general sucursal
   ------------------------------------------------------------
   Reglas:
   - Solo las cuentas de nivel >= 4 (6+ dígitos) aceptan movimientos.
   - Las cuentas de nivel 1, 2 y 3 son agrupadoras (solo suma).
   - Cada cuenta tiene: code, name, level, parentCode, nature,
     acceptsMovement, isBase (viene del PUC oficial).
   - El PUC base es inmutable; el usuario puede AGREGAR cuentas
     auxiliares propias por tienda (storeId).
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     PUC BASE (Decreto 2650/1993)
     Formato: [code, name, parentCode, nature]
     nature: 'D' = débito (activo, gasto, costo)
             'C' = crédito (pasivo, patrimonio, ingreso)
     ------------------------------------------------------------
     Solo incluyo hasta nivel 4 (subcuenta). Los auxiliares
     los crea el usuario cuando los necesite.
  ============================================================ */
  const PUC_BASE = [
    // ========================================================
    // CLASE 1 · ACTIVO (Débito)
    // ========================================================
    ['1',    'ACTIVO',                              null,  'D'],
    ['11',   'Disponible',                          '1',   'D'],
    ['1105', 'Caja',                                '11',  'D'],
    ['110505','Caja general',                       '1105','D'],
    ['110510','Caja menor',                         '1105','D'],
    ['1110', 'Bancos',                              '11',  'D'],
    ['111005','Banco Nacional de Colombia',         '1110','D'],
    ['111010','Banco Bancolombia',                  '1110','D'],
    ['111015','Banco Davivienda',                   '1110','D'],
    ['111020','Banco BBVA',                         '1110','D'],
    ['111025','Banco de Bogotá',                    '1110','D'],
    ['111030','Banco de Occidente',                 '1110','D'],
    ['111095','Otros bancos',                       '1110','D'],
    ['1120', 'Cuentas de ahorro',                   '11',  'D'],
    ['112005','Banco Nacional de Colombia',         '1120','D'],
    ['112010','Banco Bancolombia',                  '1120','D'],
    ['112015','Banco Davivienda',                   '1120','D'],
    ['112095','Otros bancos',                       '1120','D'],
    ['13',   'Deudores',                            '1',   'D'],
    ['1305', 'Clientes y cuentas por cobrar',       '13',  'D'],
    ['130505','Clientes nacionales',                '1305','D'],
    ['130510','Clientes del exterior',              '1305','D'],
    ['1310', 'Cuentas corrientes comerciales',      '13',  'D'],
    ['131005','Cuentas corrientes comerciales',     '1310','D'],
    ['1320', 'Cuentas por cobrar a socios',         '13',  'D'],
    ['132005','Cuentas por cobrar a socios',        '1320','D'],
    ['1330', 'Anticipos y avances',                 '13',  'D'],
    ['133005','Anticipos a proveedores',            '1330','D'],
    ['133010','Anticipos a contratistas',           '1330','D'],
    ['1355', 'Anticipo de impuestos',               '13',  'D'],
    ['135505','Anticipo de impuestos de renta',     '1355','D'],
    ['135510','Anticipo de impuestos de IVA',       '1355','D'],
    ['135515','Anticipo de impuestos de ICA',       '1355','D'],
    ['1360', 'Reclamaciones',                       '13',  'D'],
    ['136005','Reclamaciones a compañías aseguradoras','1360','D'],
    ['1380', 'Deudores varios',                     '13',  'D'],
    ['138005','Deudores varios',                    '1380','D'],
    ['1390', 'Provisión de cartera',                '13',  'C'],
    ['139005','Provisión clientes',                 '1390','C'],
    ['139010','Provisión cuentas corrientes',       '1390','C'],
    ['14',   'Inventarios',                         '1',   'D'],
    ['1405', 'Materias primas',                     '14',  'D'],
    ['140505','Materias primas',                    '1405','D'],
    ['1435', 'Mercancías no fabricadas por la empresa','14','D'],
    ['143505','Mercancías no fabricadas por la empresa','1435','D'],
    ['1455', 'Materiales, repuestos y accesorios',  '14',  'D'],
    ['145505','Materiales, repuestos y accesorios', '1455','D'],
    ['15',   'Propiedades, planta y equipo',        '1',   'D'],
    ['1504', 'Terrenos',                            '15',  'D'],
    ['150405','Terrenos urbanos',                   '1504','D'],
    ['150410','Terrenos rurales',                   '1504','D'],
    ['1516', 'Construcciones y edificaciones',      '15',  'D'],
    ['151605','Edificios',                          '1516','D'],
    ['1520', 'Maquinaria y equipo',                 '15',  'D'],
    ['152005','Maquinaria y equipo',                '1520','D'],
    ['1524', 'Equipo de oficina',                   '15',  'D'],
    ['152405','Equipo de oficina',                  '1524','D'],
    ['1528', 'Equipo de computación y comunicación', '15', 'D'],
    ['152805','Equipo de computación y comunicación','1528','D'],
    ['1532', 'Equipo médico y científico',          '15',  'D'],
    ['153205','Equipo médico y científico',         '1532','D'],
    ['1540', 'Flota y equipo de transporte',        '15',  'D'],
    ['154005','Vehículos',                          '1540','D'],
    ['154010','Motos',                              '1540','D'],
    ['1548', 'Equipo de comedor, cocina, despensa', '15',  'D'],
    ['154805','Equipo de comedor, cocina, despensa','1548','D'],
    ['1592', 'Depreciación acumulada',              '15',  'C'],
    ['159205','Depreciación acumulada construcciones','1592','C'],
    ['159210','Depreciación acumulada maquinaria',  '1592','C'],
    ['159215','Depreciación acumulada equipo oficina','1592','C'],
    ['159220','Depreciación acumulada equipo computo','1592','C'],
    ['159225','Depreciación acumulada flota y equipo','1592','C'],
    ['159230','Depreciación acumulada equipo comedor','1592','C'],
    ['17',   'Diferidos',                           '1',   'D'],
    ['1705', 'Gastos pagados por anticipado',       '17',  'D'],
    ['170505','Gastos pagados por anticipado',      '1705','D'],
    ['1710', 'Cargos diferidos',                    '17',  'D'],
    ['171005','Cargos diferidos',                   '1710','D'],
    ['18',   'Otros activos',                       '1',   'D'],
    ['1805', 'Bienes de arte y cultura',            '18',  'D'],
    ['180505','Bienes de arte y cultura',           '1805','D'],
    ['1895', 'Otros activos',                       '18',  'D'],
    ['189505','Otros activos',                      '1895','D'],

    // ========================================================
    // CLASE 2 · PASIVO (Crédito)
    // ========================================================
    ['2',    'PASIVO',                              null,  'C'],
    ['21',   'Obligaciones financieras',            '2',   'C'],
    ['2105', 'Bancos nacionales',                   '21',  'C'],
    ['210505','Bancos nacionales',                  '2105','C'],
    ['2110', 'Bancos del exterior',                 '21',  'C'],
    ['211005','Bancos del exterior',                '2110','C'],
    ['2120', 'Corporaciones financieras',           '21',  'C'],
    ['212005','Corporaciones financieras',          '2120','C'],
    ['22',   'Proveedores',                         '2',   'C'],
    ['2205', 'Proveedores nacionales',              '22',  'C'],
    ['220505','Proveedores nacionales',             '2205','C'],
    ['2210', 'Proveedores del exterior',            '22',  'C'],
    ['221005','Proveedores del exterior',           '2210','C'],
    ['23',   'Cuentas por pagar',                   '2',   'C'],
    ['2305', 'Cuentas corrientes comerciales',      '23',  'C'],
    ['230505','Cuentas corrientes comerciales',     '2305','C'],
    ['2310', 'A compañías vinculadas',              '23',  'C'],
    ['231005','A compañías vinculadas',             '2310','C'],
    ['2320', 'A contratistas',                      '23',  'C'],
    ['232005','A contratistas',                     '2320','C'],
    ['2335', 'Costos y gastos por pagar',           '23',  'C'],
    ['233505','Gastos financieros por pagar',       '2335','C'],
    ['233510','Gastos legales por pagar',           '2335','C'],
    ['233515','Honorarios por pagar',               '2335','C'],
    ['233520','Servicios técnicos por pagar',       '2335','C'],
    ['233525','Arrendamientos por pagar',           '2335','C'],
    ['233530','Servicios públicos por pagar',       '2335','C'],
    ['233535','Transporte, fletes y acarreos por pagar','2335','C'],
    ['233540','Publicidad, propaganda y promoción por pagar','2335','C'],
    ['233545','Seguros por pagar',                  '2335','C'],
    ['233550','Nómina por pagar',                   '2335','C'],
    ['2340', 'Retención en la fuente',              '23',  'C'],
    ['234005','Retención en la fuente',             '2340','C'],
    ['2360', 'Retención de IVA',                    '23',  'C'],
    ['236005','Retención de IVA',                   '2360','C'],
    ['2365', 'Retención de ICA',                    '23',  'C'],
    ['236505','Retención de ICA',                   '2365','C'],
    ['2370', 'Retenciones y aportes de nómina',     '23',  'C'],
    ['237005','Aportes a EPS',                      '2370','C'],
    ['237010','Aportes a ARL',                      '2370','C'],
    ['237015','Aportes a fondos de pensiones',      '2370','C'],
    ['237020','Aportes a cajas de compensación',    '2370','C'],
    ['237025','Aportes al SENA',                    '2370','C'],
    ['237030','Aportes al ICBF',                    '2370','C'],
    ['2380', 'Acreedores varios',                   '23',  'C'],
    ['238005','Acreedores varios',                  '2380','C'],
    ['24',   'Impuestos, gravámenes y tasas',       '2',   'C'],
    ['2404', 'De renta y complementarios',          '24',  'C'],
    ['240405','Impuesto de renta y complementarios','2404','C'],
    ['2408', 'Impuesto sobre las ventas por pagar', '24',  'C'],
    ['240805','IVA por pagar',                      '2408','C'],
    ['2412', 'De industria y comercio',             '24',  'C'],
    ['241205','ICA por pagar',                      '2412','C'],
    ['2424', 'Retención en la fuente a título de renta','24','C'],
    ['242405','Retención en la fuente a título de renta','2424','C'],
    ['25',   'Obligaciones laborales',              '2',   'C'],
    ['2505', 'Salarios por pagar',                  '25',  'C'],
    ['250505','Salarios por pagar',                 '2505','C'],
    ['2510', 'Cesantías consolidadas',              '25',  'C'],
    ['251005','Cesantías consolidadas',             '2510','C'],
    ['2515', 'Intereses sobre cesantías',           '25',  'C'],
    ['251505','Intereses sobre cesantías',          '2515','C'],
    ['2520', 'Prima de servicios',                  '25',  'C'],
    ['252005','Prima de servicios',                 '2520','C'],
    ['2525', 'Vacaciones consolidadas',             '25',  'C'],
    ['252505','Vacaciones consolidadas',            '2525','C'],
    ['26',   'Pasivos estimados y provisiones',     '2',   'C'],
    ['2610', 'Para obligaciones fiscales',          '26',  'C'],
    ['261005','Para obligaciones fiscales',         '2610','C'],
    ['2615', 'Para obligaciones laborales',         '26',  'C'],
    ['261505','Para obligaciones laborales',        '2615','C'],
    ['28',   'Otros pasivos',                       '2',   'C'],
    ['2805', 'Anticipos y avances recibidos',       '28',  'C'],
    ['280505','Anticipos y avances recibidos',      '2805','C'],
    ['2815', 'Ingresos recibidos para terceros',    '28',  'C'],
    ['281505','Ingresos recibidos para terceros',   '2815','C'],
    ['2895', 'Diversos',                            '28',  'C'],
    ['289505','Diversos',                           '2895','C'],

    // ========================================================
    // CLASE 3 · PATRIMONIO (Crédito)
    // ========================================================
    ['3',    'PATRIMONIO',                          null,  'C'],
    ['31',   'Capital social',                      '3',   'C'],
    ['3105', 'Capital suscrito y pagado',           '31',  'C'],
    ['310505','Capital autorizado',                 '3105','C'],
    ['310510','Capital suscrito y pagado',          '3105','C'],
    ['32',   'Superávit de capital',                '3',   'C'],
    ['3205', 'Prima en colocación de acciones',     '32',  'C'],
    ['320505','Prima en colocación de acciones',    '3205','C'],
    ['33',   'Reservas',                            '3',   'C'],
    ['3305', 'Reservas obligatorias',               '33',  'C'],
    ['330505','Reserva legal',                      '3305','C'],
    ['36',   'Resultados del ejercicio',            '3',   'C'],
    ['3605', 'Utilidad del ejercicio',              '36',  'C'],
    ['360505','Utilidad del ejercicio',             '3605','C'],
    ['3606', 'Pérdida del ejercicio',               '36',  'D'],
    ['360605','Pérdida del ejercicio',              '3606','D'],
    ['37',   'Resultados de ejercicios anteriores', '3',   'C'],
    ['3705', 'Utilidades acumuladas',               '37',  'C'],
    ['370505','Utilidades acumuladas',              '3705','C'],
    ['3706', 'Pérdidas acumuladas',                 '37',  'D'],
    ['370605','Pérdidas acumuladas',                '3706','D'],

    // ========================================================
    // CLASE 4 · INGRESOS (Crédito)
    // ========================================================
    ['4',    'INGRESOS',                            null,  'C'],
    ['41',   'Ingresos operacionales',              '4',   'C'],
    ['4135', 'Comercio al por mayor y al por menor', '41', 'C'],
    ['413505','Venta de mercancías al por mayor',   '4135','C'],
    ['413510','Venta de mercancías al por menor',   '4135','C'],
    ['413595','Devoluciones, rebajas y descuentos en ventas','4135','D'],
    ['4140', 'Comercio al por mayor y al por menor (servicios)','41','C'],
    ['414005','Servicios de comercio',              '4140','C'],
    ['4175', 'Devoluciones, rebajas y descuentos en ventas','41','D'],
    ['417505','Devoluciones en ventas',             '4175','D'],
    ['42',   'Ingresos no operacionales',           '4',   'C'],
    ['4205', 'Otras ventas',                        '42',  'C'],
    ['420505','Otras ventas',                       '4205','C'],
    ['4210', 'Financieros',                         '42',  'C'],
    ['421005','Intereses',                          '4210','C'],
    ['421010','Diferencia en cambio',               '4210','C'],
    ['4250', 'Recuperaciones',                      '42',  'C'],
    ['425005','Recuperaciones',                     '4250','C'],
    ['4295', 'Diversos',                            '42',  'C'],
    ['429505','Diversos',                           '4295','C'],

    // ========================================================
    // CLASE 5 · GASTOS (Débito)
    // ========================================================
    ['5',    'GASTOS',                              null,  'D'],
    ['51',   'Gastos operacionales de administración','5',  'D'],
    ['5105', 'Gastos de personal',                  '51',  'D'],
    ['510506','Sueldos',                            '5105','D'],
    ['510512','Horas extras y recargos',            '5105','D'],
    ['510515','Auxilio de transporte',              '5105','D'],
    ['510518','Cesantías',                          '5105','D'],
    ['510521','Intereses sobre cesantías',          '5105','D'],
    ['510524','Prima de servicios',                 '5105','D'],
    ['510527','Vacaciones',                         '5105','D'],
    ['510530','Dotación y suministro a trabajadores','5105','D'],
    ['510533','Aportes a EPS',                      '5105','D'],
    ['510536','Aportes a ARL',                      '5105','D'],
    ['510539','Aportes a fondos de pensiones',      '5105','D'],
    ['510542','Aportes a cajas de compensación',    '5105','D'],
    ['510545','Aportes al SENA',                    '5105','D'],
    ['510548','Aportes al ICBF',                    '5105','D'],
    ['5110', 'Honorarios',                          '51',  'D'],
    ['511005','Honorarios',                         '5110','D'],
    ['5115', 'Impuestos',                           '51',  'D'],
    ['511505','Impuesto de industria y comercio',   '5115','D'],
    ['511510','Impuesto predial',                   '5115','D'],
    ['511515','Gravamen a los movimientos financieros','5115','D'],
    ['5120', 'Arrendamientos',                      '51',  'D'],
    ['512005','Arrendamientos',                     '5120','D'],
    ['5130', 'Seguros',                             '51',  'D'],
    ['513005','Seguros',                            '5130','D'],
    ['5135', 'Servicios',                           '51',  'D'],
    ['513505','Aseo y vigilancia',                  '5135','D'],
    ['513510','Temporales',                         '5135','D'],
    ['513515','Asistencia técnica',                 '5135','D'],
    ['513520','Procesamiento electrónico de datos', '5135','D'],
    ['513525','Acueducto, alcantarillado y aseo',   '5135','D'],
    ['513530','Energía eléctrica',                  '5135','D'],
    ['513535','Teléfono',                           '5135','D'],
    ['513540','Correo, portes y telegramas',        '5135','D'],
    ['513545','Fax y telex',                        '5135','D'],
    ['513550','Celular',                            '5135','D'],
    ['513555','Internet',                           '5135','D'],
    ['513595','Otros servicios',                    '5135','D'],
    ['5140', 'Gastos legales',                      '51',  'D'],
    ['514005','Gastos legales',                     '5140','D'],
    ['5145', 'Mantenimiento y reparaciones',        '51',  'D'],
    ['514505','Mantenimiento y reparaciones',       '5145','D'],
    ['5150', 'Adecuación e instalación',            '51',  'D'],
    ['515005','Adecuación e instalación',           '5150','D'],
    ['5155', 'Gastos de viaje',                     '51',  'D'],
    ['515505','Gastos de viaje',                    '5155','D'],
    ['5160', 'Depreciaciones',                      '51',  'D'],
    ['516005','Depreciaciones',                     '5160','D'],
    ['5165', 'Amortizaciones',                      '51',  'D'],
    ['516505','Amortizaciones',                     '5165','D'],
    ['5195', 'Diversos',                            '51',  'D'],
    ['519505','Comisiones',                         '5195','D'],
    ['519510','Libros, suscripciones, periódicos y revistas','5195','D'],
    ['519515','Fotocopias',                         '5195','D'],
    ['519520','Gastos de representación',           '5195','D'],
    ['519525','Elementos de aseo y cafetería',      '5195','D'],
    ['519530','Útiles, papelería y fotocopias',     '5195','D'],
    ['519535','Combustibles y lubricantes',         '5195','D'],
    ['519540','Envases y empaques',                 '5195','D'],
    ['519545','Taxis y buses',                      '5195','D'],
    ['519550','Transporte, fletes y acarreos',      '5195','D'],
    ['519555','Parqueaderos',                       '5195','D'],
    ['519560','Publicidad, propaganda y promoción', '5195','D'],
    ['519565','Relaciones públicas',                '5195','D'],
    ['519570','Contribuciones y afiliaciones',      '5195','D'],
    ['519575','Adecuación e instalación',           '5195','D'],
    ['519595','Otros',                              '5195','D'],
    ['52',   'Gastos operacionales de ventas',      '5',   'D'],
    ['5205', 'Gastos de personal (ventas)',         '52',  'D'],
    ['520505','Sueldos (ventas)',                   '5205','D'],
    ['5210', 'Honorarios (ventas)',                 '52',  'D'],
    ['521005','Honorarios (ventas)',                '5210','D'],
    ['5235', 'Servicios (ventas)',                  '52',  'D'],
    ['523505','Aseo y vigilancia (ventas)',         '5235','D'],
    ['523560','Publicidad (ventas)',                '5235','D'],
    ['523595','Otros servicios (ventas)',           '5235','D'],
    ['5245', 'Mantenimiento (ventas)',              '52',  'D'],
    ['524505','Mantenimiento (ventas)',             '5245','D'],
    ['5295', 'Diversos (ventas)',                   '52',  'D'],
    ['529505','Comisiones (ventas)',                '5295','D'],
    ['529510','Empaques (ventas)',                  '5295','D'],
    ['529530','Útiles, papelería (ventas)',         '5295','D'],
    ['529550','Transporte (ventas)',                '5295','D'],
    ['529560','Publicidad (ventas)',                '5295','D'],
    ['529595','Otros (ventas)',                     '5295','D'],
    ['53',   'No operacionales',                    '5',   'D'],
    ['5305', 'Financieros',                         '53',  'D'],
    ['530505','Gastos bancarios',                   '5305','D'],
    ['530510','Intereses',                          '5305','D'],
    ['530515','Comisiones',                         '5305','D'],
    ['530520','Diferencia en cambio',               '5305','D'],
    ['530525','Gravamen a los movimientos financieros','5305','D'],
    ['5310', 'Pérdida en venta y retiro de bienes', '53',  'D'],
    ['531005','Pérdida en venta y retiro de bienes', '5310','D'],
    ['5315', 'Gastos extraordinarios',              '53',  'D'],
    ['531505','Gastos extraordinarios',             '5315','D'],
    ['5395', 'Gastos diversos',                     '53',  'D'],
    ['539505','Gastos diversos',                    '5395','D'],
    ['54',   'Impuesto de renta y complementarios', '5',   'D'],
    ['5405', 'Impuesto de renta y complementarios', '54',  'D'],
    ['540505','Impuesto de renta y complementarios','5405','D'],

    // ========================================================
    // CLASE 6 · COSTOS DE VENTAS (Débito)
    // ========================================================
    ['6',    'COSTOS DE VENTAS',                    null,  'D'],
    ['61',   'Costo de ventas y de prestación de servicios','6','D'],
    ['6135', 'Comercio al por mayor y al por menor', '61', 'D'],
    ['613505','Costo de mercancías vendidas',       '6135','D'],
    ['613510','Costo de mercancías al por mayor',   '6135','D'],
    ['6140', 'Comercio al por mayor y al por menor (servicios)','61','D'],
    ['614005','Costo de servicios de comercio',     '6140','D'],
    ['62',   'Compras',                             '6',   'D'],
    ['6205', 'Compras de mercancías',               '62',  'D'],
    ['620505','Compras de mercancías',              '6205','D'],
    ['6210', 'Compras de materias primas',          '62',  'D'],
    ['621005','Compras de materias primas',         '6210','D'],
    ['6220', 'Compras de materiales, repuestos y accesorios','62','D'],
    ['622005','Compras de materiales, repuestos y accesorios','6220','D'],
    ['6225', 'Devoluciones en compras',             '62',  'C'],
    ['622505','Devoluciones en compras',            '6225','C'],

    // ========================================================
    // CLASE 7 · COSTOS DE PRODUCCIÓN (Débito)
    // ========================================================
    ['7',    'COSTOS DE PRODUCCIÓN O DE OPERACIÓN','null', 'D'],
    ['71',   'Materia prima directa',               '7',   'D'],
    ['7105', 'Materia prima directa',               '71',  'D'],
    ['710505','Materia prima directa',              '7105','D'],
    ['72',   'Mano de obra directa',                '7',   'D'],
    ['7205', 'Mano de obra directa',                '72',  'D'],
    ['720505','Mano de obra directa',               '7205','D'],
    ['73',   'Costos indirectos',                   '7',   'D'],
    ['7305', 'Costos indirectos',                   '73',  'D'],
    ['730505','Costos indirectos',                  '7305','D'],

    // ========================================================
    // CLASE 8 · CUENTAS DE ORDEN DEUDORAS (Débito)
    // ========================================================
    ['8',    'CUENTAS DE ORDEN DEUDORAS',           null,  'D'],
    ['81',   'Derechos contingentes',               '8',   'D'],
    ['8105', 'Derechos contingentes',               '81',  'D'],
    ['810505','Derechos contingentes',              '8105','D'],
    ['83',   'Deudoras de control',                 '8',   'D'],
    ['8305', 'Deudoras de control',                 '83',  'D'],
    ['830505','Deudoras de control',                '8305','D'],

    // ========================================================
    // CLASE 9 · CUENTAS DE ORDEN ACREEDORAS (Crédito)
    // ========================================================
    ['9',    'CUENTAS DE ORDEN ACREEDORAS',         null,  'C'],
    ['91',   'Responsabilidades contingentes',      '9',   'C'],
    ['9105', 'Responsabilidades contingentes',      '91',  'C'],
    ['910505','Responsabilidades contingentes',     '9105','C'],
    ['93',   'Acreedoras de control',               '9',   'C'],
    ['9305', 'Acreedoras de control',               '93',  'C'],
    ['930505','Acreedoras de control',              '9305','C']
  ];

  /* ============================================================
     NORMALIZACIÓN
     Convierte PUC_BASE (array plano) en objetos enriquecidos
     con metadatos útiles: level, acceptsMovement, isBase.
  ============================================================ */
  function computeLevel(code) {
    const len = String(code).length;
    if (len === 1) return 1; // Clase
    if (len === 2) return 2; // Grupo
    if (len === 4) return 3; // Cuenta
    if (len === 6) return 4; // Subcuenta
    return 5;                 // Auxiliar (8+)
  }

  function computeParent(code) {
    const len = String(code).length;
    if (len === 1) return null;
    if (len === 2) return code[0];
    if (len === 4) return code.slice(0, 2);
    if (len === 6) return code.slice(0, 4);
    return code.slice(0, 6);
  }

  const PUC_NORMALIZED = PUC_BASE.map(([code, name, parentCode, nature]) => ({
    code: String(code),
    name,
    parentCode: parentCode === 'null' ? null : parentCode,
    nature, // 'D' | 'C'
    level: computeLevel(code),
    acceptsMovement: computeLevel(code) >= 4,
    isBase: true,
    active: true
  }));

  /* ============================================================
     ÍNDICES (para búsquedas rápidas)
  ============================================================ */
  const BY_CODE = new Map();
  PUC_NORMALIZED.forEach(c => BY_CODE.set(c.code, c));

  /* ============================================================
     API PÚBLICA
  ============================================================ */
  const PUC = {
    /**
     * Devuelve el PUC base completo (array de objetos).
     * Uso: PUC.getBase()
     */
    getBase() {
      return PUC_NORMALIZED.map(c => ({ ...c }));
    },

    /**
     * Busca una cuenta por código exacto.
     * Uso: PUC.findByCode('110505')
     */
    findByCode(code) {
      const c = BY_CODE.get(String(code));
      return c ? { ...c } : null;
    },

    /**
     * Devuelve los hijos directos de un código padre.
     * Si parentCode = null, devuelve las clases (nivel 1).
     * Uso: PUC.getChildren('11')
     */
    getChildren(parentCode) {
      const p = parentCode == null ? null : String(parentCode);
      return PUC_NORMALIZED
        .filter(c => c.parentCode === p)
        .map(c => ({ ...c }));
    },

    /**
     * Devuelve la rama completa desde una raíz (incluye la raíz).
     * Uso: PUC.getBranch('11')
     */
    getBranch(rootCode) {
      const root = String(rootCode);
      const out = [];
      const walk = (code) => {
        const c = BY_CODE.get(code);
        if (!c) return;
        out.push({ ...c });
        PUC_NORMALIZED
          .filter(x => x.parentCode === code)
          .forEach(x => walk(x.code));
      };
      walk(root);
      return out;
    },

    /**
     * Devuelve TODAS las cuentas que aceptan movimiento
     * (nivel >= 4), opcionalmente filtradas por naturaleza.
     * Uso: PUC.getMovable('D')
     */
    getMovable(nature) {
      return PUC_NORMALIZED
        .filter(c => c.acceptsMovement && (!nature || c.nature === nature))
        .map(c => ({ ...c }));
    },

    /**
     * Búsqueda por texto (código o nombre).
     * Uso: PUC.search('caja')
     */
    search(term) {
      const t = String(term || '').toLowerCase().trim();
      if (!t) return [];
      return PUC_NORMALIZED
        .filter(c => c.code.includes(t) || c.name.toLowerCase().includes(t))
        .map(c => ({ ...c }));
    },

    /**
     * Devuelve una lista plana ordenada por código
     * (útil para poblar <select>).
     */
    getFlatSorted() {
      return PUC_NORMALIZED
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(c => ({ ...c }));
    },

    /**
     * Devuelve el nombre completo con sangría visual según nivel.
     * Uso: PUC.labelWithIndent('110505')
     */
    labelWithIndent(code) {
      const c = BY_CODE.get(String(code));
      if (!c) return String(code);
      const indent = '   '.repeat(Math.max(0, c.level - 1));
      return `${indent}${c.code} · ${c.name}`;
    },

    /**
     * Constantes útiles
     */
    NATURE: { DEBIT: 'D', CREDIT: 'C' },
    LEVELS: {
      CLASE: 1, GRUPO: 2, CUENTA: 3, SUBCUENTA: 4, AUXILIAR: 5
    }
  };

  // Exponer global
  window.SmartecPUC = PUC;
})();