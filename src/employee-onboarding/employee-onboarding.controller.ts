import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublishRegulationDto } from './dto/publish-regulation.dto';
import { EmployeeOnboardingService } from './employee-onboarding.service';

@ApiTags('staff-onboarding')
@ApiBearerAuth('jwt')
@Controller(['employee-onboarding', 'staff-onboarding'])
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class EmployeeOnboardingController {
  constructor(private readonly onboardingService: EmployeeOnboardingService) {}

  @Get('regulation')
  @Roles('admin')
  @ApiOperation({ summary: 'Consultar el reglamento vigente y sus preguntas' })
  @ApiOkResponse({ description: 'Reglamento vigente' })
  getRegulation() {
    return this.onboardingService.getCurrentRegulationForAdmin();
  }

  @Put('regulation')
  @Roles('admin')
  @ApiOperation({
    summary: 'Actualizar y publicar el reglamento para todo el personal',
  })
  @ApiBody({ type: PublishRegulationDto })
  publishRegulation(@Body() dto: PublishRegulationDto) {
    return this.onboardingService.publishRegulation(dto);
  }

  @Get('employees')
  @Roles('admin')
  @ApiOperation({ summary: 'Consultar evaluaciones vigentes de las empleadas' })
  findAll() {
    return this.onboardingService.findAll();
  }

  @Get('employees/:employeeId')
  @Roles('admin')
  @ApiOperation({
    summary: 'Consultar cuestionario e intentos de una empleada',
  })
  findOne(@Param('employeeId') employeeId: string) {
    return this.onboardingService.findByEmployee(employeeId);
  }

  @Post('employees/:employeeId/resend')
  @Roles('admin')
  @ApiOperation({ summary: 'Programar el reenvío del reglamento vigente' })
  resend(@Param('employeeId') employeeId: string) {
    return this.onboardingService.requeueDelivery(employeeId);
  }

  @Get('staff')
  @Roles('admin')
  @ApiOperation({ summary: 'Consultar evaluaciones de todo el personal' })
  findAllStaff() {
    return this.onboardingService.findAllStaff();
  }

  @Get('staff/:userId')
  @Roles('admin')
  @ApiOperation({ summary: 'Consultar el cuestionario de un trabajador' })
  findStaffMember(@Param('userId') userId: string) {
    return this.onboardingService.findByUser(userId);
  }

  @Post('staff/:userId/resend')
  @Roles('admin')
  @ApiOperation({ summary: 'Programar el reenvío a un trabajador' })
  resendToStaff(@Param('userId') userId: string) {
    return this.onboardingService.requeueUserDelivery(userId);
  }
}
