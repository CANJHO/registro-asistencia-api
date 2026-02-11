import { Body, Controller, Get, Param, Post, Put, Query, Delete } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { HorariosService } from './horarios.service';

@Controller('horarios')
export class HorariosController {
  constructor(private svc: HorariosService) {}

  // Horario del día (incluye excepción si existe)
  @Get('dia/:usuarioId')
  @Roles('RRHH', 'Gerencia', 'Empleado')
  getDelDia(
    @Param('usuarioId') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.svc.getHorarioDelDia(usuarioId, fecha);
  }

  // Horarios vigentes
  @Get('vigente/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  vigente(
    @Param('usuarioId') usuarioId: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.svc.getVigentes(usuarioId, fecha);
  }

  // Historial
  @Get('historial/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  historial(@Param('usuarioId') usuarioId: string) {
    return this.svc.historial(usuarioId);
  }

  // Nueva semana
  @Post('semana/:usuarioId')
  @Roles('RRHH')
  setSemana(@Param('usuarioId') usuarioId: string, @Body() dto: any) {
    return this.svc.setSemana(usuarioId, dto);
  }

  // Cerrar vigencia
  @Put('cerrar/:usuarioId')
  @Roles('RRHH')
  cerrar(@Param('usuarioId') usuarioId: string, @Body() dto: { fecha_fin: string }) {
    return this.svc.cerrarVigencia(usuarioId, dto.fecha_fin);
  }

  // Crear excepción
  @Post('excepcion/:usuarioId')
  @Roles('RRHH')
  addExcepcion(@Param('usuarioId') usuarioId: string, @Body() dto: any) {
    return this.svc.addExcepcion(usuarioId, dto);
  }

  // ✅ Listar excepciones (panel derecho)
  @Get('excepciones/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  listarExcepciones(
    @Param('usuarioId') usuarioId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.svc.listarExcepciones(usuarioId, desde, hasta);
  }

  // ✅ Editar excepción
  @Put('excepcion/:id')
  @Roles('RRHH')
  actualizarExcepcion(@Param('id') id: string, @Body() dto: any) {
    return this.svc.actualizarExcepcion(id, dto);
  }

  // Eliminar excepción
  @Delete('excepcion/:id')
  @Roles('RRHH')
  eliminarExcepcion(@Param('id') id: string) {
    return this.svc.eliminarExcepcion(id);
  }
}