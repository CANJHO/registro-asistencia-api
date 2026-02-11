import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HorariosService {
  constructor(private ds: DataSource) {}

  /**
   * ✅ NORMALIZA FECHA COMO DATE (YYYY-MM-DD) SIN UTC
   * - Si viene "YYYY-MM-DD" lo usa tal cual.
   * - Si no viene, usa la fecha local del servidor (no UTC).
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
   * ✅ Para calcular día de semana sin “caer” en borde UTC:
   * creamos un Date al medio día local (12:00) usando la fechaKey.
   */
  private dateForWeekday(fechaKey: string) {
    // 12:00 evita que un timezone te haga caer al día anterior
    return new Date(`${fechaKey}T12:00:00`);
  }

  // ───────────────────────────────────────────────
  // 1. OBTENER HORARIO DEL DÍA (Para tardanzas)
  // ───────────────────────────────────────────────
  async getHorarioDelDia(usuarioId: string, fecha?: string) {
    const fechaKey = this.dateKey(fecha);
    const f = this.dateForWeekday(fechaKey);

    const diaSemana = f.getDay() === 0 ? 7 : f.getDay(); // Lunes=1, Domingo=7

    // EXCEPCIÓN DEL DÍA (DATE exacto)
    const exc = await this.ds.query(
      `SELECT *
         FROM usuario_excepciones
        WHERE usuario_id = $1
          AND fecha = $2::date
        LIMIT 1`,
      [usuarioId, fechaKey],
    );

    const excepcion = exc[0] || null;

    // HORARIO VIGENTE (por fechaKey)
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

    // Validación defensiva en backend
    for (const it of items) {
      const {
        dia,
        hora_inicio,
        hora_fin,
        hora_inicio_2,
        hora_fin_2,
        es_descanso,
      } = it;

      if (dia == null) {
        throw new BadRequestException('Cada item debe indicar el día (1..7).');
      }

      if (!es_descanso) {
        diasLaborables++;

        const t1i = hora_inicio;
        const t1f = hora_fin;
        const t2i = hora_inicio_2;
        const t2f = hora_fin_2;

        // Turno 1: si se usa, debe estar completo
        if ((t1i && !t1f) || (!t1i && t1f)) {
          throw new BadRequestException(
            `En el día ${dia}, si defines el Turno 1 debes indicar hora de inicio y fin.`,
          );
        }

        // Turno 2: si se usa, debe estar completo
        if ((t2i && !t2f) || (!t2i && t2f)) {
          throw new BadRequestException(
            `En el día ${dia}, si defines el Turno 2 debes indicar hora de inicio y fin.`,
          );
        }

        // Orden lógico de turnos usados
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

        // Al menos un tramo en días laborables
        if (!t1i && !t1f && !t2i && !t2f) {
          throw new BadRequestException(
            `En el día ${dia}, configura al menos un turno o márcalo como descanso.`,
          );
        }
      }
    }

    // No permitir semanas 100% descanso
    if (diasLaborables === 0) {
      throw new BadRequestException(
        'El horario no puede ser solo descansos. Configura al menos un día laborable.',
      );
    }

    // Cerrar vigencias anteriores (la que esté abierta)
    await this.ds.query(
      `UPDATE usuario_horarios
          SET fecha_fin = $2::date
        WHERE usuario_id = $1 AND fecha_fin IS NULL`,
      [usuarioId, fi],
    );

    // Insertar la nueva semana
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
  // 6. EXCEPCIONES (ADD / DELETE)
  // ───────────────────────────────────────────────
  async addExcepcion(usuarioId: string, e: any) {
    if (!e.fecha || !e.tipo) {
      throw new BadRequestException('Falta fecha o tipo');
    }

    const fechaKey = this.dateKey(e.fecha);

    // evitar duplicados
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
        e.es_laborable,
        e.hora_inicio || null,
        e.hora_fin || null,
        e.observacion || null,
      ],
    );

    return { ok: true };
  }

  async eliminarExcepcion(id: string) {
    await this.ds.query(`DELETE FROM usuario_excepciones WHERE id=$1`, [id]);
    return { ok: true };
  }

  // ───────────────────────────────────────────────
  // 7. EXCEPCIONES (GET para FRONT)
  // ───────────────────────────────────────────────
  async getExcepcionPorFecha(usuarioId: string, fecha: string) {
    const fechaKey = this.dateKey(fecha);

    const rows = await this.ds.query(
      `SELECT *
         FROM usuario_excepciones
        WHERE usuario_id = $1
          AND fecha = $2::date
        LIMIT 1`,
      [usuarioId, fechaKey],
    );

    return rows[0] || null;
  }

  async listarExcepciones(usuarioId: string, desde?: string, hasta?: string) {
    const d = desde ? this.dateKey(desde) : null;
    const h = hasta ? this.dateKey(hasta) : null;

    // ✅ Si vienen desde/hasta -> rango
    if (d && h) {
      return this.ds.query(
        `SELECT
          id,
          usuario_id,
          fecha::date AS fecha,
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

    // ✅ Si solo viene desde -> desde en adelante
    if (d && !h) {
      return this.ds.query(
        `SELECT
          id,
          usuario_id,
          fecha::date AS fecha,
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

    // ✅ Default: vigentes desde HOY (para que “se muestre siempre hasta que pase el día”)
    const hoy = this.dateKey();
    return this.ds.query(
      `SELECT *
         FROM usuario_excepciones
        WHERE usuario_id = $1
          AND fecha >= $2::date
        ORDER BY fecha ASC`,
      [usuarioId, hoy],
    );
  }
}