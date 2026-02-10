import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { HorariosService } from './horarios.service';

@Controller('horarios')
export class HorariosController {
  constructor(private readonly horariosService: HorariosService) {}

  // ✅ Semana vigente para una fecha (grid semanal)
  // GET /horarios/:id/vigente?fecha=YYYY-MM-DD
  @Get(':id/vigente')
  getVigentes(
    @Param('id') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.horariosService.getVigentes(usuarioId, fecha);
  }

  // ✅ Historial de semanas
  // GET /horarios/:id/historial
  @Get(':id/historial')
  historial(@Param('id') usuarioId: string) {
    return this.horariosService.historial(usuarioId);
  }

  // ✅ Guardar semana completa (7 días)
  // POST /horarios/:id/semana
  @Post(':id/semana')
  setSemana(
    @Param('id') usuarioId: string,
    @Body() dto: any,
  ) {
    return this.horariosService.setSemana(usuarioId, dto);
  }

  // ✅ Horario del día (incluye excepción del día)
  // GET /horarios/:id/dia?fecha=YYYY-MM-DD
  @Get(':id/dia')
  getDia(
    @Param('id') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.horariosService.getHorarioDelDia(usuarioId, fecha);
  }

  // ✅ Crear excepción
  // POST /horarios/:id/excepciones
  @Post(':id/excepciones')
  addExcepcion(
    @Param('id') usuarioId: string,
    @Body() dto: any,
  ) {
    return this.horariosService.addExcepcion(usuarioId, dto);
  }

  // ✅ Eliminar excepción por ID
  // DELETE /horarios/excepciones/:excepcionId
  @Delete('excepciones/:excepcionId')
  eliminarExcepcion(@Param('excepcionId') id: string) {
    return this.horariosService.eliminarExcepcion(id);
  }

  // ✅ LISTAR EXCEPCIONES (lo que necesitas para el panel derecho)
  // GET /horarios/:id/excepciones
  // opcional: /horarios/:id/excepciones?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  @Get('excepciones/:usuarioId')
  listarExcepciones(
    @Param('usuarioId') usuarioId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.horariosService.listarExcepciones(usuarioId, desde, hasta);
  }

  // (Opcional) obtener excepción exacta por fecha (si algún día lo necesitas)
  // GET /horarios/:id/excepcion?fecha=YYYY-MM-DD
  @Get(':id/excepcion')
  getExcepcionPorFecha(
    @Param('id') usuarioId: string,
    @Query('fecha') fecha: string,
  ) {
    return this.horariosService.getExcepcionPorFecha(usuarioId, fecha);
  }
}