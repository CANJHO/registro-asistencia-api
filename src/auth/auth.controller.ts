import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: { documento?: string; password?: string }) {
    if (!dto?.documento || !dto?.password) {
      throw new BadRequestException('Body inválido: se requiere { documento, password }');
    }
    return this.auth.login(dto.documento, dto.password);
  }
}