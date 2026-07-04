import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ExtensionsService } from './extensions.service';
import { CreateExtensionDto } from './dto/create-extension.dto';
import { UpdateExtensionDto } from './dto/update-extension.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('extensions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'jefe')
export class ExtensionsController {
  constructor(private readonly extensionsService: ExtensionsService) {}

  @Post()
  create(@Body() createExtensionDto: CreateExtensionDto) {
    return this.extensionsService.create(createExtensionDto);
  }

  @Get()
  findAll() {
    return this.extensionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.extensionsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateExtensionDto: UpdateExtensionDto,
  ) {
    return this.extensionsService.update(+id, updateExtensionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.extensionsService.remove(+id);
  }
}
