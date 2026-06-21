import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceExtensionDto } from './create-service-extension.dto';

export class UpdateServiceExtensionDto extends PartialType(CreateServiceExtensionDto) {}
