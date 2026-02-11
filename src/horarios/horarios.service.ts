import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HorariosService {
  constructor(private ds: DataSource) {}

  /**
   * ✅ NORMALIZA FECHA COMO DATE (YYYY-MM-DD) SIN UTC
   */
  private dateKey(fecha?: string) {
    if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * ✅ Para calcular día de semana sin “borde UTC”
   */
  private dateForWeekday(fechaKey: string) {
    return new Date(`${fechaKey}T12:00:00`);
  }

  // ───────────────────────────────────────────────
  // 1. OBTENER HORARIO DEL DÍA (incluye excepción si existe)
  // ───────────────────────────────────────────────
  async getHorarioDelDia(usuarioId: string, fecha?: string) {
    const fechaKey = this.dateKey(fecha);
    const f = this.dateForWeekday(fechaKey);
    const diaSemana = f.getDay() === 0 ? 7 : f.getDay(); // Lunes=1, Domingo=7

    const exc = await this.ds.query(
      `SELECT *
         FROM usuario_excepciones
        WHERE usuario_id = $1
          AND fecha = $2::date
        LIMIT 1`,
      [usuarioId, fechaKey],
    );

    const excepcion = exc[0] || null;

    const rows = await this.ds.query(
      `SELECT *
         FROM usuario_horarios
        WHERE usuario_id = $1
          AND dia_semana = $2
          AND fecha_inicio <= $3::date
          AND (fecha_fin IS NULL OR fecha_fin >= $3::date)
        ORDER BY creado_en DESC
        LIMIT 1`,
      [usuarioId, diaSemana, fechaKey],
    );

    const horario = rows[0] || null;

    return {
      fecha: fechaKey,
      dia_semana: diaSemana,
      horario,
      excepcion,
    };
  }

  // ───────────────────────────────────────────────
  // 2. HORARIOS VIGENTES EN UNA FECHA
  // ───────────────────────────────────────────────
  async getVigentes(usuarioId: string, fecha?: string) {
    const fechaKey = this.dateKey(fecha);

    return this.ds.query(
      `SELECT *
         FROM usuario_horarios
        WHERE usuario_id = $1
          AND fecha_inicio <= $2::date
          AND (fecha_fin IS NULL OR fecha_fin >= $2::date)
        ORDER BY dia_semana`,
      [usuarioId, fechaKey],
    );
  }

  // ───────────────────────────────────────────────
  // 3. HISTORIAL COMPLETO DE HORARIOS
  // ───────────────────────────────────────────────
  historial(usuarioId: string) {
    return this.ds.query(
      `SELECT *
         FROM usuario_horarios
        WHERE usuario_id = $1
        ORDER BY fecha_inicio DESC, dia_semana`,
      [usuarioId],
    );
  }

  // ───────────────────────────────────────────────
  // 4. NUEVA SEMANA (CREA 7 DIAS DE HORARIO)
  // ───────────────────────────────────────────────
  async setSemana(usuarioId: string, dto: any) {
    const fi = dto.fecha_inicio || this.dateKey();
    const items = dto.items || [];

    if (items.length !== 7) {
      throw new BadRequestException('Debes enviar 7 días de horario.');
    }

    let diasLaborables = 0;

    for (const it of items) {
      const { dia, hora_inicio, hora_fin, hora_inicio_2, hora_fin_2, es_descanso } = it;

      if (dia == null) {
        throw new BadRequestException('Cada item debe indicar el día (1..7).');
      }

      if (!es_descanso) {
        diasLaborables++;

        const t1i = hora_inicio;
        const t1f = hora_fin;
        const t2i = hora_inicio_2;
        const t2f = hora_fin_2;

        if ((t1i && !t1f) || (!t1i && t1f)) {
          throw new BadRequestException(
            `En el día ${dia}, si defines el Turno 1 debes indicar hora de inicio y fin.`,
          );
        }

        if ((t2i && !t2f) || (!t2i && t2f)) {
          throw new BadRequestException(
            `En el día ${dia}, si defines el Turno 2 debes indicar hora de inicio y fin.`,
          );
        }

        if (t1i && t1f && t1i >= t1f) {
          throw new BadRequestException(
            `En el día ${dia}, la hora de inicio del Turno 1 debe ser menor que la hora de fin.`,
          );
        }
        if (t2i && t2f && t2i >= t2f) {
          throw new BadRequestException(
            `En el día ${dia}, la hora de inicio del Turno 2 debe ser menor que la hora de fin.`,
          );
        }

        if (!t1i && !t1f && !t2i && !t2f) {
          throw new BadRequestException(
            `En el día ${dia}, configura al menos un turno o márcalo como descanso.`,
          );
        }
      }
    }

    if (diasLaborables === 0) {
      throw new BadRequestException(
        'El horario no puede ser solo descansos. Configura al menos un día laborable.',
      );
    }

    await this.ds.query(
      `UPDATE usuario_horarios
          SET fecha_fin = $2::date
        WHERE usuario_id = $1 AND fecha_fin IS NULL`,
      [usuarioId, fi],
    );

    for (const it of items) {
      const {
        dia,
        hora_inicio,
        hora_fin,
        hora_inicio_2,
        hora_fin_2,
        es_descanso,
        tolerancia_min,
      } = it;

      await this.ds.query(
        `INSERT INTO usuario_horarios
          (usuario_id, dia_semana, hora_inicio, hora_fin,
           hora_inicio_2, hora_fin_2,
           es_descanso, tolerancia_min, fecha_inicio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date)`,
        [
          usuarioId,
          dia,
          es_descanso ? null : hora_inicio,
          es_descanso ? null : hora_fin,
          es_descanso ? null : (hora_inicio_2 || null),
          es_descanso ? null : (hora_fin_2 || null),
          !!es_descanso,
          tolerancia_min || 15,
          fi,
        ],
      );
    }

    return { ok: true };
  }

  // ───────────────────────────────────────────────
  // 5. CERRAR HORARIO
  // ───────────────────────────────────────────────
  async cerrarVigencia(usuarioId: string, fecha_fin: string) {
    const fechaKey = this.dateKey(fecha_fin);

    await this.ds.query(
      `UPDATE usuario_horarios
          SET fecha_fin = $2::date
        WHERE usuario_id = $1 AND fecha_fin IS NULL`,
      [usuarioId, fechaKey],
    );

    return { ok: true };
  }

  // ───────────────────────────────────────────────
  // 6. EXCEPCIONES (ADD / UPDATE / DELETE)
  // ───────────────────────────────────────────────
  async addExcepcion(usuarioId: string, e: any) {
    if (!e.fecha || !e.tipo) {
      throw new BadRequestException('Falta fecha o tipo');
    }

    const fechaKey = this.dateKey(e.fecha);

    const exists = await this.ds.query(
      `SELECT id
         FROM usuario_excepciones
        WHERE usuario_id = $1 AND fecha = $2::date`,
      [usuarioId, fechaKey],
    );

    if (exists.length) {
      throw new BadRequestException('Ya existe excepción para esta fecha');
    }

    await this.ds.query(
      `INSERT INTO usuario_excepciones
        (usuario_id, fecha, tipo, es_laborable, hora_inicio, hora_fin, observacion)
       VALUES ($1,$2::date,$3,$4,$5,$6,$7)`,
      [
        usuarioId,
        fechaKey,
        e.tipo,
        !!e.es_laborable,
        e.es_laborable ? (e.hora_inicio || null) : null,
        e.es_laborable ? (e.hora_fin || null) : null,
        e.observacion || null,
      ],
    );

    return { ok: true };
  }

  async actualizarExcepcion(id: string, e: any) {
    const rows = await this.ds.query(
      `SELECT id FROM usuario_excepciones WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Excepción no encontrada');

    const tipo = (e?.tipo || '').trim();
    if (!tipo) throw new BadRequestException('Tipo requerido');

    const esLaborable = !!e?.es_laborable;
    const horaInicio = esLaborable ? (e?.hora_inicio || null) : null;
    const horaFin = esLaborable ? (e?.hora_fin || null) : null;

    if (esLaborable) {
      if ((horaInicio && !horaFin) || (!horaInicio && horaFin)) {
        throw new BadRequestException('Horario incompleto');
      }
      if (horaInicio && horaFin && horaInicio >= horaFin) {
        throw new BadRequestException('Horario inválido');
      }
    }

    await this.ds.query(
      `UPDATE usuario_excepciones
          SET tipo = $2,
              es_laborable = $3,
              hora_inicio = $4,
              hora_fin = $5,
              observacion = $6
        WHERE id = $1`,
      [
        id,
        tipo,
        esLaborable,
        horaInicio,
        horaFin,
        e?.observacion?.trim() || null,
      ],
    );

    return { ok: true };
  }

  async eliminarExcepcion(id: string) {
    await this.ds.query(`DELETE FROM usuario_excepciones WHERE id=$1`, [id]);
    return { ok: true };
  }

  // ───────────────────────────────────────────────
  // 7. EXCEPCIONES (GET)
  // ───────────────────────────────────────────────
  async listarExcepciones(usuarioId: string, desde?: string, hasta?: string) {
    const d = desde ? this.dateKey(desde) : null;
    const h = hasta ? this.dateKey(hasta) : null;

    // rango
    if (d && h) {
      return this.ds.query(
        `SELECT
           id,
           usuario_id,
           to_char(fecha::date, 'YYYY-MM-DD') as fecha,
           tipo,
           es_laborable,
           hora_inicio,
           hora_fin,
           observacion
         FROM usuario_excepciones
         WHERE usuario_id = $1
           AND fecha BETWEEN $2::date AND $3::date
         ORDER BY fecha ASC`,
        [usuarioId, d, h],
      );
    }

    // desde en adelante
    if (d && !h) {
      return this.ds.query(
        `SELECT
           id,
           usuario_id,
           to_char(fecha::date, 'YYYY-MM-DD') as fecha,
           tipo,
           es_laborable,
           hora_inicio,
           hora_fin,
           observacion
         FROM usuario_excepciones
         WHERE usuario_id = $1
           AND fecha >= $2::date
         ORDER BY fecha ASC`,
        [usuarioId, d],
      );
    }

    // default últimas 200
    return this.ds.query(
      `SELECT
         id,
         usuario_id,
         to_char(fecha::date, 'YYYY-MM-DD') as fecha,
         tipo,
         es_laborable,
         hora_inicio,
         hora_fin,
         observacion
       FROM usuario_excepciones
       WHERE usuario_id = $1
       ORDER BY fecha DESC
       LIMIT 200`,
      [usuarioId],
    );
  }
}