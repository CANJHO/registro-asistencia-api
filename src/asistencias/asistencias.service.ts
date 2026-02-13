// asistencias.service.ts (NestJS)
import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HorariosService } from '../horarios/horarios.service';

type EventoAsistencia =
  | 'JORNADA_IN'
  | 'REFRIGERIO_OUT'
  | 'REFRIGERIO_IN'
  | 'JORNADA_OUT';

@Injectable()
export class AsistenciasService {
  constructor(
    private readonly ds: DataSource,
    private readonly horariosSvc: HorariosService,
  ) {}

  // Distancia Haversine (metros)
  private distM(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371000,
      toRad = (v: number) => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1),
      dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  private parseTimeToMinutes(t: string | null | undefined): number | null {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  /** ✅ Refrigerio existe SOLO si hay 2 tramos completos */
  private tieneRefrigerio(horario: any | null): boolean {
    return !!(horario?.hora_inicio_2 && horario?.hora_fin_2);
  }

  /** ✅ HOY PERÚ (YYYY-MM-DD) */
  private fechaHoyPeru(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;

    return `${y}-${m}-${d}`;
  }

  /** ✅ Hora actual PERÚ en minutos (HH*60 + MM) - BLINDADO contra TZ servidor */
  private ahoraMinutosPeru(): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hh * 60 + mm;
  }

  /** 🔎 RESOLVER IDENTIFICADOR */
  private async resolverUsuarioId(identificador: string): Promise<string> {
    const db = await this.ds.query(
      `SELECT id
         FROM usuarios
        WHERE id::text = $1
           OR numero_documento = $1
           OR code_scannable = $1
        LIMIT 1`,
      [identificador.trim()],
    );

    if (!db.length) {
      throw new BadRequestException(
        'Empleado no encontrado para ese identificador',
      );
    }

    return db[0].id;
  }

  /** 🔎 OBTENER DATOS COMPLETOS DEL EMPLEADO */
  private async obtenerDatosEmpleado(usuarioId: string) {
    const rows = await this.ds.query(
      `
      SELECT
        u.id,
        u.nombre,
        u.apellido_paterno,
        u.apellido_materno,
        u.foto_perfil_url AS foto_url,
        s.nombre AS sede,
        a.nombre AS area
      FROM usuarios u
      LEFT JOIN sedes s ON s.id = u.sede_id
      LEFT JOIN areas a ON a.id = u.area_id
      WHERE u.id = $1
      LIMIT 1
      `,
      [usuarioId],
    );
    return rows.length ? rows[0] : null;
  }

  private async ultimoEventoDelDia(usuarioId: string, fechaStr: string) {
    const rows = await this.ds.query(
      `
      SELECT evento, fecha_hora
        FROM asistencias
       WHERE usuario_id = $1
         AND fecha_hora >= $2::date
         AND fecha_hora <  ($2::date + interval '1 day')
       ORDER BY fecha_hora DESC
       LIMIT 1
      `,
      [usuarioId, fechaStr],
    );
    return rows[0] ?? null;
  }

  private async tieneJornadaAbiertaAnterior(
    usuarioId: string,
    fechaStr: string,
  ): Promise<boolean> {
    const rows = await this.ds.query(
      `
      WITH last_by_day AS (
        SELECT (fecha_hora::date) AS d,
               MAX(CASE WHEN evento='JORNADA_IN'  THEN 1 ELSE 0 END) AS has_in,
               MAX(CASE WHEN evento='JORNADA_OUT' THEN 1 ELSE 0 END) AS has_out
          FROM asistencias
         WHERE usuario_id = $1
           AND fecha_hora::date < $2::date
         GROUP BY (fecha_hora::date)
         ORDER BY d DESC
         LIMIT 3
      )
      SELECT 1
        FROM last_by_day
       WHERE has_in = 1 AND has_out = 0
       LIMIT 1
      `,
      [usuarioId, fechaStr],
    );
    return rows.length > 0;
  }

  /**
   * ✅ Decide el siguiente EVENTO sin pedir tipo.
   * - Sin refrigerio: JORNADA_IN -> JORNADA_OUT
   * - Con refrigerio: JORNADA_IN -> REFRIGERIO_OUT -> REFRIGERIO_IN -> JORNADA_OUT
   *
   * 🎯 Caso permiso / salida temprana:
   * Si hay refrigerio y el trabajador marca OUT muy temprano (mucho antes del fin del turno 1),
   * se interpreta como JORNADA_OUT.
   */
  private decidirEventoSiguienteAuto(params: {
    ultimoEvento: EventoAsistencia | null;
    hayRefrigerio: boolean;
    horario: any | null;
  }): EventoAsistencia {
    const { ultimoEvento, hayRefrigerio, horario } = params;

    // Si no hay nada hoy, el primero SIEMPRE es ingreso de jornada
    if (!ultimoEvento || ultimoEvento === 'JORNADA_OUT') {
      return 'JORNADA_IN';
    }

    if (!hayRefrigerio) {
      // Turno corrido: solo puede cerrar jornada
      if (ultimoEvento === 'JORNADA_IN') return 'JORNADA_OUT';
      throw new BadRequestException('Secuencia inválida. Comuníquese con RRHH.');
    }

    // Con refrigerio
    if (ultimoEvento === 'JORNADA_IN') {
      // ✅ Regla permiso
      const finT1 = this.parseTimeToMinutes(horario?.hora_fin);
      if (finT1 != null) {
        const ahoraMin = this.ahoraMinutosPeru(); // ✅ PERÚ
        const umbralPermisoMin = 60;
        if (ahoraMin < finT1 - umbralPermisoMin) return 'JORNADA_OUT';
      }
      return 'REFRIGERIO_OUT';
    }

    if (ultimoEvento === 'REFRIGERIO_OUT') return 'REFRIGERIO_IN';
    if (ultimoEvento === 'REFRIGERIO_IN') return 'JORNADA_OUT';

    throw new BadRequestException('Secuencia inválida. Comuníquese con RRHH.');
  }

  /** ✅ Mapea evento -> tipo (para mantener tu columna tipo) */
  private tipoPorEvento(evento: EventoAsistencia): 'IN' | 'OUT' {
    return evento.endsWith('_IN') ? 'IN' : 'OUT';
  }

  /**
   * ✅ Calcula minutos_tarde según evento:
   * - JORNADA_IN: aplica tolerancia (horario.tolerancia_min)
   * - REFRIGERIO_IN: NO aplica tolerancia
   * - resto: null
   *
   * NOTA: usa hora actual de PERÚ (blindado)
   */
  private calcularMinutosTarde(params: {
    evento: EventoAsistencia;
    horario: any | null;
    esDescanso: boolean;
    esExcepcionNoLaborable: boolean;
  }): number | null {
    const { evento, horario, esDescanso, esExcepcionNoLaborable } = params;

    if (!horario || esDescanso || esExcepcionNoLaborable) return null;

    const minsMarcaje = this.ahoraMinutosPeru(); // ✅ PERÚ

    // 1) Inicio de jornada: con tolerancia
    if (evento === 'JORNADA_IN') {
      const tol = Number(horario.tolerancia_min ?? 15);
      const minsProg = this.parseTimeToMinutes(horario.hora_inicio);
      if (minsProg == null) return null;

      const diff = minsMarcaje - minsProg;
      return diff <= tol ? 0 : diff - tol;
    }

    // 2) Retorno de refrigerio: SIN tolerancia
    if (evento === 'REFRIGERIO_IN') {
      // si no hay tramo 2, no aplica
      const minsProg2 = this.parseTimeToMinutes(horario.hora_inicio_2);
      if (minsProg2 == null) return null;

      const diff = minsMarcaje - minsProg2;
      return diff > 0 ? diff : 0;
    }

    return null;
  }

  // ───────────────────────────────────────────────
  // ✅ MARCAJE AUTOMÁTICO (nuevo)
  // ───────────────────────────────────────────────
  async marcarAutoDesdeKiosko(identificador: string) {
    if (!identificador?.trim()) {
      throw new BadRequestException('Identificador vacío');
    }

    const usuarioId = await this.resolverUsuarioId(identificador);

    const fechaStr = this.fechaHoyPeru(); // ✅ HOY PERÚ

    const pendienteAnterior = await this.tieneJornadaAbiertaAnterior(
      usuarioId,
      fechaStr,
    );
    if (pendienteAnterior) {
      throw new BadRequestException(
        'Tiene una jornada pendiente de día anterior. Comuníquese con RRHH.',
      );
    }

    // Horario del día
    const infoHorario = await this.horariosSvc.getHorarioDelDia(
      usuarioId,
      fechaStr,
    );
    const horario = infoHorario?.horario || null;
    const excepcion = infoHorario?.excepcion || null;

    const esExcepcionNoLaborable = excepcion && excepcion.es_laborable === false;
    const esDescanso = horario?.es_descanso === true;

    if (esDescanso || esExcepcionNoLaborable) {
      throw new BadRequestException(
        'Hoy no tiene jornada laborable. Comuníquese con RRHH.',
      );
    }

    const hayRefrigerio = this.tieneRefrigerio(horario);

    // Último evento del día
    const last = await this.ultimoEventoDelDia(usuarioId, fechaStr);
    const ultimoEvento: EventoAsistencia | null = last?.evento ?? null;

    // Decidir siguiente evento
    const evento = this.decidirEventoSiguienteAuto({
      ultimoEvento,
      hayRefrigerio,
      horario,
    });

    const tipo = this.tipoPorEvento(evento);

    // ✅ Geo (kiosko sin GPS)
    const geo = await this.validarGeo(usuarioId, undefined, undefined);
    const estado = 'aprobado';

    // ✅ Tardanza: JORNADA_IN (con tolerancia) + REFRIGERIO_IN (sin tolerancia)
    const minutos_tarde = this.calcularMinutosTarde({
      evento,
      horario,
      esDescanso,
      esExcepcionNoLaborable,
    });

    // ✅ INSERT: guardar hora Perú aunque Postgres esté en UTC
    await this.ds.query(
      `INSERT INTO asistencias(
         usuario_id, fecha_hora, tipo, evento, metodo,
         gps, evidencia_url, device_id,
         punto_id, validacion_modo, distancia_m,
         estado_validacion, minutos_tarde
       )
       VALUES(
         $1, timezone('America/Lima', now()), $2, $3, $4,
         $5, $6, $7,
         $8, $9, $10,
         $11, $12
       )`,
      [
        usuarioId,
        tipo,
        evento,
        'scanner_barras',
        null,
        null,
        null,
        geo.puntoId,
        geo.modo,
        geo.distancia,
        estado,
        minutos_tarde,
      ],
    );

    const empleado = await this.obtenerDatosEmpleado(usuarioId);

    return {
      ok: true,
      estado,
      evento,
      tipo,
      horario,
      excepcion,
      geo,
      minutos_tarde,
      empleado,
    };
  }

  // ───────────────────────────────────────────────
  // ✅ MARCAJE MANUAL (TU MISMO, pero con cálculo blindado)
  // ───────────────────────────────────────────────
  async marcar(dto: {
    usuarioId: string;
    tipo: 'IN' | 'OUT';
    metodo: 'scanner_barras' | 'qr_fijo' | 'qr_dinamico' | 'manual_supervisor';
    lat?: number;
    lng?: number;
    evidenciaUrl?: string;
    deviceId?: string;
  }) {
    if (!dto.usuarioId || !dto.tipo) {
      throw new BadRequestException('Datos insuficientes');
    }

    const usuarioId = await this.resolverUsuarioId(dto.usuarioId);

    const fechaStr = this.fechaHoy