import { Body, Controller, Get, Param, Post, Put, Query, Delete } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { HorariosService } from './horarios.service';

@Controller('horarios')
export class HorariosController {
  constructor(private svc: HorariosService) {}

  // ───────────────────────────────────────────────
  // Horario del día (incluye excepción del día)
  // ───────────────────────────────────────────────
  @Get('dia/:usuarioId')
  @Roles('RRHH', 'Gerencia', 'Empleado')
  getDelDia(
    @Param('usuarioId') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.svc.getHorarioDelDia(usuarioId, fecha);
  }

  // ───────────────────────────────────────────────
  // Horarios vigentes en una fecha
  // ───────────────────────────────────────────────
  @Get('vigente/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  vigente(
    @Param('usuarioId') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.svc.getVigentes(usuarioId, fecha);
  }

  // ───────────────────────────────────────────────
  // Historial completo
  // ───────────────────────────────────────────────
  @Get('historial/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  historial(@Param('usuarioId') usuarioId: string) {
    return this.svc.historial(usuarioId);
  }

  // ───────────────────────────────────────────────
  // Nueva semana
  // ───────────────────────────────────────────────
  @Post('semana/:usuarioId')
  @Roles('RRHH')
  setSemana(@Param('usuarioId') usuarioId: string, @Body() dto: any) {
    return this.svc.setSemana(usuarioId, dto);
  }

  // ───────────────────────────────────────────────
  // Cerrar vigencia
  // ───────────────────────────────────────────────
  @Put('cerrar/:usuarioId')
  @Roles('RRHH')
  cerrar(
    @Param('usuarioId') usuarioId: string,
    @Body() dto: { fecha_fin: string },
  ) {
    return this.svc.cerrarVigencia(usuarioId, dto.fecha_fin);
  }

  // ───────────────────────────────────────────────
  // Agregar excepción
  // ───────────────────────────────────────────────
  @Post('excepcion/:usuarioId')
  @Roles('RRHH')
  addExcepcion(@Param('usuarioId') usuarioId: string, @Body() dto: any) {
    return this.svc.addExcepcion(usuarioId, dto);
  }

  // ───────────────────────────────────────────────
  // Eliminar excepción
  // ───────────────────────────────────────────────
  @Delete('excepcion/:id')
  @Roles('RRHH')
  eliminarExcepcion(@Param('id') id: string) {
    return this.svc.eliminarExcepcion(id);
  }

  // ==========================================================
  // ✅ NUEVO: Obtener excepción por fecha (para el panel derecho)
  // GET /horarios/excepcion/:usuarioId?fecha=YYYY-MM-DD
  // ==========================================================
  @Get('excepcion/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  getExcepcionPorFecha(
    @Param('usuarioId') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    // si no manda fecha, el service usa la fecha actual
    return this.svc.getExcepcionPorFecha(usuarioId, fecha || '');
  }

  // ==========================================================
  // ✅ NUEVO: Listar excepciones (útil para historial/listado RRHH)
  // GET /horarios/excepciones/:usuarioId?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  // si no envías rango => devuelve últimas 200
  // ==========================================================
  @Get('excepciones/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  listarExcepciones(
    @Param('usuarioId') usuarioId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.svc.listarExcepciones(usuarioId, desde, hasta);
  }
}