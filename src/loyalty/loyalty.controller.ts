import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdjustPointsDto } from './dto/adjust-points.dto';
import { CreateLoyaltyTierDto } from './dto/create-loyalty-tier.dto';
import { SetClientTierDto } from './dto/set-client-tier.dto';
import { UpdateLoyaltyTierDto } from './dto/update-loyalty-tier.dto';
import { LoyaltyService } from './loyalty.service';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('tiers')
  listTiers() {
    return this.loyaltyService.listTiers();
  }

  @Post('tiers')
  createTier(@Body() createTierDto: CreateLoyaltyTierDto) {
    return this.loyaltyService.createTier(createTierDto);
  }

  @Patch('tiers/:id')
  updateTier(
    @Param('id') id: string,
    @Body() updateTierDto: UpdateLoyaltyTierDto,
  ) {
    return this.loyaltyService.updateTier(id, updateTierDto);
  }

  @Get('clients/:clienteId/membership')
  getClientMembership(@Param('clienteId') clienteId: string) {
    return this.loyaltyService.getClientMembership(clienteId);
  }

  @Get('clients/:clienteId/transactions')
  listClientTransactions(@Param('clienteId') clienteId: string) {
    return this.loyaltyService.listClientTransactions(clienteId);
  }

  @Post('clients/:clienteId/tier')
  setClientTier(
    @Param('clienteId') clienteId: string,
    @Body() setTierDto: SetClientTierDto,
    @Req() req: any,
  ) {
    return this.loyaltyService.setClientTier(
      clienteId,
      setTierDto,
      req.user.id,
    );
  }

  @Post('clients/:clienteId/recalculate-tier')
  recalculateClientTier(@Param('clienteId') clienteId: string) {
    return this.loyaltyService.recalculateClientTier(clienteId);
  }

  @Post('clients/:clienteId/adjust-points')
  adjustPoints(
    @Param('clienteId') clienteId: string,
    @Body() adjustPointsDto: AdjustPointsDto,
    @Req() req: any,
  ) {
    return this.loyaltyService.adjustPoints(
      clienteId,
      adjustPointsDto,
      req.user.id,
    );
  }
}
