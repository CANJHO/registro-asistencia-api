import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { join } from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';

// ✅ NUEVO: regeneración en memoria cuando Render borra uploads
import * as QRCode from 'qrcode';
const bwipjs = require('bwip-js');

@Injectable()
export class EmpleadosService {
  constructor(private readonly ds: DataSource) {}

  // ✅ NUEVO: listar cumpleaños próximos (solo próximos, no pasados)
  async listarCumpleanosProximos(dias: number) {
    const rows = await this.ds.query(
      `
      WITH base AS (
        SELECT
          u.id,
          u.nombre,
          u.apellido_paterno,
          u.apellido_materno,
          u.numero_documento,
          u.fecha_nacimiento::date AS fecha_nacimiento
        FROM usuarios u
        WHERE u.activo = TRUE
          AND u.fecha_nacimiento IS NOT NULL
      ),
      calc AS (
        SELECT
          b.*,
          CASE
            WHEN make_date(
              EXTRACT(YEAR FROM CURRENT_DATE)::int,
              EXTRACT(MONTH FROM b.fecha_nacimiento)::int,
              EXTRACT(DAY   FROM b.fecha_nacimiento)::int
            ) < CURRENT_DATE
            THEN make_date(
              (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1),
              EXTRACT(MONTH FROM b.fecha_nacimiento)::int,
              EXTRACT(DAY   FROM b.fecha_nacimiento)::int
            )
            ELSE make_date(
              EXTRACT(YEAR FROM CURRENT_DATE)::int,
              EXTRACT(MONTH FROM b.fecha_nacimiento)::int,
              EXTRACT(DAY   FROM b.fecha_nacimiento)::int
            )
          END AS proximo_cumple
        FROM base b
      )
      SELECT
        id,
        nombre,
        apellido_paterno,
        apellido_materno,
        numero_documento,
        fecha_nacimiento,
        proximo_cumple,
        (proximo_cumple - CURRENT_DATE) AS dias_faltan
      FROM calc
      WHERE (proximo_cumple - CURRENT_DATE) BETWEEN 0 AND $1::int
      ORDER BY dias_faltan ASC, apellido_paterno ASC, apellido_materno ASC, nombre ASC
      `,
      [dias],
    );

    return rows || [];
  }

  // ============================
  // LISTADO DE EMPLEADOS (PANEL)
  // ============================
  async listarEmpleados(pagina: number, limite: number, buscar?: string) {
    const paginaSafe = pagina && pagina > 0 ? pagina : 1;
    const limiteSafe = !limite || limite < 1 ? 20 : limite > 100 ? 100 : limite;
    const offset = (paginaSafe - 1) * limiteSafe;

    let filas: any[] = [];
    let total = 0;

    if (buscar && buscar.trim()) {
      const termino = `%${buscar.trim().toLowerCase()}%`;

      filas = await this.ds.query(
        `
        SELECT
          u.id,
          u.nombre,
          u.apellido_paterno,
          u.apellido_materno,
          u.tipo_documento,
          u.numero_documento,
          u.telefono_celular,
          u.email_personal,
          u.email_institucional,
          u.fecha_nacimiento, -- ✅ NUEVO
          u.code_scannable,
          u.activo,
          u.foto_perfil_url,
          r.nombre AS rol,
          s.nombre AS sede,
          a.nombre AS area
        FROM usuarios u
        LEFT JOIN roles r  ON r.id = u.rol_id
        LEFT JOIN sedes s  ON s.id = u.sede_id
        LEFT JOIN areas a  ON a.id = u.area_id
        WHERE
          unaccent(lower(u.nombre || ' ' || u.apellido_paterno || ' ' || u.apellido_materno)) LIKE unaccent($1)
          OR u.numero_documento ILIKE $1
        ORDER BY u.apellido_paterno, u.apellido_materno, u.nombre
        LIMIT $2 OFFSET $3
        `,
        [termino, limiteSafe, offset],
      );

      const totalRow = await this.ds.query(
        `
        SELECT COUNT(*)::int AS total
        FROM usuarios u
        LEFT JOIN roles r  ON r.id = u.rol_id
        LEFT JOIN sedes s  ON s.id = u.sede_id
        LEFT JOIN areas a  ON a.id = u.area_id
        WHERE
          unaccent(lower(u.nombre || ' ' || u.apellido_paterno || ' ' || u.apellido_materno)) LIKE unaccent($1)
          OR u.numero_documento ILIKE $1
        `,
        [termino],
      );
      total = totalRow?.[0]?.total ?? 0;
    } else {
      filas = await this.ds.query(
        `
        SELECT
          u.id,
          u.nombre,
          u.apellido_paterno,
          u.apellido_materno,
          u.tipo_documento,
          u.numero_documento,
          u.telefono_celular,
          u.email_personal,
          u.email_institucional,
          u.fecha_nacimiento, -- ✅ NUEVO
          u.code_scannable,
          u.activo,
          u.foto_perfil_url,
          r.nombre AS rol,
          s.nombre AS sede,
          a.nombre AS area
        FROM usuarios u
        LEFT JOIN roles r  ON r.id = u.rol_id
        LEFT JOIN sedes s  ON s.id = u.sede_id
        LEFT JOIN areas a  ON a.id = u.area_id
        ORDER BY u.apellido_paterno, u.apellido_materno, u.nombre
        LIMIT $1 OFFSET $2
        `,
        [limiteSafe, offset],
      );

      const totalRow = await this.ds.query(
        `
        SELECT COUNT(*)::int AS total
        FROM usuarios u
        `,
      );
      total = totalRow?.[0]?.total ?? 0;
    }

    return {
      datos: filas,
      total,
      pagina: paginaSafe,
      limite: limiteSafe,
    };
  }

  // ============================
  // FICHA DEL EMPLEADO
  // ============================
  async obtenerFichaEmpleado(id: string) {
    const rows = await this.ds.query(
      `
      SELECT
        u.id,
        u.nombre,
        u.apellido_paterno,
        u.apellido_materno,
        u.tipo_documento,
        u.numero_documento,
        u.telefono_celular,
        u.email_personal,
        u.email_institucional,
        u.code_scannable,
        u.foto_perfil_url,
        u.barcode_url,
        u.qr_url,
        u.activo,
        r.nombre AS rol,
        s.nombre AS sede,
        a.nombre AS area
      FROM usuarios u
      LEFT JOIN roles r  ON r.id = u.rol_id
      LEFT JOIN sedes s  ON s.id = u.sede_id
      LEFT JOIN areas a  ON a.id = u.area_id
      WHERE u.id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!rows?.length) {
      throw new NotFoundException('Empleado no encontrado');
    }

    return rows[0];
  }

  // ============================
  // KIOSKO: lookup por código
  // ============================
  async lookupByCode(code: string) {
    const rows = await this.ds.query(
      `SELECT u.id,
              u.nombre,
              u.apellido_paterno,
              u.apellido_materno,
              u.tipo_documento,
              u.numero_documento,
              u.code_scannable,
              u.foto_perfil_url,
              r.nombre AS rol,
              s.nombre AS sede
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       JOIN sedes s ON s.id = u.sede_id
       WHERE u.code_scannable = $1 AND u.activo = TRUE
       LIMIT 1`,
      [code],
    );
    if (!rows?.length) {
      throw new NotFoundException('Código no encontrado o inactivo');
    }
    return rows[0];
  }

  // ============================
  // FOTO DE PERFIL (Sharp)
  // ============================
  async actualizarFotoPerfil(id: string, archivo: Express.Multer.File) {
    const usuario = await this.ds.query(
      `SELECT id FROM usuarios WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!usuario?.length) {
      throw new NotFoundException('Empleado no encontrado');
    }

    const uploadRoot = process.env.UPLOAD_DIR || 'uploads';
    const fotosDir = join(process.cwd(), uploadRoot, 'fotos');

    if (!fs.existsSync(fotosDir)) {
      fs.mkdirSync(fotosDir, { recursive: true });
    }

    const filename = `empleado-${id}.jpg`;
    const outputPath = join(fotosDir, filename);

    const buffer =
      archivo.buffer ||
      (archivo.path ? fs.readFileSync(archivo.path) : null);

    if (!buffer) {
      throw new Error('No se pudo leer el archivo de imagen');
    }

    await sharp(buffer)
      .rotate()
      .resize(450, 600, {
        fit: 'cover',
        position: 'centre',
      })
      .jpeg({ quality: 80 })
      .toFile(outputPath);

    const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const relPath = `fotos/${filename}`;
    const url = publicBase ? `${publicBase}/files/${relPath}` : `/files/${relPath}`;

    await this.ds.query(
      `UPDATE usuarios SET foto_perfil_url = $2 WHERE id = $1`,
      [id, url],
    );

    return { foto_perfil_url: url };
  }

  // ✅ MODIFICADO: si el archivo remoto no existe (404), regeneramos QR/Barcode en memoria
  private async fetchImageBuffer(
    url?: string | null,
    fallback?: { type: 'qr' | 'barcode'; text: string },
  ): Promise<Buffer | null> {
    if (!url) return null;

    try {
      const res = await fetch(url);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    } catch (e) {
      // seguimos al fallback
    }

    // ✅ Fallback: Render borró archivos de uploads, regeneramos en memoria
    if (fallback?.type === 'qr') {
      try {
        return await QRCode.toBuffer(fallback.text, { margin: 1, width: 512 });
      } catch (e) {
        console.error('No se pudo regenerar QR:', e);
        return null;
      }
    }

    if (fallback?.type === 'barcode') {
      try {
        return await bwipToBuffer({
          bcid: 'code128',
          text: fallback.text,
          scale: 3,
          height: 12,
          includetext: true,
        });
      } catch (e) {
        console.error('No se pudo regenerar BARCODE:', e);
        return null;
      }
    }

    return null;
  }

  // ✅ NUEVO (OPCIÓN A): generar QR PNG en memoria (endpoint dinámico)
  async generarQrPngBufferPorEmpleado(id: string): Promise<Buffer> {
    const emp = await this.obtenerFichaEmpleado(id);
    const code = emp.code_scannable ? String(emp.code_scannable) : '';
    if (!code) throw new NotFoundException('Empleado sin code_scannable');

    return QRCode.toBuffer(code, { margin: 1, width: 512 });
  }

  // ✅ NUEVO (OPCIÓN A): generar Barcode PNG en memoria (endpoint dinámico)
  async generarBarcodePngBufferPorEmpleado(id: string): Promise<Buffer> {
    const emp = await this.obtenerFichaEmpleado(id);
    const code = emp.code_scannable ? String(emp.code_scannable) : '';
    if (!code) throw new NotFoundException('Empleado sin code_scannable');

    return bwipToBuffer({
      bcid: 'code128',
      text: code,
      scale: 3,
      height: 12,
      includetext: true,
    });
  }

  async generarCarnetPdf(id: string): Promise<Buffer> {
    const emp = await this.obtenerFichaEmpleado(id);

    const nombreCompleto = `${emp.nombre} ${emp.apellido_paterno} ${emp.apellido_materno}`.trim();

    const cardWidth = 320;
    const cardHeight = 520;

    const doc = new PDFDocument({
      size: [cardWidth, cardHeight],
      margin: 0,
    });

    const chunks: Buffer[] = [];

    return new Promise<Buffer>(async (resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const amarillo = '#f6c21a';
      const negro = '#111111';

      doc.rect(0, 0, cardWidth, cardHeight).fill(negro);

      doc.save();
      doc.fillColor(amarillo);
      doc
        .moveTo(0, 0)
        .lineTo(cardWidth, 0)
        .lineTo(cardWidth, cardHeight * 0.42)
        .lineTo(0, cardHeight * 0.18)
        .closePath()
        .fill();
      doc.restore();

      const centerX = cardWidth / 2;
      const centerY = cardHeight * 0.30;
      const radioFoto = 90;

      doc.save();
      doc.lineWidth(10);
      doc.strokeColor(amarillo);
      doc.circle(centerX, centerY, radioFoto).stroke();
      doc.restore();

      const fotoBuf = await this.fetchImageBuffer(emp.foto_perfil_url);
      if (fotoBuf) {
        doc.save();
        doc.circle(centerX, centerY, radioFoto - 6).clip();
        doc.image(
          fotoBuf,
          centerX - (radioFoto - 6),
          centerY - (radioFoto - 6),
          {
            width: (radioFoto - 6) * 2,
            height: (radioFoto - 6) * 2,
          },
        );
        doc.restore();
      }

      doc.font('Helvetica-Bold');
      doc.fontSize(16);
      doc.fillColor('#ffffff');
      doc.text(nombreCompleto.toUpperCase(), 20, cardHeight * 0.42, {
        width: cardWidth - 40,
        align: 'center',
      });

      const rolTexto = emp.rol ? String(emp.rol).toUpperCase() : '';
      doc.fontSize(12);
      doc.fillColor(amarillo);
      doc.text(rolTexto, 20, cardHeight * 0.50, {
        width: cardWidth - 40,
        align: 'center',
      });

      if (emp.code_scannable) {
        doc.fontSize(8);
        doc.fillColor('#cccccc');
        doc.text(`Código: ${emp.code_scannable}`, 20, cardHeight * 0.56, {
          width: cardWidth - 40,
          align: 'center',
        });
      }

      const code = emp.code_scannable ? String(emp.code_scannable) : '';

      const barcodeBuf = await this.fetchImageBuffer(
        emp.barcode_url,
        code ? { type: 'barcode', text: code } : undefined,
      );
      if (barcodeBuf) {
        const barcodeWidth = cardWidth - 60;
        const barcodeY = cardHeight * 0.60;
        doc.image(barcodeBuf, (cardWidth - barcodeWidth) / 2, barcodeY, {
          width: barcodeWidth,
          height: 60,
          align: 'center',
        });
      }

      const qrBuf = await this.fetchImageBuffer(
        emp.qr_url,
        code ? { type: 'qr', text: code } : undefined,
      );
      if (qrBuf) {
        const qrSize = 110;
        const qrY = cardHeight * 0.72;
        doc.image(qrBuf, (cardWidth - qrSize) / 2, qrY, {
          width: qrSize,
          height: qrSize,
        });
      }

      const pieHeight = 40;
      const pieY = cardHeight - pieHeight;

      doc.save();
      doc.rect(0, pieY, cardWidth, pieHeight).fill(amarillo);
      doc.restore();

      doc.font('Helvetica-Bold');
      doc.fontSize(12);
      doc.fillColor(negro);
      doc.text(rolTexto || 'EMPLEADO', 0, pieY + 10, {
        width: cardWidth,
        align: 'center',
      });

      doc.end();
    });
  }
}

function bwipToBuffer(opts: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    (bwipjs as any).toBuffer(opts, (err: Error, png: Buffer) => {
      if (err) reject(err);
      else resolve(png);
    });
  });
}