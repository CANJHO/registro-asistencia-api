import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Delete,
} from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { HorariosService } from './horarios.service';

@Controller('horarios')
export class HorariosController {
  constructor(private svc: HorariosService) {}

  // ───────────────────────────────────────────────
  // Horario del día (incluye excepción si existe)
  // GET /horarios/dia/:usuarioId?fecha=YYYY-MM-DD
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
  // Vigentes por fecha
  // GET /horarios/vigente/:usuarioId?fecha=YYYY-MM-DD
  // ───────────────────────────────────────────────
  @Get('vigente/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  vigente(@Param('usuarioId') usuarioId: string, @Query('fecha') fecha?: string) {
    return this.svc.getVigentes(usuarioId, fecha);
  }

  // ───────────────────────────────────────────────
  // Historial completo
  // GET /horarios/historial/:usuarioId
  // ───────────────────────────────────────────────
  @Get('historial/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  historial(@Param('usuarioId') usuarioId: string) {
    return this.svc.historial(usuarioId);
  }

  // ───────────────────────────────────────────────
  // ✅ LISTAR EXCEPCIONES (panel derecho)
  // GET /horarios/excepciones/:usuarioId?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  // ───────────────────────────────────────────────
  @Get('excepciones/:usuarioId')
  @Roles('RRHH', 'Gerencia')
  listarExcepciones(
    @Param('usuarioId') usuarioId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.svc.listarExcepciones(usuarioId, desde, hasta);
  }

  // ───────────────────────────────────────────────
  // Nueva semana
  // POST /horarios/semana/:usuarioId
  // ───────────────────────────────────────────────
  @Post('semana/:usuarioId')
  @Roles('RRHH')
  setSemana(@Param('usuarioId') usuarioId: string, @Body() dto: any) {
    return this.svc.setSemana(usuarioId, dto);
  }

  // ───────────────────────────────────────────────
  // Cerrar vigencia
  // PUT /horarios/cerrar/:usuarioId
  // body: { fecha_fin: 'YYYY-MM-DD' }
  // ───────────────────────────────────────────────
  @Put('cerrar/:usuarioId')
  @Roles('RRHH')
  cerrar(@Param('usuarioId') usuarioId: string, @Body() dto: { fecha_fin: string }) {
    return this.svc.cerrarVigencia(usuarioId, dto.fecha_fin);
  }

  // ───────────────────────────────────────────────
  // Agregar excepción
  // POST /horarios/excepcion/:usuarioId
  // ───────────────────────────────────────────────
  @Post('excepcion/:usuarioId')
  @Roles('RRHH')
  addExcepcion(@Param('usuarioId') usuarioId: string, @Body() dto: any) {
    return this.svc.addExcepcion(usuarioId, dto);
  }

  // ───────────────────────────────────────────────
  // Eliminar excepción
  // DELETE /horarios/excepcion/:id
  // ───────────────────────────────────────────────
  @Delete('excepcion/:id')
  @Roles('RRHH')
  eliminarExcepcion(@Param('id') id: string) {
    return this.svc.eliminarExcepcion(id);
  }
}