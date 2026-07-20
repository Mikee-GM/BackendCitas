import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Usuarios } from '../users/entities/user.entity';
import { PromotionRequestDto } from './dto/promotion.dto';
import { PromotionsService } from './promotions.service';

@Controller('promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}
  @Post('preview') preview(@Body() dto: PromotionRequestDto) { return this.promotions.preview(dto); }
  @Post('send') send(@Body() dto: PromotionRequestDto, @GetUser() user: Usuarios) { return this.promotions.send(dto, user); }
}
